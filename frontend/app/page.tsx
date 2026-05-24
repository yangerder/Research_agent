"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Plus,
  MessageSquare,
  User,
  Bot,
  Lock,
  Eye,
  EyeOff,
  Mic,
  Square,
  RefreshCcw,
  AlertCircle,
} from "lucide-react";
import { sendChatMessage, transcribeAudio } from "../services/api";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  summary?: string;
}
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export default function ChatPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [loadingText, setLoadingText] = useState("AI 正在回覆中");
  const [isLocked, setIsLocked] = useState(false);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [scenario, setScenario] = useState<"A" | "B" | "C">("A");
  const [participantId, setParticipantId] = useState("");
  const [participantInput, setParticipantInput] = useState("");


  const [isRecording, setIsRecording] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [volume, setVolume] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const requestRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const isRecordingRef = useRef(false);
  const [migrationStartTime, setMigrationStartTime] = useState<number | null>(null);

  const [showDevPanel, setShowDevPanel] = useState(false);
  const [devPassword, setDevPassword] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [debugData, setDebugData] = useState({ tokens: 0, rounds: 0 });
  const [config, setConfig] = useState({
    round_limit: 3,
    token_threshold: 300,
    vad_timeout_a: 1.0,
    vad_timeout_b: 2.0,
    vad_threshold: 0.05,
    show_hint_b: true,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const activeChat = chats.find((c) => c.id === activeChatId) || chats[0];

  useEffect(() => {
    const savedId = localStorage.getItem("participant_id");
    if (savedId) {
      setParticipantId(savedId);
      setParticipantInput(savedId);
    }
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/config`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`config status ${res.status}`);
        }
        return res.json();
      })
      .then((data) => setConfig(data))
      .catch((err) => {
        console.warn("無法取得實驗設定，使用預設值", err);
      });
  }, []);

  useEffect(() => {
    if (chats.length === 0) createNewChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setIsLocked(false);
    setWarningMessage(null);
    setShowHint(false);
    setMigrationStartTime(null);
  }, [activeChatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, isLoading, isTranscribing, loadingText]);

  const autoResizeTextarea = () => {
    const el = inputRef.current;
    if (!el) return;

    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  const resetTextareaHeight = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
  };

  const createNewChat = () => {
    const newId = Date.now().toString();
    const newChat: Chat = {
      id: newId,
      title: `新對話 ${chats.length + 1}`,
      messages: [],
    };

    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newId);
  };

  const handleMigration = async (summaryText: string) => {
    if (!activeChatId) return;

    const clickTime = Date.now();
    const migrationTimeMs = migrationStartTime ? clickTime - migrationStartTime : 0;

    const newId = Date.now().toString();
    const summaryInitialMessage: Message = {
      role: "assistant",
      content: `🔔 這是我們先前討論的重點摘要：\n\n${summaryText}\n\n我們可以從這裡繼續接續討論。`,
    };

    setChats((prev) => [
      {
        id: newId,
        title: `摘要接續: ${summaryText.substring(0, 8)}...`,
        messages: [summaryInitialMessage],
      },
      ...prev,
    ]);
    setActiveChatId(newId);

    try {
      await fetch(`${API_BASE}/log_migration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: participantId || "unknown",
          chat_id: activeChatId,
          migration_time: migrationTimeMs,
          summary: summaryText,
        }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const startVAD = (stream: MediaStream) => {
    audioContextRef.current = new AudioContext();
    const source = audioContextRef.current.createMediaStreamSource(stream);
    analyserRef.current = audioContextRef.current.createAnalyser();
    analyserRef.current.fftSize = 256;
    source.connect(analyserRef.current);

    const checkVolume = () => {
      if (!analyserRef.current || !isRecordingRef.current) return;

      const dataArray = new Float32Array(analyserRef.current.fftSize);
      analyserRef.current.getFloatTimeDomainData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }

      const rms = Math.sqrt(sum / dataArray.length);
      setVolume(rms);

      const timeout = scenario === "A" ? config.vad_timeout_a : config.vad_timeout_b;

      if (rms < config.vad_threshold) {
        if (!silenceStartRef.current) silenceStartRef.current = Date.now();

        if ((Date.now() - silenceStartRef.current) / 1000 > timeout) {
          if (scenario === "A") {
            stopRecording(true);
            return;
          }

          if (config.show_hint_b && !showHint) {
            setShowHint(true);
          }
        }
      } else {
        silenceStartRef.current = null;
        setShowHint(false);
      }

      requestRef.current = requestAnimationFrame(checkVolume);
    };

    checkVolume();
  };

  const startRecording = async () => {
    if (isLoading || isTranscribing || isLocked) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      silenceStartRef.current = null;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const isAuto = silenceStartRef.current !== null;

        try {
          setIsTranscribing(true);
          setLoadingText("正在轉換語音");

          const text = await transcribeAudio(
            new Blob(chunksRef.current, { type: "audio/webm" })
          );

          if (text?.trim()) {
            await handleSend(text, isAuto ? "auto_vad" : "manual");
          }
        } catch (err) {
          console.error("語音轉文字失敗", err);
          setWarningMessage("語音轉文字失敗，請改用文字輸入。");
        } finally {
          setIsTranscribing(false);
          setLoadingText("AI 正在回覆中");
          stream.getTracks().forEach((t) => t.stop());
        }
      };

      isRecordingRef.current = true;
      setIsRecording(true);
      mediaRecorder.start();
      startVAD(stream);
    } catch {
      console.error("請檢查麥克風權限");
      setWarningMessage("無法取得麥克風權限，請檢查瀏覽器設定。");
    }
  };

  const stopRecording = (isAuto: boolean = false) => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      isRecordingRef.current = false;
      setIsRecording(false);

      mediaRecorderRef.current.stop();

      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
      }

      if (!isAuto) {
        silenceStartRef.current = null;
      }
    }
  };

  const confirmParticipantId = () => {
    const trimmed = participantInput.trim();

    console.log("confirmParticipantId clicked:", trimmed);

    if (!trimmed) {
      setWarningMessage("請先輸入受測者編號");
      return;
    }

    try {
      localStorage.setItem("participant_id", trimmed);
    } catch (err) {
      console.warn("無法寫入 localStorage，但仍繼續實驗", err);
    }

    setParticipantId(trimmed);
    setParticipantInput(trimmed);
    setWarningMessage(null);
  };

  const handleSend = async (customText?: string, trigger: string = "manual") => {
    const messageContent = customText || input;

    if (!participantId) {
      setWarningMessage("請先輸入受測者編號");
      return;
    }

    if (!messageContent.trim() || !activeChatId || isLoading || isLocked) return;

    const historyBeforeSend = activeChat?.messages || [];

    setChats((prev) =>
      prev.map((c) =>
        c.id === activeChatId
          ? {
              ...c,
              messages: [...c.messages, { role: "user", content: messageContent }],
            }
          : c
      )
    );

    if (!customText) {
      setInput("");
      setTimeout(resetTextareaHeight, 0);
    }

    setWarningMessage(null);
    setIsLoading(true);
    setLoadingText("AI 正在回覆中");

    let summaryTimer: ReturnType<typeof setTimeout> | null = null;

    if (scenario === "C") {
      summaryTimer = setTimeout(() => {
        setLoadingText("正在檢查記憶上限，可能正在生成摘要");
      }, 2500);
    }

    try {
      const data = await sendChatMessage(
        participantId,
        messageContent,
        historyBeforeSend,
        scenario,
        trigger,
        activeChatId
      );

      if (data.status === "warning") {
        setIsLocked(true);
        setWarningMessage(data.message);

        if (data.summary && scenario === "C") {
          setChats((prev) =>
            prev.map((c) =>
              c.id === activeChatId ? { ...c, summary: data.summary } : c
            )
          );

          if (!migrationStartTime) {
            setMigrationStartTime(Date.now());
          }
        }
      } else {
        setChats((prev) =>
          prev.map((c) =>
            c.id === activeChatId
              ? {
                  ...c,
                  messages: data.history,
                  summary: data.summary || c.summary,
                }
              : c
          )
        );

        if (data.summary && scenario === "C" && !migrationStartTime) {
          setMigrationStartTime(Date.now());
        }
      }

      if (data.debug) {
        setDebugData(data.debug);
      }
    } catch (err) {
      console.error(err);
      setWarningMessage(
        "系統暫時無法回應，可能是請求過長、API 限制或後端錯誤，請稍後再試。"
      );
    } finally {
      if (summaryTimer) clearTimeout(summaryTimer);
      setIsLoading(false);
      setLoadingText("AI 正在回覆中");
      inputRef.current?.focus();
    }
  };

  const showLoadingBubble = isLoading || isTranscribing;

  return (
    <div className="flex h-screen bg-gray-50 text-gray-800 font-sans">
      {!participantId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              請輸入受測者編號
            </h2>

            <p className="text-sm text-gray-500 mb-6">
              請輸入研究者提供的編號，例如 P001、P002。這個編號只會用來區分實驗資料。
            </p>

            <input
              value={participantInput}
              onChange={(e) => setParticipantInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmParticipantId();
              }}
              placeholder="例如：P001"
              className="w-full p-4 border border-gray-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/20 mb-4"
              autoFocus
            />

            <button
              type="button"
              onClick={confirmParticipantId}
              className="w-full bg-blue-600 text-white py-3.5 rounded-2xl font-bold hover:bg-blue-700 active:scale-95 transition-all"
            >
              開始實驗
            </button>
          </div>
        </div>
      )}
      <div className="w-64 bg-[#171717] text-white flex flex-col border-r border-white/10">
        <div className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-lg font-bold">
            L
          </div>
          <button
            onClick={createNewChat}
            className="flex-1 p-2 border border-white/20 rounded-lg hover:bg-white/10 transition text-sm flex items-center justify-center gap-2"
          >
            <Plus size={18} /> 新增對話
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2">
          {chats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => setActiveChatId(chat.id)}
              className={`p-3 rounded-lg cursor-pointer flex items-center gap-3 mb-1 transition-colors ${
                activeChatId === chat.id ? "bg-[#212121]" : "hover:bg-[#212121]"
              }`}
            >
              <MessageSquare size={16} className="text-gray-400" />
              <span className="truncate text-sm text-gray-200">{chat.title}</span>
            </div>
          ))}
        </div>

        <div className="p-4 bg-[#0d0d0d] border-t border-white/10">
          <div className="flex items-center justify-between mb-3 text-gray-500">
            <span className="text-[10px] font-bold uppercase">研究工具</span>
            <button onClick={() => setShowDevPanel(!showDevPanel)}>
              {showDevPanel ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          {showDevPanel && (
            <div className="mb-4 text-[11px] font-mono bg-black/40 p-3 rounded-md text-green-400 space-y-1.5 border border-green-500/20">
              {!isUnlocked ? (
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder="密碼"
                    value={devPassword}
                    onChange={(e) => setDevPassword(e.target.value)}
                    className="w-full bg-[#212121] p-1 rounded outline-none border border-white/10"
                  />
                  <button
                    onClick={() => {
                      if (devPassword === "1234") {
                        setIsUnlocked(true);
                      } else {
                        setWarningMessage("開發工具密碼錯誤");
                      }
                    }}
                  >
                    <Lock size={12} />
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    輪數: {debugData.rounds}/{config.round_limit}
                  </div>
                  <div>
                    Token: {debugData.tokens}/{config.token_threshold}
                  </div>
                  <div>音量: {volume.toFixed(4)}</div>
                </>
              )}
            </div>
          )}

          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as "A" | "B" | "C")}
            className="w-full bg-[#212121] text-sm p-2.5 rounded-lg border border-white/10 outline-none"
          >
            <option value="A">情境 A</option>
            <option value="B">情境 B</option>
            <option value="C">情境 C</option>
          </select>
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-white">
        <header className="h-14 border-b flex items-center justify-between px-6 bg-white/80 backdrop-blur-md sticky top-0 z-10 font-bold">
          <span>實驗介面 - 情境 {scenario}</span>
          <span className="text-xs text-gray-500 font-normal">
            受測者：{participantId || "未設定"}
            {participantId && (
              <button
                onClick={() => {
                  localStorage.removeItem("participant_id");
                  setParticipantId("");
                  setParticipantInput("");
                }}
                className="ml-3 text-xs text-blue-600 hover:underline"
              >
                更換
              </button>
            )}
          </span>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {activeChat?.messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`flex gap-4 max-w-[85%] ${
                    m.role === "user" ? "flex-row-reverse" : ""
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      m.role === "user" ? "bg-blue-500" : "bg-emerald-600"
                    } text-white shadow-sm`}
                  >
                    {m.role === "user" ? <User size={16} /> : <Bot size={16} />}
                  </div>

                  <div
                    className={`p-4 rounded-2xl shadow-sm whitespace-pre-wrap break-words leading-relaxed ${
                      m.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-[#f4f4f4] text-gray-800"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              </div>
            ))}

            {showLoadingBubble && (
              <div className="flex justify-start">
                <div className="flex gap-4 max-w-[85%]">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-emerald-600 text-white shadow-sm">
                    <Bot size={16} />
                  </div>

                  <div className="p-4 rounded-2xl shadow-sm bg-[#f4f4f4] text-gray-600 leading-relaxed">
                    <div className="flex items-center gap-3">
                      <span>{loadingText}</span>
                      <span className="flex gap-1">
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:120ms]" />
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:240ms]" />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeChat?.summary && scenario === "C" && (
              <div className="mx-auto max-w-xl my-8 p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-100 rounded-3xl shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="flex items-center gap-2 mb-3 text-blue-800">
                  <RefreshCcw size={18} className="animate-spin-slow" />
                  <h3 className="font-bold">記憶遷移建議</h3>
                </div>

                <p className="text-sm text-blue-700 mb-5 leading-relaxed bg-white/50 p-3 rounded-xl border border-blue-50 whitespace-pre-wrap">
                  {activeChat.summary}
                </p>

                <button
                  onClick={() => handleMigration(activeChat.summary!)}
                  className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold hover:bg-blue-700 shadow-md active:scale-95 transition-all"
                >
                  帶著摘要開啟新對話
                </button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="p-4 md:p-6 bg-white border-t">
          <div className="max-w-3xl mx-auto relative">
            {warningMessage && (
              <div className="absolute -top-16 left-1/2 -translate-x-1/2 bg-red-50 text-red-700 text-xs py-3 px-6 rounded-2xl shadow-xl flex items-center gap-2 z-20 border border-red-200 animate-in fade-in zoom-in duration-300 max-w-[90%]">
                <AlertCircle size={14} />
                <span className="font-semibold whitespace-nowrap overflow-hidden text-ellipsis">
                  {warningMessage}
                </span>
              </div>
            )}

            {showHint && scenario !== "A" && !isLocked && (
              <div className="absolute -top-16 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs py-2 px-5 rounded-full shadow-xl animate-bounce z-20">
                💡 偵測到停頓，若說完請停止
              </div>
            )}

            <div className="relative flex items-end gap-3">
              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResizeTextarea();
                }}
                onInput={autoResizeTextarea}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  isLocked
                    ? "對話已達記憶上限，請依提示操作"
                    : isRecording
                    ? "錄音中..."
                    : "輸入訊息，Shift + Enter 換行"
                }
                className={`flex-1 resize-none max-h-[180px] min-h-[56px] overflow-y-auto p-4 border rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm transition-all leading-relaxed ${
                  isLocked
                    ? "bg-gray-100 border-red-200 cursor-not-allowed text-gray-500"
                    : "bg-white border-gray-200"
                }`}
                disabled={isLoading || isTranscribing || isRecording || isLocked}
              />

              <button
                onClick={() => handleSend()}
                disabled={isLoading || isTranscribing || isRecording || isLocked || !input.trim()}
                className={`p-4 rounded-2xl transition-all shadow-sm ${
                  isLoading || isTranscribing || isRecording || isLocked || !input.trim()
                    ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
                }`}
                title="送出"
              >
                <Send size={22} />
              </button>

              <button
                onClick={() => (isRecording ? stopRecording(false) : startRecording())}
                disabled={isLoading || isTranscribing || isLocked}
                className={`p-4 rounded-2xl transition-all shadow-sm ${
                  isRecording
                    ? "bg-red-500 text-white animate-pulse"
                    : isLocked
                    ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                    : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                }`}
                title={isRecording ? "停止錄音" : "語音輸入"}
              >
                {isRecording ? <Square size={22} fill="currentColor" /> : <Mic size={22} />}
              </button>
            </div>

            <div className="mt-2 text-xs text-gray-400 text-center">
              Enter 送出，Shift + Enter 換行
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
