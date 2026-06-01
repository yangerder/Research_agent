"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Lock,
  Mic,
  MessageSquare,
  Plus,
  RefreshCcw,
  Send,
  Square,
  User,
} from "lucide-react";
import {
  getTaskDoc,
  startExperiment,
  logMigration,
  logPhaseCompletion,
  sendChatMessage,
  transcribeAudio,
  type AssignmentMode,
  type Scenario,
} from "../services/api";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  summary?: string;
  locked?: boolean;
  createdAt: string;
}

interface ExperimentPhase {
  id: string;
  missionTitle: string;
  condition: Scenario | null;
  conditionLabel: string;
  phaseLabel: string;
  title: string;
  taskDocId: string;
  minRounds: number;
  mode: "text" | "voice" | "read_only";
  durationSeconds?: number | null;
  status: "locked" | "active" | "completed";
  chats: Chat[];
  activeChatId: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

interface FlowPhaseConfig {
  id: string;
  missionTitle: string;
  condition: Scenario | null;
  conditionLabel: string;
  phaseLabel: string;
  title: string;
  taskDocId: string;
  minRounds: number;
  mode: "text" | "voice" | "read_only";
  durationSeconds?: number | null;
}

const nowIso = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const createDefaultChat = (phaseTitle: string): Chat => ({
  id: makeId("chat"),
  title: phaseTitle.includes("住宿") ? "住宿比較" : "討論行程",
  messages: [],
  createdAt: nowIso(),
});

const fallbackFlow: FlowPhaseConfig[] = [
  {
    id: "intro",
    missionTitle: "實驗介紹",
    condition: null,
    conditionLabel: "說明",
    phaseLabel: "Intro",
    title: "實驗內容介紹",
    taskDocId: "intro",
    minRounds: 0,
    mode: "read_only",
  },
  {
    id: "text_travel_b_phase_a",
    missionTitle: "文字旅遊 Mission 1",
    condition: "B",
    conditionLabel: "情境 B：使用者自行切換新對話",
    phaseLabel: "Phase A",
    title: "初步行程討論",
    taskDocId: "text_travel_phase_a",
    minRounds: 6,
    mode: "text",
  },
  {
    id: "text_travel_b_phase_b",
    missionTitle: "文字旅遊 Mission 1",
    condition: "B",
    conditionLabel: "情境 B：使用者自行切換新對話",
    phaseLabel: "Phase B",
    title: "住宿區域比較",
    taskDocId: "text_travel_phase_b",
    minRounds: 4,
    mode: "text",
  },
  {
    id: "text_travel_b_phase_c",
    missionTitle: "文字旅遊 Mission 1",
    condition: "B",
    conditionLabel: "情境 B：使用者自行切換新對話",
    phaseLabel: "Phase C",
    title: "突發限制調整",
    taskDocId: "text_travel_phase_c",
    minRounds: 4,
    mode: "text",
  },
  {
    id: "end",
    missionTitle: "實驗結束",
    condition: null,
    conditionLabel: "結束",
    phaseLabel: "End",
    title: "完成實驗",
    taskDocId: "end",
    minRounds: 0,
    mode: "read_only",
  },
];

export default function ChatPage() {
  const [participantId, setParticipantId] = useState("");
  const [participantInput, setParticipantInput] = useState("");
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("between_subject");
  const [assignmentInfo, setAssignmentInfo] = useState<any>(null);

  const [phases, setPhases] = useState<ExperimentPhase[]>([]);
  const [activePhaseId, setActivePhaseId] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [taskDoc, setTaskDoc] = useState("載入任務文件中...");

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [loadingText, setLoadingText] = useState("AI 正在回覆中");
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

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

  const selectedPhase = useMemo(
    () => phases.find((p) => p.id === activePhaseId) || phases[0],
    [phases, activePhaseId]
  );

  const currentActivePhase = useMemo(
    () => phases.find((p) => p.status === "active") || null,
    [phases]
  );

  const selectedChat = useMemo(() => {
    if (!selectedPhase) return null;
    return selectedPhase.chats.find((c) => c.id === activeChatId) || selectedPhase.chats[0] || null;
  }, [selectedPhase, activeChatId]);

  const currentCondition = selectedPhase?.condition || "A";
  const phaseRounds = useMemo(() => countPhaseRounds(selectedPhase), [selectedPhase]);
  const canCompletePhase = Boolean(selectedPhase && selectedPhase.status === "active" && phaseRounds >= selectedPhase.minRounds);
  const isViewingCurrentPhase = selectedPhase && currentActivePhase && selectedPhase.id === currentActivePhase.id;
  const canInteract = Boolean(
    participantId &&
      selectedPhase &&
      selectedChat &&
      selectedPhase.status === "active" &&
      selectedPhase.mode !== "read_only" &&
      isViewingCurrentPhase &&
      !isLoading &&
      !isTranscribing
  );

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem("assignment_mode") as AssignmentMode | null;
      if (savedMode === "between_subject" || savedMode === "within_subject") {
        setAssignmentMode(savedMode);
      }

      const savedId = localStorage.getItem("participant_id");
      if (savedId) {
        setParticipantId(savedId);
        setParticipantInput(savedId);
        loadExperimentForParticipant(savedId, savedMode || assignmentMode);
      }
    } catch (err) {
      console.warn("Unable to read participant settings", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    if (!selectedPhase?.taskDocId) return;

    getTaskDoc(selectedPhase.taskDocId)
      .then((data) => setTaskDoc(data.content))
      .catch((err) => {
        console.warn("無法取得任務文件，使用預設文字", err);
        setTaskDoc("目前任務文件載入失敗，請通知研究者。你仍可依照右下角階段資訊進行任務。");
      });
  }, [selectedPhase?.taskDocId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [phases, activeChatId, isLoading, isTranscribing, loadingText]);

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000"}/config`);
      if (!res.ok) throw new Error(`config status ${res.status}`);
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.warn("無法取得實驗設定，使用預設值", err);
    }
  };

  const loadExperimentForParticipant = async (pid: string, mode: AssignmentMode = assignmentMode) => {
    try {
      const data = await startExperiment(pid, mode);
      setAssignmentInfo(data.assignment || data);
      setAssignmentMode(data.assignment_mode || mode);
      initializePhases(data.phases || fallbackFlow);
    } catch (err) {
      console.warn("無法取得受測者實驗分配，使用前端 fallback flow", err);
      setAssignmentInfo({ assignment_mode: mode, fallback: true });
      initializePhases(fallbackFlow);
    }
  };

  const initializePhases = (flowPhases: FlowPhaseConfig[]) => {
    const initialized: ExperimentPhase[] = flowPhases.map((phase, index) => {
      const needsChat = phase.mode !== "read_only";
      const initialChat = needsChat ? createDefaultChat(phase.title) : null;

      return {
        ...phase,
        status: index === 0 ? "active" : "locked",
        chats: initialChat ? [initialChat] : [],
        activeChatId: initialChat?.id || null,
        startedAt: index === 0 ? nowIso() : null,
        endedAt: null,
      };
    });

    setPhases(initialized);
    setActivePhaseId(initialized[0]?.id || null);
    setActiveChatId(initialized[0]?.activeChatId || null);
  };

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

  const confirmParticipantId = async () => {
    const trimmed = participantInput.trim();

    if (!trimmed) {
      setWarningMessage("請先輸入受測者編號");
      return;
    }

    try {
      localStorage.setItem("participant_id", trimmed);
      localStorage.setItem("assignment_mode", assignmentMode);
    } catch (err) {
      console.warn("無法寫入 localStorage，但仍繼續實驗", err);
    }

    setParticipantId(trimmed);
    setParticipantInput(trimmed);
    setWarningMessage(null);
    await loadExperimentForParticipant(trimmed, assignmentMode);
  };

  const selectPhaseChat = (phaseId: string, chatId: string | null) => {
    const phase = phases.find((p) => p.id === phaseId);
    setActivePhaseId(phaseId);
    setActiveChatId(chatId || phase?.activeChatId || phase?.chats[0]?.id || null);
    setWarningMessage(null);
  };

  const goToCurrentActivePhase = () => {
    if (!currentActivePhase) return;
    setActivePhaseId(currentActivePhase.id);
    setActiveChatId(currentActivePhase.activeChatId || currentActivePhase.chats[0]?.id || null);
  };

  const createNewChat = () => {
    if (!currentActivePhase) return;

    if (!selectedPhase || selectedPhase.id !== currentActivePhase.id || selectedPhase.status !== "active") {
      setWarningMessage("只能在目前進行中的階段新增對話");
      goToCurrentActivePhase();
      return;
    }

    if (selectedPhase.mode === "read_only") {
      setWarningMessage("目前階段不需要新增對話");
      return;
    }

    const newChat: Chat = {
      id: makeId("chat"),
      title: `新對話 ${selectedPhase.chats.length + 1}`,
      messages: [],
      createdAt: nowIso(),
    };

    setPhases((prev) =>
      prev.map((phase) =>
        phase.id === selectedPhase.id
          ? {
              ...phase,
              chats: [newChat, ...phase.chats],
              activeChatId: newChat.id,
            }
          : phase
      )
    );
    setActiveChatId(newChat.id);
    setWarningMessage(null);
  };

  const updateSelectedChat = (updater: (chat: Chat) => Chat) => {
    if (!selectedPhase || !selectedChat) return;

    setPhases((prev) =>
      prev.map((phase) =>
        phase.id === selectedPhase.id
          ? {
              ...phase,
              chats: phase.chats.map((chat) => (chat.id === selectedChat.id ? updater(chat) : chat)),
            }
          : phase
      )
    );
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
      for (let i = 0; i < dataArray.length; i += 1) {
        sum += dataArray[i] * dataArray[i];
      }

      const rms = Math.sqrt(sum / dataArray.length);
      setVolume(rms);

      const timeout = currentCondition === "A" ? config.vad_timeout_a : config.vad_timeout_b;

      if (rms < config.vad_threshold) {
        if (!silenceStartRef.current) silenceStartRef.current = Date.now();

        if ((Date.now() - silenceStartRef.current) / 1000 > timeout) {
          if (currentCondition === "A") {
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
    if (!canInteract) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      silenceStartRef.current = null;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const isAuto = silenceStartRef.current !== null;

        try {
          setIsTranscribing(true);
          setLoadingText("正在轉換語音");

          const text = await transcribeAudio(new Blob(chunksRef.current, { type: "audio/webm" }));

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
      setWarningMessage("無法取得麥克風權限，請檢查瀏覽器設定。");
    }
  };

  const stopRecording = (isAuto = false) => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      isRecordingRef.current = false;
      setIsRecording(false);
      mediaRecorderRef.current.stop();

      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      if (!isAuto) silenceStartRef.current = null;
    }
  };

  const handleSend = async (customText?: string, trigger = "manual") => {
    const messageContent = customText || input;

    if (!participantId) {
      setWarningMessage("請先輸入受測者編號");
      return;
    }

    if (!selectedPhase || !selectedChat || !selectedPhase.condition) {
      setWarningMessage("目前階段不能送出訊息");
      return;
    }

    if (!canInteract || !messageContent.trim()) return;

    const historyBeforeSend = selectedChat.messages;

    updateSelectedChat((chat) => ({
      ...chat,
      messages: [...chat.messages, { role: "user", content: messageContent }],
    }));

    if (!customText) {
      setInput("");
      setTimeout(resetTextareaHeight, 0);
    }

    setWarningMessage(null);
    setIsLoading(true);
    setLoadingText("AI 正在回覆中");

    let summaryTimer: ReturnType<typeof setTimeout> | null = null;

    if (selectedPhase.condition === "C") {
      summaryTimer = setTimeout(() => {
        setLoadingText("正在檢查記憶上限，可能正在生成摘要");
      }, 2500);
    }

    try {
      const data = await sendChatMessage(
        participantId,
        messageContent,
        historyBeforeSend,
        selectedPhase.condition,
        trigger,
        selectedChat.id,
        selectedPhase.id
      );

      if (data.status === "warning") {
        setWarningMessage(data.message);

        updateSelectedChat((chat) => ({
          ...chat,
          summary: data.summary || chat.summary,
        }));

        if (data.summary && selectedPhase.condition === "C" && !migrationStartTime) {
          setMigrationStartTime(Date.now());
        }
      } else {
        updateSelectedChat((chat) => ({
          ...chat,
          messages: data.history,
          summary: data.summary || chat.summary,
        }));

        if (data.summary && selectedPhase.condition === "C" && !migrationStartTime) {
          setMigrationStartTime(Date.now());
        }
      }

      if (data.debug) setDebugData(data.debug);
    } catch (err) {
      console.error(err);
      setWarningMessage("系統暫時無法回應，可能是請求過長、API 限制或後端錯誤，請稍後再試。");
    } finally {
      if (summaryTimer) clearTimeout(summaryTimer);
      setIsLoading(false);
      setLoadingText("AI 正在回覆中");
      inputRef.current?.focus();
    }
  };

  const handleMigration = async (summaryText: string) => {
    if (!selectedPhase || !selectedChat || selectedPhase.status !== "active") return;

    const clickTime = Date.now();
    const migrationTimeMs = migrationStartTime ? clickTime - migrationStartTime : 0;

    const newChat: Chat = {
      id: makeId("summary_chat"),
      title: `摘要接續 ${selectedPhase.chats.length + 1}`,
      createdAt: nowIso(),
      messages: [
        {
          role: "assistant",
          content: `🔔 這是我們先前討論的重點摘要：\n\n${summaryText}\n\n我們可以從這裡繼續接續討論。`,
        },
      ],
    };

    setPhases((prev) =>
      prev.map((phase) =>
        phase.id === selectedPhase.id
          ? {
              ...phase,
              chats: [newChat, ...phase.chats],
              activeChatId: newChat.id,
            }
          : phase
      )
    );
    setActiveChatId(newChat.id);

    try {
      await logMigration({
        user_id: participantId || "unknown",
        chat_id: selectedChat.id,
        migration_time: migrationTimeMs,
        summary: summaryText,
      });
    } catch (err) {
      console.error(err);
    }
  };

  const completeCurrentPhase = async () => {
    if (!selectedPhase || selectedPhase.status !== "active") return;
    if (phaseRounds < selectedPhase.minRounds) return;

    const currentIndex = phases.findIndex((p) => p.id === selectedPhase.id);
    const nextPhase = phases[currentIndex + 1];
    const endedAt = nowIso();

    try {
      if (participantId) {
        await logPhaseCompletion({
          participant_id: participantId,
          phase_id: selectedPhase.id,
          mission_title: selectedPhase.missionTitle,
          condition: selectedPhase.condition,
          phase_label: selectedPhase.phaseLabel,
          title: selectedPhase.title,
          round_count: phaseRounds,
          chat_count: selectedPhase.chats.length,
          started_at: selectedPhase.startedAt || null,
          ended_at: endedAt,
        });
      }
    } catch (err) {
      console.warn("phase completion log failed", err);
    }

    setPhases((prev) =>
      prev.map((phase, index) => {
        if (index === currentIndex) {
          return {
            ...phase,
            status: "completed",
            endedAt,
            chats: phase.chats.map((chat) => ({ ...chat, locked: true })),
          };
        }

        if (index === currentIndex + 1) {
          const hasChat = phase.chats.length > 0;
          const firstChat = hasChat ? phase.chats[0] : phase.mode !== "read_only" ? createDefaultChat(phase.title) : null;

          return {
            ...phase,
            status: "active",
            startedAt: nowIso(),
            chats: hasChat ? phase.chats : firstChat ? [firstChat] : [],
            activeChatId: hasChat ? phase.activeChatId || phase.chats[0]?.id || null : firstChat?.id || null,
          };
        }

        return phase;
      })
    );

    if (nextPhase) {
      setActivePhaseId(nextPhase.id);
      const nextChatId = nextPhase.activeChatId || nextPhase.chats[0]?.id || null;
      setActiveChatId(nextChatId);
      setMigrationStartTime(null);
      setInput("");
      resetTextareaHeight();
    }
  };

  const showLoadingBubble = isLoading || isTranscribing;
  const selectedPhaseStatusText = selectedPhase?.status === "completed" ? "已完成，只能查看" : selectedPhase?.status === "active" ? "進行中" : "尚未開始";

  return (
    <div className="flex h-screen bg-gray-50 text-gray-800 font-sans overflow-hidden">
      {!participantId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-2">請輸入受測者編號</h2>
            <p className="text-sm text-gray-500 mb-6">請輸入研究者提供的編號，例如 P001、P002。這個編號只會用來區分實驗資料。</p>

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

            <label className="block text-xs font-bold text-gray-500 mb-2">實驗分配模式</label>
            <select
              value={assignmentMode}
              onChange={(e) => setAssignmentMode(e.target.value as AssignmentMode)}
              className="w-full p-4 border border-gray-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/20 mb-4 bg-white"
            >
              <option value="between_subject">人多版：文字隨機 1 個情境，語音隨機 1 個情境</option>
              <option value="within_subject">人少版：文字全部情境，語音全部情境，順序平衡</option>
            </select>

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

      <aside className="w-72 bg-[#171717] text-white flex flex-col border-r border-white/10">
        <div className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-lg font-bold">L</div>
          <button
            onClick={createNewChat}
            disabled={!canInteract}
            className={`flex-1 p-2 border rounded-lg transition text-sm flex items-center justify-center gap-2 ${
              canInteract ? "border-white/20 hover:bg-white/10" : "border-white/10 text-gray-500 cursor-not-allowed"
            }`}
          >
            <Plus size={18} /> 新增對話
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-3">
          {phases.map((phase) => {
            const isSelectedPhase = phase.id === selectedPhase?.id;
            const isCurrent = phase.status === "active";
            const rounds = countPhaseRounds(phase);

            return (
              <div key={phase.id} className="border border-white/10 rounded-xl overflow-hidden">
                <button
                  onClick={() => selectPhaseChat(phase.id, phase.activeChatId || phase.chats[0]?.id || null)}
                  className={`w-full text-left p-3 transition ${isSelectedPhase ? "bg-[#252525]" : "bg-[#111] hover:bg-[#202020]"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-gray-400">{phase.missionTitle}</div>
                      <div className="text-sm font-bold text-gray-100 mt-1">{phase.phaseLabel}：{phase.title}</div>
                      <div className="text-[11px] text-gray-400 mt-1 truncate">{phase.conditionLabel}</div>
                    </div>
                    {phase.status === "completed" ? (
                      <CheckCircle2 size={16} className="text-green-400 flex-shrink-0 mt-1" />
                    ) : phase.status === "active" ? (
                      <span className="text-[10px] bg-blue-600 text-white px-2 py-1 rounded-full flex-shrink-0">進行中</span>
                    ) : (
                      <Lock size={14} className="text-gray-500 flex-shrink-0 mt-1" />
                    )}
                  </div>
                  {phase.minRounds > 0 && (
                    <div className="text-[11px] text-gray-500 mt-2">輪數：{rounds}/{phase.minRounds}</div>
                  )}
                </button>

                {phase.chats.length > 0 && (
                  <div className="bg-black/30 py-1">
                    {phase.chats.map((chat) => (
                      <button
                        key={chat.id}
                        onClick={() => selectPhaseChat(phase.id, chat.id)}
                        className={`w-full p-2 pl-5 text-left flex items-center gap-2 text-sm transition ${
                          chat.id === selectedChat?.id ? "bg-blue-600/25 text-white" : "text-gray-300 hover:bg-white/5"
                        }`}
                      >
                        <MessageSquare size={14} className="text-gray-500" />
                        <span className="truncate">{chat.title}</span>
                        {chat.locked && <Lock size={12} className="ml-auto text-gray-500" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-4 bg-[#0d0d0d] border-t border-white/10">
          <div className="flex items-center justify-between mb-3 text-gray-500">
            <span className="text-[10px] font-bold uppercase">研究工具</span>
            <button onClick={() => setShowDevPanel(!showDevPanel)}>{showDevPanel ? <EyeOff size={14} /> : <Eye size={14} />}</button>
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
                      if (devPassword === "1234") setIsUnlocked(true);
                      else setWarningMessage("開發工具密碼錯誤");
                    }}
                  >
                    <Lock size={12} />
                  </button>
                </div>
              ) : (
                <>
                  <div>分配模式: {assignmentInfo?.assignment_mode || assignmentMode}</div>
                  <div>文字: {assignmentInfo?.text_order || assignmentInfo?.text_condition || "-"}</div>
                  <div>語音: {assignmentInfo?.voice_order || assignmentInfo?.voice_condition || "-"}</div>
                  <div>目前 Phase 輪數: {phaseRounds}/{selectedPhase?.minRounds || 0}</div>
                  <div>Token: {debugData.tokens}/{config.token_threshold}</div>
                  <div>音量: {volume.toFixed(4)}</div>
                </>
              )}
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col bg-white min-w-0">
        <header className="h-14 border-b flex items-center justify-between px-6 bg-white/80 backdrop-blur-md sticky top-0 z-10 font-bold">
          <div className="truncate">
            {selectedPhase ? `${selectedPhase.missionTitle} - ${selectedPhase.phaseLabel}` : "實驗介面"}
          </div>
          <span className="text-xs text-gray-500 font-normal flex items-center gap-2">
受測者：{participantId || "未設定"}
            {participantId && (
              <button
                onClick={() => {
                  localStorage.removeItem("participant_id");
                  setParticipantId("");
                  setParticipantInput("");
                  setAssignmentInfo(null);
                  initializePhases(fallbackFlow);
                }}
                className="text-blue-600 hover:underline"
              >
                更換
              </button>
            )}
          </span>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {!selectedChat && selectedPhase?.mode === "read_only" && (
              <div className="p-6 rounded-3xl bg-gray-50 border text-gray-600 leading-relaxed">
                目前階段不需要聊天。請閱讀右側任務文件，完成後按右下角按鈕繼續。
              </div>
            )}

            {selectedChat?.messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`flex gap-4 max-w-[85%] ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      m.role === "user" ? "bg-blue-500" : "bg-emerald-600"
                    } text-white shadow-sm`}
                  >
                    {m.role === "user" ? <User size={16} /> : <Bot size={16} />}
                  </div>

                  <div
                    className={`p-4 rounded-2xl shadow-sm whitespace-pre-wrap break-words leading-relaxed ${
                      m.role === "user" ? "bg-blue-600 text-white" : "bg-[#f4f4f4] text-gray-800"
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

            {selectedChat?.summary && selectedPhase?.condition === "C" && selectedPhase.status === "active" && (
              <div className="mx-auto max-w-xl my-8 p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-100 rounded-3xl shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="flex items-center gap-2 mb-3 text-blue-800">
                  <RefreshCcw size={18} className="animate-spin-slow" />
                  <h3 className="font-bold">記憶遷移建議</h3>
                </div>

                <p className="text-sm text-blue-700 mb-5 leading-relaxed bg-white/50 p-3 rounded-xl border border-blue-50 whitespace-pre-wrap">
                  {selectedChat.summary}
                </p>

                <button
                  onClick={() => handleMigration(selectedChat.summary!)}
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
                <span className="font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{warningMessage}</span>
              </div>
            )}

            {showHint && currentCondition !== "A" && canInteract && (
              <div className="absolute -top-16 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs py-2 px-5 rounded-full shadow-xl animate-bounce z-20">
                偵測到停頓，若說完請停止
              </div>
            )}

            {selectedPhase && selectedPhase.status !== "active" && (
              <div className="mb-3 text-center text-sm text-gray-500 bg-gray-50 border rounded-2xl py-3">
                此階段{selectedPhase.status === "completed" ? "已完成，只能查看紀錄" : "尚未開始"}。
                {currentActivePhase && (
                  <button onClick={goToCurrentActivePhase} className="ml-2 text-blue-600 hover:underline">
                    回到目前進行中階段
                  </button>
                )}
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
                placeholder={canInteract ? "輸入訊息，Shift + Enter 換行" : "目前階段不能輸入"}
                className={`flex-1 resize-none max-h-[180px] min-h-[56px] overflow-y-auto p-4 border rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm transition-all leading-relaxed ${
                  canInteract ? "bg-white border-gray-200" : "bg-gray-100 border-gray-200 cursor-not-allowed text-gray-500"
                }`}
                disabled={!canInteract}
              />

              <button
                onClick={() => handleSend()}
                disabled={!canInteract || !input.trim()}
                className={`p-4 rounded-2xl transition-all shadow-sm ${
                  canInteract && input.trim() ? "bg-blue-600 text-white hover:bg-blue-700 active:scale-95" : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
                title="送出"
              >
                <Send size={22} />
              </button>

              <button
                onClick={() => (isRecording ? stopRecording(false) : startRecording())}
                disabled={!canInteract}
                className={`p-4 rounded-2xl transition-all shadow-sm ${
                  isRecording
                    ? "bg-red-500 text-white animate-pulse"
                    : canInteract
                    ? "bg-blue-50 text-blue-600 hover:bg-blue-100"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
                title={isRecording ? "停止錄音" : "語音輸入"}
              >
                {isRecording ? <Square size={22} fill="currentColor" /> : <Mic size={22} />}
              </button>
            </div>

            <div className="mt-2 text-xs text-gray-400 text-center">Enter 送出，Shift + Enter 換行</div>
          </div>
        </div>
      </main>

      <aside className="w-[380px] bg-gray-50 border-l flex flex-col">
        <div className="flex-1 overflow-y-auto p-5 border-b">
          <div className="flex items-center gap-2 text-gray-800 font-bold mb-3">
            <FileText size={18} /> 任務文件
          </div>
          <div className="text-xs text-gray-500 mb-4">
            {selectedPhase ? `${selectedPhase.missionTitle} / ${selectedPhase.phaseLabel} / ${selectedPhase.title}` : "尚未載入"}
          </div>
          <div className="bg-white border rounded-2xl p-4 text-sm leading-relaxed whitespace-pre-wrap text-gray-700 shadow-sm">
            {taskDoc}
          </div>
        </div>

        <div className="p-5 bg-white">
          <h3 className="font-bold text-gray-900 mb-4">目前任務進度</h3>

          {selectedPhase ? (
            <div className="space-y-3 text-sm">
              <InfoRow label="任務" value={selectedPhase.missionTitle} />
              <InfoRow label="情境" value={selectedPhase.conditionLabel} />
              <InfoRow label="階段" value={`${selectedPhase.phaseLabel}：${selectedPhase.title}`} />
              <InfoRow label="狀態" value={selectedPhaseStatusText} />
              <InfoRow label="完成條件" value={selectedPhase.minRounds > 0 ? `至少 ${selectedPhase.minRounds} 輪對話` : "閱讀完成即可繼續"} />
              <InfoRow label="目前進度" value={`${phaseRounds} / ${selectedPhase.minRounds} 輪`} />

              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: `${Math.min(100, selectedPhase.minRounds === 0 ? 100 : (phaseRounds / selectedPhase.minRounds) * 100)}%` }}
                />
              </div>

              {selectedPhase.status === "active" ? (
                <button
                  onClick={completeCurrentPhase}
                  disabled={!canCompletePhase}
                  className={`w-full py-3.5 rounded-xl font-bold transition-all ${
                    canCompletePhase ? "bg-blue-600 text-white hover:bg-blue-700 active:scale-95" : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  {canCompletePhase ? "完成此階段，進入下一階段" : "尚未完成最低輪數"}
                </button>
              ) : currentActivePhase ? (
                <button
                  onClick={goToCurrentActivePhase}
                  className="w-full py-3.5 rounded-xl font-bold bg-gray-900 text-white hover:bg-black active:scale-95 transition-all"
                >
                  返回目前進行中階段
                </button>
              ) : (
                <div className="w-full py-3.5 rounded-xl font-bold bg-green-50 text-green-700 text-center border border-green-100">
                  全部任務已完成
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-500">尚未載入實驗流程。</div>
          )}
        </div>
      </aside>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="font-medium text-gray-800 leading-snug">{value}</div>
    </div>
  );
}

function countPhaseRounds(phase?: ExperimentPhase | null) {
  if (!phase) return 0;

  return phase.chats.reduce((total, chat) => {
    const userCount = chat.messages.filter((m) => m.role === "user").length;
    const assistantCount = chat.messages.filter((m) => m.role === "assistant").length;
    return total + Math.min(userCount, assistantCount);
  }, 0);
}
