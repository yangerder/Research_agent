"use client";
import React, { useState, useEffect, useRef } from 'react';
import { Send, Plus, MessageSquare, User, Bot, Settings, Lock, Eye, EyeOff, Mic, Square } from 'lucide-react';
import { sendChatMessage, transcribeAudio } from '../services/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
}

export default function ChatPage() {
  // 核心狀態
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [scenario, setScenario] = useState<'A' | 'B'>('A');

  // 語音與 VAD 狀態
  const [isRecording, setIsRecording] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [volume, setVolume] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const requestRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  
  // 💡 關鍵變數：使用 Ref 避免 requestAnimationFrame 抓到舊狀態
  const frameCountRef = useRef(0);
  const isRecordingRef = useRef(false);

  // 開發者資訊面板狀態
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [devPassword, setDevPassword] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [debugData, setDebugData] = useState({ tokens: 0, rounds: 0 });
  const [config, setConfig] = useState({ 
    round_limit: 10, 
    token_threshold: 5000,
    vad_timeout_a: 0.5,
    vad_timeout_b: 2.0,
    vad_threshold: 0.05, 
    show_hint_b: true
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 抓取後端實驗設定
  useEffect(() => {
    fetch("http://localhost:8000/config")
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error("無法取得實驗設定", err));
  }, []);

  // 初始化對話
  useEffect(() => {
    if (chats.length === 0) createNewChat();
  }, []);

  // 自動捲動底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, isLoading]);

  const createNewChat = () => {
    const newId = Date.now().toString();
    const newChat: Chat = {
      id: newId,
      title: `新對話 ${chats.length + 1}`,
      messages: [],
    };
    setChats([newChat, ...chats]);
    setActiveChatId(newId);
  };

  const activeChat = chats.find(c => c.id === activeChatId) || chats[0];

  // --- 語音活動偵測 (VAD) 核心邏輯 ---
  const startVAD = (stream: MediaStream) => {
    console.log("%c[系統] VAD 監控已啟動", "color: #2196f3; font-weight: bold;");
    
    audioContextRef.current = new AudioContext();
    const source = audioContextRef.current.createMediaStreamSource(stream);
    analyserRef.current = audioContextRef.current.createAnalyser();
    analyserRef.current.fftSize = 256;
    source.connect(analyserRef.current);

    const checkVolume = () => {
      // 💡 檢查點：如果錄音已停止，立刻終止 VAD 迴圈
      if (!analyserRef.current || !isRecordingRef.current) return;

      const dataArray = new Float32Array(analyserRef.current.fftSize);
      analyserRef.current.getFloatTimeDomainData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
      const rms = Math.sqrt(sum / dataArray.length);
      setVolume(rms);

      const timeout = scenario === 'A' ? config.vad_timeout_a : config.vad_timeout_b;
      const threshold = config.vad_threshold; 

      // --- 持續噴 Debug 訊息 ---
      frameCountRef.current++;
      if (frameCountRef.current % 10 === 0) { 
        const bar = "█".repeat(Math.min(Math.floor(rms * 100), 10));
        const statusText = rms < threshold ? `🤫 靜音中 (${((Date.now() - (silenceStartRef.current || Date.now())) / 1000).toFixed(2)}s)` : "🗣️ 說話中";
        console.log(
            `%c[VAD Live] RMS: ${rms.toFixed(4)} | ${bar.padEnd(10, '░')} | ${statusText}`, 
            `color: ${rms < threshold ? '#ff9800' : '#4caf50'}`
        );
      }

      if (rms < threshold) {
        if (!silenceStartRef.current) silenceStartRef.current = Date.now();
        const silenceDuration = (Date.now() - silenceStartRef.current) / 1000;

        if (silenceDuration > timeout) {
          if (scenario === 'A') {
            // 情境 A：執行自動截斷
            console.log(`%c[VAD] 🚨 達到 ${timeout}s 限制！執行自動截斷`, "color: white; background: red; padding: 2px 5px;");
            silenceStartRef.current = null;
            stopRecording(true); 
            return; // 結束計時器
          } else if (scenario === 'B' && config.show_hint_b) {
            // 情境 B：顯示提示但不截斷
            if (!showHint) {
                console.log(`%c[VAD] 💡 情境 B 觸發靜音提示`, "color: white; background: #2196f3; padding: 2px 5px;");
                setShowHint(true);
            }
          }
        }
      } else {
        silenceStartRef.current = null;
        setShowHint(false); // 偵測到人聲時隱藏提示
      }

      requestRef.current = requestAnimationFrame(checkVolume);
    };
    checkVolume();
  };

  const startRecording = async () => {
    if (isLoading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const isAutoCutoff = silenceStartRef.current !== null;
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        
        console.log(`%c[系統] 錄音結束，觸發原因: ${isAutoCutoff ? "自動截斷 (auto_vad)" : "手動停止 (manual)"}`, "font-weight: bold; color: #2196f3");

        setIsLoading(true);
        try {
          const text = await transcribeAudio(audioBlob);
          if (text && text.trim()) {
            console.log(`[STT] 轉譯成功: "${text}"`);
            handleSend(text, isAutoCutoff ? "auto_vad" : "manual");
          }
        } catch (err) {
          console.error("[Error] 轉譯過程發生錯誤", err);
        } finally {
          setIsLoading(false);
          stream.getTracks().forEach(track => track.stop());
        }
      };

      isRecordingRef.current = true;
      setShowHint(false); 
      setIsRecording(true);
      mediaRecorder.start();
      startVAD(stream);
    } catch (err) {
      console.error("無法啟動錄音", err);
      alert("無法取得麥克風權限");
    }
  };

  const stopRecording = (isAuto = false) => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      if (!isAuto) silenceStartRef.current = null;
      
      isRecordingRef.current = false;
      setShowHint(false); 
      setIsRecording(false);
      mediaRecorderRef.current.stop();
      
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(e => console.error("關閉 AudioContext 失敗", e));
      }
    }
  };

  const handleSend = async (customText?: string, trigger: string = "manual") => {
    const messageContent = customText || input;
    if (!messageContent.trim() || !activeChatId || isLoading) return;

    const userMessage: Message = { role: 'user', content: messageContent };
    setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, messages: [...c.messages, userMessage] } : c));
    
    if (!customText) setInput('');
    setIsLoading(true);
    inputRef.current?.focus();

    try {
      const data = await sendChatMessage("user_123", messageContent, activeChat.messages, scenario, trigger);
      if (data.status === 'warning') {
        alert(data.message);
      } else {
        setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, messages: data.history } : c));
      }
      if (data.debug) setDebugData(data.debug);
    } catch (err) {
      console.error("傳送失敗", err);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-800">
      {/* 側邊欄 (省略不變，維持你的樣式) */}
      <div className="w-64 bg-[#171717] text-white flex flex-col border-r border-white/10">
        <div className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-lg font-bold border border-white/20">L</div>
          <button onClick={createNewChat} className="flex-1 flex items-center justify-center gap-2 p-2.5 border border-white/20 rounded-lg hover:bg-white/10 transition text-sm">
            <Plus size={18} /> 新增對話
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto mt-2 px-2">
          {chats.map(chat => (
            <div key={chat.id} onClick={() => setActiveChatId(chat.id)} className={`p-3 rounded-lg cursor-pointer flex items-center gap-3 mb-1 transition-colors ${activeChatId === chat.id ? 'bg-[#212121]' : 'hover:bg-[#212121]'}`}>
              <MessageSquare size={16} className="text-gray-400" />
              <span className="truncate text-sm text-gray-200">{chat.title}</span>
            </div>
          ))}
        </div>

        <div className="p-4 bg-[#0d0d0d] border-t border-white/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5"><Settings size={14} /> 開發者資訊</span>
            <button onClick={() => setShowDevPanel(!showDevPanel)} className="text-gray-500 hover:text-white">
              {showDevPanel ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          {showDevPanel && (
            <div className="space-y-3 mb-4">
              {!isUnlocked ? (
                <div className="flex gap-2">
                  <input type="password" placeholder="密碼" value={devPassword} onChange={(e) => setDevPassword(e.target.value)} className="w-full bg-[#212121] text-xs p-2 rounded-md border border-white/10 focus:outline-none" />
                  <button onClick={() => devPassword === '1234' ? setIsUnlocked(true) : alert('密碼錯誤')} className="bg-blue-600 p-2 rounded-md hover:bg-blue-700 transition"><Lock size={14} /></button>
                </div>
              ) : (
                <div className="text-[11px] font-mono bg-black/40 p-3 rounded-md text-green-400 space-y-1.5 border border-green-500/20">
                  <div className="flex justify-between">
                    <span>當前輪數:</span> 
                    <span className={debugData.rounds >= config.round_limit ? "text-red-500" : ""}>{debugData.rounds} / {config.round_limit}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Token 總計:</span> 
                    <span className={debugData.tokens >= config.token_threshold ? "text-red-500" : ""}>{debugData.tokens} / {config.token_threshold}</span>
                  </div>
                  <button onClick={() => {setIsUnlocked(false); setDevPassword('');}} className="w-full mt-2 text-center text-gray-500 hover:text-gray-300 underline">鎖定面板</button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] text-gray-500 uppercase font-bold">當前組別</label>
            <select value={scenario} onChange={(e) => setScenario(e.target.value as 'A' | 'B')} className="w-full bg-[#212121] text-sm p-2.5 rounded-lg border border-white/10 focus:outline-none">
              <option value="A">情境 A (隱性裁切)</option>
              <option value="B">情境 B (顯性告知)</option>
            </select>
          </div>
        </div>
      </div>

      {/* 主對話區 */}
      <div className="flex-1 flex flex-col bg-white">
        <header className="h-14 border-b flex items-center px-6 bg-white/80 backdrop-blur-md sticky top-0 z-10">
          <h2 className="font-bold text-gray-800">實驗對話介面 - <span className="text-blue-600">組別 {scenario}</span></h2>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {activeChat?.messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex gap-4 max-w-[85%] ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${m.role === 'user' ? 'bg-blue-500' : 'bg-emerald-600'} text-white`}>
                    {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                  </div>
                  <div className={`p-4 rounded-2xl shadow-sm leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-[#f4f4f4] text-gray-800'}`}>{m.content}</div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-600 text-white flex-shrink-0 shadow-sm"><Bot size={16} /></div>
                  <div className="p-4 rounded-2xl bg-[#f4f4f4] text-gray-800 flex items-center shadow-sm">
                    <div className="flex space-x-1.5 px-1">
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 輸入區域 */}
        <div className="p-4 md:p-6 bg-white border-t">
          <div className="max-w-3xl mx-auto relative">
            
            {/* 💡 修正：加入情境 B 的提示彈窗 */}
            {showHint && scenario === 'B' && (
                <div className="absolute -top-16 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs py-2.5 px-5 rounded-full shadow-xl animate-bounce flex items-center gap-2 z-20 border border-white/20">
                    <span className="animate-pulse">💡</span> 偵測到您已停頓一段時間，若說完請點擊停止按鈕
                </div>
            )}

            <div className="relative flex items-center gap-3">
              <div className="flex-1 relative">
                <input 
                  ref={inputRef}
                  type="text" 
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={isRecording ? "正在錄音並偵測停頓..." : (isLoading ? "AI 正在思考中..." : "輸入訊息...")}
                  className="w-full p-4 pr-14 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm disabled:bg-gray-50"
                  disabled={isLoading || isRecording}
                />
                <button onClick={() => handleSend()} disabled={isLoading || !input.trim() || isRecording} className="absolute right-3 top-2.5 p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors disabled:opacity-30">
                  <Send size={22} />
                </button>
              </div>
              
              <button 
                onClick={isRecording ? () => stopRecording(false) : startRecording}
                disabled={isLoading}
                className={`p-4 rounded-2xl transition-all relative group ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
              >
                {isRecording ? <Square size={22} fill="currentColor" /> : <Mic size={22} />}
                {isRecording && (
                  <div className="absolute -top-1 px-1 left-1/2 -translate-x-1/2 w-full h-1 bg-gray-200 rounded overflow-hidden">
                    <div className="bg-white h-full transition-all duration-75" style={{ width: `${Math.min(volume * 400, 100)}%` }}></div>
                  </div>
                )}
                <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {isRecording ? "點擊停止 (或等待自動截斷)" : "語音輸入 (VAD 偵測)"}
                </span>
              </button>
            </div>
            <p className="mt-3 text-center text-[11px] text-gray-400">
              {scenario === 'A' ? "隱性最佳化模式：系統將自動調整資源" : (config.show_hint_b ? "顯性賦權模式：系統限制將即時告知" : "實驗環境運行中")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}