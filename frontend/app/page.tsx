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
  saveParticipantState,
  logConversationMessages,
  logInteractionEvent,
  logResetEvent,
  logMigration,
  logPhaseCompletion,
  sendChatMessage,
  transcribeAudio,
  updateActionTiming,
  updateBaseline,
  completeExperiment,
  type AssignmentMode,
  type Scenario,
  type QualtricsStartPayload,
} from "../services/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  phaseId?: string;
  hidden?: boolean;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  summary?: string;
  locked?: boolean;
  createdAt: string;
}

interface QualtricsContext extends QualtricsStartPayload {
  enabled: boolean;
  rid: string;
  sid: string;
  qid: string;
  study: string;
  from_survey?: string;
  redirect_url?: string;
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
  mode: "text" | "voice" | "read_only" | "baseline";
  durationSeconds?: number | null;
  status: "locked" | "active" | "completed";
  startedAt?: string | null;
  endedAt?: string | null;
}

interface ExperimentMissionRun {
  id: string;
  displayTitle: string;
  internalTitle: string;
  condition: Scenario | null;
  conditionLabel: string;
  status: "locked" | "active" | "completed";
  phases: ExperimentPhase[];
  activePhaseId: string | null;
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
  mode: "text" | "voice" | "read_only" | "baseline";
  durationSeconds?: number | null;
}

const nowIso = () => new Date().toISOString();
const makeId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const createDefaultChat = (phaseTitle: string): Chat => ({
  id: makeId("chat"),
  title: phaseTitle.includes("住宿")
    ? "住宿比較"
    : phaseTitle.includes("語音")
      ? "語音討論"
      : "討論行程",
  messages: [],
  createdAt: nowIso(),
});

const PHASE0_TYPING_TEXT = "請依照畫面文字完整照抄，這段文字用來測量你的基準打字速度。完成後請按送出，系統會記錄打字時間與正確率。";
const PHASE0_SPEECH_TEXT = "請朗讀這段文字：我正在參與一項人工智慧協作實驗，接下來我會依照任務說明完成旅遊規劃與餐廳討論。";

const fallbackFlow: FlowPhaseConfig[] = [
  {
    id: "phase0_baseline",
    missionTitle: "Phase 0｜基準測試",
    condition: null,
    conditionLabel: "Baseline",
    phaseLabel: "Phase 0",
    title: "打字速度與語音節奏基準測試",
    taskDocId: "phase0_baseline",
    minRounds: 0,
    mode: "baseline",
  },
  {
    id: "intro",
    missionTitle: "實驗介紹",
    condition: null,
    conditionLabel: "說明",
    phaseLabel: "Info",
    title: "實驗內容介紹",
    taskDocId: "intro",
    minRounds: 0,
    mode: "read_only",
  },
  {
    id: "text_travel_b_phase_1",
    missionTitle: "文字旅遊",
    condition: "B",
    conditionLabel: "情境 B：使用者自行切換新對話",
    phaseLabel: "Phase 1",
    title: "初始旅遊規劃",
    taskDocId: "text_travel_phase_1",
    minRounds: 6,
    mode: "text",
  },
  {
    id: "text_travel_b_phase_2",
    missionTitle: "文字旅遊",
    condition: "B",
    conditionLabel: "情境 B：使用者自行切換新對話",
    phaseLabel: "Phase 2",
    title: "大量資訊整理任務",
    taskDocId: "text_travel_phase_2",
    minRounds: 4,
    mode: "text",
  },
  {
    id: "text_travel_b_phase_3",
    missionTitle: "文字旅遊",
    condition: "B",
    conditionLabel: "情境 B：使用者自行切換新對話",
    phaseLabel: "Phase 3",
    title: "突發變更與重新規劃",
    taskDocId: "text_travel_phase_3",
    minRounds: 6,
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


const QUALTRICS_REQUIRED_PARAMS = ["consent", "study", "token"] as const;
const QUALTRICS_OPTIONAL_ASSIGNMENT_PARAMS = ["text", "voice", "order"] as const;

function parseQualtricsParams(): { context: QualtricsContext | null; error: string | null; hasQualtricsParams: boolean } {
  if (typeof window === "undefined") return { context: null, error: null, hasQualtricsParams: false };
  const params = new URLSearchParams(window.location.search);
  const hasQualtricsParams = [...QUALTRICS_REQUIRED_PARAMS, ...QUALTRICS_OPTIONAL_ASSIGNMENT_PARAMS].some((key) => params.has(key)) || params.has("rid") || params.has("sid") || params.has("qid") || params.has("from") || params.has("redirect_url") || params.has("post_survey_url") || params.has("return_url");
  if (!hasQualtricsParams) return { context: null, error: null, hasQualtricsParams: false };

  const missing = QUALTRICS_REQUIRED_PARAMS.filter((key) => !params.get(key)?.trim());
  const rid = (params.get("rid") || params.get("sid") || "").trim();
  if (!rid) missing.push("rid" as any);
  if (missing.length > 0) {
    return { context: null, error: `Qualtrics URL 缺少必要參數：${missing.join(", ")}`, hasQualtricsParams: true };
  }

  const consent = params.get("consent") || "";
  if (!["yes", "y", "true", "1", "agree", "agreed"].includes(consent.trim().toLowerCase())) {
    return { context: null, error: "Qualtrics URL 顯示 consent 不是 yes，因此不能進入實驗。", hasQualtricsParams: true };
  }

  const text = (params.get("text") || "").trim().toUpperCase();
  const voice = (params.get("voice") || "").trim().toUpperCase();

  // text/voice/order are optional. When omitted, the backend randomizes using
  // backend/config.py. If supplied, allow either between-subject conditions
  // (A/B/C and A/B) or within-subject order strings (ABC... and AB/BA).
  if (text && !["A", "B", "C", "ABC", "ACB", "BAC", "BCA", "CAB", "CBA"].includes(text)) {
    return { context: null, error: `Qualtrics URL 的 text 條件/順序不合法：${text}`, hasQualtricsParams: true };
  }
  if (voice && !["A", "B", "C", "ABC", "ACB", "BAC", "BCA", "CAB", "CBA"].includes(voice)) {
    return { context: null, error: `Qualtrics URL 的 voice 條件/順序不合法：${voice}`, hasQualtricsParams: true };
  }

  const redirectUrl = params.get("redirect_url") || params.get("post_survey_url") || params.get("return_url") || "";
  const fromSurvey = params.get("from") || params.get("from_survey") || "";
  const context: QualtricsContext = {
    enabled: true,
    rid,
    sid: rid,
    qid: params.get("qid")?.trim() || rid,
    consent,
    study: params.get("study")!.trim(),
    text: text || undefined,
    voice: voice || undefined,
    order: params.get("order")?.trim() || undefined,
    token: params.get("token")!.trim(),
    from_survey: fromSurvey || undefined,
    from_: fromSurvey || undefined,
    redirect_url: redirectUrl,
    post_survey_url: redirectUrl,
    device_browser: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
  return { context, error: null, hasQualtricsParams: true };
}

function buildQualtricsReturnUrl(baseUrl: string, context: QualtricsContext, status = "completed") {
  if (!baseUrl) return "";
  const url = new URL(baseUrl, window.location.href);
  url.searchParams.set("rid", context.rid || context.sid);
  url.searchParams.set("completion", status);
  return url.toString();
}


const getTextRoundGuidance = (taskDocId: string, nextRound: number) => {
  const guidance: Record<string, string[]> = {
    text_travel_phase_1: [
      "第 1 輪：請 AI 先產生關西 5 天 4 夜的初版行程。",
      "第 2 輪：補充同行人數、預算與行程不要太趕的需求。",
      "第 3 輪：請 AI 檢查 USJ、京都、奈良是否都有合理安排。",
      "第 4 輪：補充朋友 A 膝蓋不好，請 AI 降低步行量與轉車負擔。",
      "第 5 輪：補充朋友 B 不吃牛肉，並請 AI 加入動漫、咖啡廳、夜景或在地小吃偏好。",
      "第 6 輪：請 AI 統整目前版本，確認每天安排、交通、餐飲與預算是否合理。",
    ],
    text_travel_phase_2: [
      "第 1 輪：請 AI 建立大阪 6 個住宿區域的比較表。",
      "第 2 輪：請 AI 補充各區前往 USJ、京都、奈良的交通便利性。",
      "第 3 輪：請 AI 從朋友 A 膝蓋不好、少走路、少轉車的角度重新排序。",
      "第 4 輪：請 AI 給出最推薦的住宿區域前 3 名，並說明原因。",
    ],
    text_travel_phase_3: [
      "第 1 輪：告訴 AI 朋友 A 膝蓋狀況更嚴重，需要進一步減少步行。",
      "第 2 輪：告訴 AI 朋友 B 臨時不參加，因此不吃牛肉不再是必要限制。",
      "第 3 輪：請 AI 在保留 USJ、京都、奈良的前提下重新調整每天行程。",
      "第 4 輪：請 AI 特別降低轉車、長距離步行與太趕的安排。",
      "第 5 輪：請 AI 重新檢查住宿、餐飲、交通與預算是否仍合理。",
      "第 6 輪：請 AI 輸出最終版完整行程，包含每天景點、交通、餐飲與膝蓋照顧方式。",
    ],
    text_travel_phase_a: [
      "第 1 輪：請 AI 先產生關西 5 天 4 夜的初版行程。",
      "第 2 輪：補充住宿難波、預算與行程不要太趕的需求。",
      "第 3 輪：請 AI 檢查 USJ、京都、奈良是否都有安排。",
      "第 4 輪：提醒 AI 同行者不能走太多路，請它降低步行量。",
      "第 5 輪：提醒 AI 不吃牛肉與動漫、咖啡廳、夜景、在地小吃偏好。",
      "第 6 輪：請 AI 統整目前版本，確認是否合理。",
    ],
    text_travel_phase_b: [
      "第 1 輪：請 AI 建立大阪住宿區域比較表。",
      "第 2 輪：請 AI 補充每個區域的交通、價格與夜生活差異。",
      "第 3 輪：請 AI 從少走路、少轉車與景點交通角度重新分析。",
      "第 4 輪：請 AI 給出最推薦的住宿區域前 3 名。",
    ],
    text_travel_phase_c: [
      "第 1 輪：告訴 AI 同行者膝蓋更不舒服，需要大幅減少步行。",
      "第 2 輪：告訴 AI 原本不吃牛肉的人不去了，飲食限制取消。",
      "第 3 輪：請 AI 保留 USJ、京都、奈良並重新安排。",
      "第 4 輪：請 AI 輸出調整後的完整行程與理由。",
    ],
  };
  const items = guidance[taskDocId] || [];
  return items[Math.max(0, nextRound - 1)] || "請依照右側任務文件，和 AI 完成這一輪討論。";
};

const getTextTransitionMessage = (phase?: ExperimentPhase | null) => {
  const taskDocId = phase?.taskDocId || "";
  if (taskDocId.includes("phase_1") || taskDocId.endsWith("phase_a")) {
    return "初步行程討論已完成。接下來，請把注意力轉到住宿區域與交通便利性，準備開始住宿規劃比較。";
  }
  if (taskDocId.includes("phase_2") || taskDocId.endsWith("phase_b")) {
    return "住宿比較已完成。接下來旅遊條件會發生變化：朋友的狀況需要重新調整整份行程。";
  }
  if (taskDocId.includes("phase_3") || taskDocId.endsWith("phase_c")) {
    return "文字旅遊任務已完成。接下來請依照指示填寫文字任務問卷。";
  }
  return "這個階段已完成。請按下繼續，進入下一個階段。";
};

export default function ChatPage() {
  const [participantId, setParticipantId] = useState("");
  const [participantInput, setParticipantInput] = useState("");
  const [qualtricsContext, setQualtricsContext] = useState<QualtricsContext | null>(null);
  const [qualtricsEntryError, setQualtricsEntryError] = useState<string | null>(null);
  const [qualtricsRedirectUrl, setQualtricsRedirectUrl] = useState<string>("");
  const [isCompletingExperiment, setIsCompletingExperiment] = useState(false);
  const [assignmentMode, setAssignmentMode] =
    useState<AssignmentMode>("between_subject");
  const [assignmentInfo, setAssignmentInfo] = useState<any>(null);

  const [missions, setMissions] = useState<ExperimentMissionRun[]>([]);
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [taskDoc, setTaskDoc] = useState("載入任務文件中...");
  const [dismissedRoundPromptKey, setDismissedRoundPromptKey] = useState<string | null>(null);
  const [typewriterText, setTypewriterText] = useState("");

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
  const recordingStartedAtRef = useRef<number | null>(null);
  const lastInterruptionAtRef = useRef<number | null>(null);
  const lastResponseT4ClientRef = useRef<number | null>(null);
  const pendingTextT5ClientRef = useRef<number | null>(null);
  const pendingVoiceT5ClientRef = useRef<number | null>(null);
  const pendingVoiceDurationMsRef = useRef<number | null>(null);
  const pendingWhisperSttMsRef = useRef<number>(0);
  const pendingInterruptionCountRef = useRef<number>(0);
  const silenceHintLoggedRef = useRef(false);
  const hasDetectedSpeechRef = useRef(false);

  // Condition C: Repairable VAD state/refs.
  // These refs keep the whole repairable VAD interaction within the same voice turn.
  const [repairGateOpen, setRepairGateOpen] = useState(false);
  const repairGateOpenRef = useRef(false);
  const conditionCTurnIdRef = useRef<string | null>(null);
  const conditionCVadTriggerCountRef = useRef(0);
  const conditionCRepairGateStartMsRef = useRef<number | null>(null);
  const conditionCTotalRepairGateDwellMsRef = useRef(0);
  const conditionCFinalRepairChoiceRef = useRef("not_applicable");
  const conditionCRepairGateShownThisTurnRef = useRef(0);

  const [migrationStartTime, setMigrationStartTime] = useState<number | null>(
    null,
  );
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [devPassword, setDevPassword] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [debugData, setDebugData] = useState({ tokens: 0, rounds: 0 });
  const [config, setConfig] = useState({
    round_limit: 3,
    token_threshold: 300,
    vad_timeout_a: 1.0,
    vad_timeout_b: 2.0,
    vad_timeout_c: 1.5,
    vad_threshold: 0.015,
    repair_gate_max_per_turn: 1,
    show_hint_b: true,
    dev_password: "1234",
  });


  const [phase0TypingInput, setPhase0TypingInput] = useState("");
  const [phase0TypingStartedAt, setPhase0TypingStartedAt] = useState<number | null>(null);
  const [phase0TypingResult, setPhase0TypingResult] = useState<{
    cpm: number;
    wpm: number;
    durationMs: number;
    accuracy: number;
  } | null>(null);
  const [phase0SpeechResult, setPhase0SpeechResult] = useState<{
    speechRatio: number;
    durationMs: number;
    voiceFrames: number;
    silenceFrames: number;
  } | null>(null);
  const [phase0Recording, setPhase0Recording] = useState(false);
  const phase0AudioContextRef = useRef<AudioContext | null>(null);
  const phase0AnalyserRef = useRef<AnalyserNode | null>(null);
  const phase0StreamRef = useRef<MediaStream | null>(null);
  const phase0IntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phase0SpeechStartedAtRef = useRef<number | null>(null);
  const phase0VoiceFramesRef = useRef(0);
  const phase0SilenceFramesRef = useRef(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedMission = useMemo(
    () => missions.find((m) => m.id === activeMissionId) || missions[0] || null,
    [missions, activeMissionId],
  );

  const currentActiveMission = useMemo(
    () => missions.find((m) => m.status === "active") || null,
    [missions],
  );

  const selectedPhase = useMemo(() => {
    if (!selectedMission) return null;
    return (
      selectedMission.phases.find(
        (p) => p.id === selectedMission.activePhaseId,
      ) ||
      selectedMission.phases[0] ||
      null
    );
  }, [selectedMission]);

  const selectedChat = useMemo(() => {
    if (!selectedMission) return null;
    return (
      selectedMission.chats.find((c) => c.id === activeChatId) ||
      selectedMission.chats[0] ||
      null
    );
  }, [selectedMission, activeChatId]);

  const isPhase0Selected = selectedPhase?.mode === "baseline";
  const phase0Completed = Boolean(phase0TypingResult && phase0SpeechResult);
  const currentCondition = selectedMission?.condition || "A";
  const phaseRounds = useMemo(
    () => countPhaseRounds(selectedPhase, selectedMission),
    [selectedPhase, selectedMission],
  );
  const isFixedTextRoundPhase = Boolean(
    selectedPhase?.mode === "text" && selectedPhase.minRounds > 0,
  );
  const isTextRoundLimitReached = Boolean(
    isFixedTextRoundPhase && phaseRounds >= (selectedPhase?.minRounds || 0),
  );
  const nextTextRound = Math.min(
    phaseRounds + 1,
    selectedPhase?.minRounds || phaseRounds + 1,
  );
  const roundPromptKey = selectedPhase
    ? `${selectedPhase.id}:${nextTextRound}:${phaseRounds}`
    : "";
  const showTextRoundPrompt = Boolean(
    isFixedTextRoundPhase &&
      selectedMission?.status === "active" &&
      !isTextRoundLimitReached &&
      roundPromptKey &&
      dismissedRoundPromptKey !== roundPromptKey,
  );
  const textRoundGuidance = selectedPhase
    ? getTextRoundGuidance(selectedPhase.taskDocId, nextTextRound)
    : "";
  const textTransitionMessage = getTextTransitionMessage(selectedPhase);
  const canCompletePhase = Boolean(
    selectedMission &&
    selectedPhase &&
    selectedMission.status === "active" &&
    (selectedPhase.mode === "baseline"
      ? phase0Completed
      : phaseRounds >= selectedPhase.minRounds),
  );
  const isViewingCurrentMission =
    selectedMission &&
    currentActiveMission &&
    selectedMission.id === currentActiveMission.id;
  const canInteract = Boolean(
    participantId &&
    selectedMission &&
    selectedPhase &&
    selectedChat &&
    selectedMission.status === "active" &&
    (selectedPhase.mode === "text" || selectedPhase.mode === "voice") &&
    isViewingCurrentMission &&
    !isTextRoundLimitReached &&
    !isLoading &&
    !isTranscribing,
  );

  const buildSurveyUrl = (rawUrl: string) => {
    const rid = (qualtricsContext?.rid || qualtricsContext?.sid || participantId || "").trim();

    const replaced = rawUrl
      .replace(/\{\s*rid\s*\}/gi, encodeURIComponent(rid))
      .replace(/\{\s*pid\s*\}/gi, encodeURIComponent(rid))
      .replace(/\{\s*subject_id\s*\}/gi, encodeURIComponent(rid))
      .replace(/\{\s*sid\s*\}/gi, encodeURIComponent(rid))
      .replace(/\{\s*qid\s*\}/gi, encodeURIComponent(rid));

    try {
      const url = new URL(replaced, window.location.href);
      if (rid) url.searchParams.set("rid", rid);
      url.searchParams.delete("PID");
      url.searchParams.delete("pid");
      url.searchParams.delete("sid");
      url.searchParams.delete("qid");
      url.searchParams.delete("study");
      url.searchParams.delete("task");
      return url.toString();
    } catch {
      return replaced;
    }
  };

  const splitUrlTrailingPunctuation = (value: string) => {
    const match = value.match(/^(.+?)([.,，。)）\]]*)$/);
    if (!match) return { urlPart: value, suffix: "" };
    return { urlPart: match[1], suffix: match[2] || "" };
  };

  const getFirstTaskDocUrl = (text: string) => {
    const match = text.match(/https?:\/\/[^\s]+/);
    if (!match) return "";
    const { urlPart } = splitUrlTrailingPunctuation(match[0]);
    return buildSurveyUrl(urlPart);
  };

  const renderTaskDocWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.split(urlRegex).map((part, index) => {
      if (!part.match(urlRegex)) {
        return <React.Fragment key={index}>{part}</React.Fragment>;
      }

      const { urlPart, suffix } = splitUrlTrailingPunctuation(part);
      const href = buildSurveyUrl(urlPart);
      return (
        <React.Fragment key={index}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline break-all hover:text-blue-800 font-medium"
          >
            {href}
          </a>
          {suffix}
        </React.Fragment>
      );
    });
  };

  useEffect(() => {
    try {
      const parsed = parseQualtricsParams();
      if (parsed.hasQualtricsParams) {
        if (parsed.error || !parsed.context) {
          setQualtricsEntryError(parsed.error || "Qualtrics URL 參數錯誤，無法進入實驗。");
          return;
        }
        setQualtricsContext(parsed.context);
        setQualtricsRedirectUrl(parsed.context.redirect_url || "");
        setParticipantId(parsed.context.sid);
        setParticipantInput(parsed.context.sid);
        setAssignmentMode("between_subject");
        localStorage.setItem("participant_id", parsed.context.sid);
        localStorage.setItem("assignment_mode", "between_subject");
        localStorage.setItem("qualtrics_context", JSON.stringify(parsed.context));
        loadExperimentForParticipant(parsed.context.sid, "between_subject", parsed.context);
        return;
      }

      const savedMode = localStorage.getItem(
        "assignment_mode",
      ) as AssignmentMode | null;
      if (savedMode === "between_subject" || savedMode === "within_subject" || savedMode === "single_study") {
        setAssignmentMode(savedMode);
      }

      const savedQualtrics = localStorage.getItem("qualtrics_context");
      if (savedQualtrics) {
        try {
          const context = JSON.parse(savedQualtrics) as QualtricsContext;
          if (context?.sid) {
            setQualtricsContext(context);
            setQualtricsRedirectUrl(context.redirect_url || "");
          }
        } catch {}
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
        setTaskDoc(
          "目前任務文件載入失敗，請通知研究者。你仍可依照右下角階段資訊進行任務。",
        );
      });
  }, [selectedPhase?.taskDocId]);

  useEffect(() => {
    if (!participantId || !selectedMission || !selectedPhase || !taskDoc) return;
    if (selectedMission.status !== "active") return;
    if ((qualtricsContext?.from_survey || (qualtricsContext as any)?.from_ || "").trim()) return;

    const isQuestionnairePhase =
      selectedPhase.taskDocId.includes("questionnaire") ||
      selectedPhase.title.includes("問卷");
    if (!isQuestionnairePhase) return;

    const surveyUrl = getFirstTaskDocUrl(taskDoc);
    if (!surveyUrl) return;

    const storageKey = `survey_auto_redirect_${participantId}_${selectedPhase.id}`;
    try {
      if (sessionStorage.getItem(storageKey) === "1") return;
      sessionStorage.setItem(storageKey, "1");
    } catch {}

    setWarningMessage("3 秒後將自動開啟問卷。若沒有跳轉，請點擊右側任務文件中的問卷連結。");
    const timer = window.setTimeout(() => {
      window.location.assign(surveyUrl);
    }, 3000);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantId, selectedMission?.status, selectedPhase?.id, selectedPhase?.taskDocId, selectedPhase?.title, taskDoc, qualtricsContext?.from_survey]);

  useEffect(() => {
    if (!isTextRoundLimitReached || !textTransitionMessage) {
      setTypewriterText("");
      return;
    }

    setTypewriterText("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTypewriterText(textTransitionMessage.slice(0, index));
      if (index >= textTransitionMessage.length) {
        window.clearInterval(timer);
      }
    }, 38);

    return () => window.clearInterval(timer);
  }, [isTextRoundLimitReached, selectedPhase?.id, textTransitionMessage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [missions, activeChatId, isLoading, isTranscribing, loadingText]);

  useEffect(() => {
    if (!participantId || missions.length === 0) return;

    const timer = setTimeout(() => {
      saveCurrentParticipantState().catch((err) => {
        console.warn("participant state save failed", err);
      });
    }, 400);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantId, assignmentMode, activeMissionId, activeChatId, missions]);

  const fetchConfig = async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000"}/config`,
      );
      if (!res.ok) throw new Error(`config status ${res.status}`);
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.warn("無法取得實驗設定，使用預設值", err);
    }
  };

  const loadExperimentForParticipant = async (
    pid: string,
    mode: AssignmentMode = assignmentMode,
    qualtrics?: QualtricsStartPayload | null,
  ) => {
    try {
      const data = await startExperiment(pid, mode, qualtrics || null);
      setAssignmentInfo(data.assignment || data);
      setAssignmentMode(data.assignment_mode || mode);
      if (data.qualtrics?.enabled) {
        setQualtricsContext((prev) => ({ ...((prev || {}) as any), ...data.qualtrics, enabled: true } as QualtricsContext));
        setQualtricsRedirectUrl(data.qualtrics.redirect_url || "");
      }

      if (data.saved_state?.missions?.length) {
        restoreParticipantState(data.saved_state);
      } else {
        initializeMissions(data.phases || fallbackFlow);
      }
    } catch (err) {
      console.warn("無法取得受測者實驗分配，使用前端 fallback flow", err);
      setAssignmentInfo({ assignment_mode: mode, fallback: true });
      initializeMissions(fallbackFlow);
    }
  };

  const initializeMissions = (flowPhases: FlowPhaseConfig[]) => {
    const phasesWithPhase0 = ensurePhase0Flow(flowPhases);
    const initialized = buildMissionRuns(phasesWithPhase0);
    setMissions(initialized);
    setActiveMissionId(initialized[0]?.id || null);
    setActiveChatId(initialized[0]?.activeChatId || null);
  };

  const restoreParticipantState = (savedState: any) => {
    const restoredMissions = Array.isArray(savedState.missions)
      ? savedState.missions
      : [];
    setMissions(restoredMissions);
    setActiveMissionId(
      savedState.active_mission_id ||
        restoredMissions.find(
          (m: ExperimentMissionRun) => m.status === "active",
        )?.id ||
        restoredMissions[0]?.id ||
        null,
    );
    setActiveChatId(
      savedState.active_chat_id ||
        restoredMissions.find(
          (m: ExperimentMissionRun) => m.status === "active",
        )?.activeChatId ||
        restoredMissions[0]?.activeChatId ||
        null,
    );
  };

  const saveCurrentParticipantState = async () => {
    if (!participantId || missions.length === 0) return;

    await saveParticipantState({
      participant_id: participantId,
      assignment_mode: assignmentMode,
      assignment: assignmentInfo,
      active_mission_id: activeMissionId,
      active_chat_id: activeChatId,
      missions,
    });
  };

  const trackInteractionEvent = async (
    eventType: string,
    extra: Record<string, any> = {},
  ) => {
    if (!participantId) return;

    try {
      await logInteractionEvent({
        participant_id: participantId,
        assignment_mode: assignmentMode,
        event_type: eventType,
        mission_id: selectedMission?.id || null,
        mission_title: selectedMission?.displayTitle || null,
        phase_id: selectedPhase?.id || null,
        phase_label: selectedPhase?.phaseLabel || null,
        chat_id: selectedChat?.id || null,
        condition: selectedMission?.condition || null,
        event_time_client: nowIso(),
        ...extra,
      });
    } catch (err) {
      console.warn(`interaction event log failed: ${eventType}`, err);
    }
  };

  const markResumeAfterInterruption = async (
    eventType = "resume_after_interruption",
  ) => {
    if (!lastInterruptionAtRef.current) return;

    const recoveryTimeMs = Date.now() - lastInterruptionAtRef.current;
    lastInterruptionAtRef.current = null;

    await trackInteractionEvent(eventType, {
      trigger_type: "manual",
      recovery_time_ms: recoveryTimeMs,
    });
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

  const selectMissionChat = (missionId: string, chatId: string | null) => {
    const mission = missions.find((m) => m.id === missionId);
    setActiveMissionId(missionId);
    setActiveChatId(
      chatId || mission?.activeChatId || mission?.chats[0]?.id || null,
    );
    setWarningMessage(null);
  };

  const goToCurrentActiveMission = () => {
    if (!currentActiveMission) return;
    setActiveMissionId(currentActiveMission.id);
    setActiveChatId(
      currentActiveMission.activeChatId ||
        currentActiveMission.chats[0]?.id ||
        null,
    );
  };

  const createNewChat = () => {
    if (!currentActiveMission) return;

    if (
      !selectedMission ||
      selectedMission.id !== currentActiveMission.id ||
      selectedMission.status !== "active"
    ) {
      setWarningMessage("只能在目前進行中的任務新增對話");
      goToCurrentActiveMission();
      return;
    }

    if (!selectedPhase || selectedPhase.mode === "read_only") {
      setWarningMessage("目前階段不需要新增對話");
      return;
    }

    const newChat: Chat = {
      id: makeId("chat"),
      title: `新對話 ${selectedMission.chats.length + 1}`,
      messages: [],
      createdAt: nowIso(),
    };

    setMissions((prev) =>
      prev.map((mission) =>
        mission.id === selectedMission.id
          ? {
              ...mission,
              chats: [newChat, ...mission.chats],
              activeChatId: newChat.id,
            }
          : mission,
      ),
    );
    setActiveChatId(newChat.id);
    setWarningMessage(null);
  };

  const updateSelectedChat = (updater: (chat: Chat) => Chat) => {
    if (!selectedMission || !selectedChat) return;

    setMissions((prev) =>
      prev.map((mission) =>
        mission.id === selectedMission.id
          ? {
              ...mission,
              chats: mission.chats.map((chat) =>
                chat.id === selectedChat.id ? updater(chat) : chat,
              ),
            }
          : mission,
      ),
    );
  };


  const computeTypingAccuracy = (target: string, typed: string) => {
    if (!target.length) return 0;
    let correct = 0;
    for (let i = 0; i < target.length; i += 1) {
      if (typed[i] === target[i]) correct += 1;
    }
    return Math.round((correct / target.length) * 10000) / 100;
  };

  const submitPhase0Typing = async () => {
    if (!participantId) {
      setWarningMessage("請先輸入受測者編號");
      return;
    }
    if (!phase0TypingStartedAt) {
      setWarningMessage("請先開始打字測試");
      return;
    }
    const typed = phase0TypingInput.trim();
    if (!typed) {
      setWarningMessage("請先照抄文字後再送出");
      return;
    }
    const durationMs = Math.max(1, Date.now() - phase0TypingStartedAt);
    const minutes = durationMs / 60000;
    const cpm = Math.round((typed.length / minutes) * 100) / 100;
    const wpm = Math.round(((typed.trim().split(/\s+/).filter(Boolean).length || typed.length / 5) / minutes) * 100) / 100;
    const accuracy = computeTypingAccuracy(PHASE0_TYPING_TEXT, typed);
    const result = { cpm, wpm, durationMs, accuracy };
    setPhase0TypingResult(result);
    try {
      await updateBaseline({
        participant_id: participantId,
        baseline_typing_wpm: wpm,
        baseline_typing_cpm_chinese: cpm,
        baseline_typing_duration_ms: durationMs,
        baseline_typing_accuracy: accuracy,
        raw_baseline_json: {
          typing_target: PHASE0_TYPING_TEXT,
          typing_input: typed,
          typing_result: result,
        },
      });
    } catch (err) {
      console.warn("baseline typing save failed", err);
      setWarningMessage("打字基準測試儲存失敗，請通知研究者。");
    }
  };

  const startPhase0SpeechRecording = async () => {
    if (!participantId) {
      setWarningMessage("請先輸入受測者編號");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      phase0StreamRef.current = stream;
      phase0AudioContextRef.current = audioContext;
      phase0AnalyserRef.current = analyser;
      phase0VoiceFramesRef.current = 0;
      phase0SilenceFramesRef.current = 0;
      phase0SpeechStartedAtRef.current = Date.now();
      setPhase0SpeechResult(null);
      setPhase0Recording(true);
      await trackInteractionEvent("baseline_speech_start", {
        trigger_type: "phase0_speech_recording_start",
        details: {
          vad_threshold: config.vad_threshold,
          frame_interval_ms: 20,
        },
      });

      const sample = () => {
        if (!phase0AnalyserRef.current) return;
        const dataArray = new Float32Array(phase0AnalyserRef.current.fftSize);
        phase0AnalyserRef.current.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i += 1) sum += dataArray[i] * dataArray[i];
        const rms = Math.sqrt(sum / dataArray.length);
        const rawVadThreshold = Number(config.vad_threshold);
        const normalizedVadThreshold =
          Number.isFinite(rawVadThreshold) && rawVadThreshold > 1
            ? rawVadThreshold / 1000
            : rawVadThreshold;
        const effectiveVadThreshold =
          Number.isFinite(normalizedVadThreshold) && normalizedVadThreshold > 0
            ? normalizedVadThreshold
            : 0.015;
        setVolume(rms);
        if (rms >= effectiveVadThreshold) phase0VoiceFramesRef.current += 1;
        else phase0SilenceFramesRef.current += 1;
      };

      phase0IntervalRef.current = setInterval(sample, 20);
    } catch (err) {
      console.warn("baseline speech recording failed", err);
      setWarningMessage("無法取得麥克風權限，請檢查瀏覽器設定。");
    }
  };

  const stopPhase0SpeechRecording = async () => {
    if (!phase0Recording) return;
    if (phase0IntervalRef.current) clearInterval(phase0IntervalRef.current);
    phase0IntervalRef.current = null;
    const durationMs = phase0SpeechStartedAtRef.current
      ? Date.now() - phase0SpeechStartedAtRef.current
      : 0;
    const voiceFrames = phase0VoiceFramesRef.current;
    const silenceFrames = phase0SilenceFramesRef.current;
    const speechRatio = Math.round((voiceFrames / Math.max(1, silenceFrames)) * 10000) / 10000;
    const result = { speechRatio, durationMs, voiceFrames, silenceFrames };
    setPhase0SpeechResult(result);
    setPhase0Recording(false);

    phase0StreamRef.current?.getTracks().forEach((track) => track.stop());
    phase0StreamRef.current = null;
    if (phase0AudioContextRef.current) await phase0AudioContextRef.current.close();
    phase0AudioContextRef.current = null;
    phase0AnalyserRef.current = null;

    try {
      await updateBaseline({
        participant_id: participantId,
        baseline_speech_ratio: speechRatio,
        baseline_speech_duration_ms: durationMs,
        baseline_voice_frames: voiceFrames,
        baseline_silence_frames: silenceFrames,
        raw_baseline_json: {
          speech_prompt: PHASE0_SPEECH_TEXT,
          speech_result: result,
          frame_interval_ms: 20,
          vad_threshold: config.vad_threshold,
        },
      });
    } catch (err) {
      console.warn("baseline speech save failed", err);
      setWarningMessage("語音基準測試儲存失敗，請通知研究者。");
    }
  };

  
const openConditionCRepairGate = async (silenceDurationMs: number) => {
  if (repairGateOpenRef.current || currentCondition !== "C") return;
  const recorder = mediaRecorderRef.current;
  if (!recorder || recorder.state === "inactive") return;

  const repairGateMaxPerTurn = Math.max(
    1,
    Number((config as any).repair_gate_max_per_turn ?? 1) || 1,
  );
  if (conditionCRepairGateShownThisTurnRef.current >= repairGateMaxPerTurn) {
    silenceStartRef.current = null;
    return;
  }

  conditionCRepairGateShownThisTurnRef.current += 1;
  conditionCVadTriggerCountRef.current += 1;
  conditionCRepairGateStartMsRef.current = performance.now();
  repairGateOpenRef.current = true;
  setRepairGateOpen(true);
  setShowHint(false);

  try {
    if (recorder.state === "recording") recorder.pause();
  } catch (err) {
    console.warn("MediaRecorder.pause failed; continuing with blob accumulation", err);
  }

  await trackInteractionEvent("repair_gate_shown", {
    trigger_type: "repair_gate_shown",
    silence_duration_ms: silenceDurationMs,
    details: {
      turn_id: conditionCTurnIdRef.current,
      condition: "Condition_C",
      silence_duration_ms: silenceDurationMs,
      rms_threshold: config.vad_threshold,
      vad_trigger_index: conditionCVadTriggerCountRef.current,
      timestamp_ms: performance.now(),
    },
  });
};

const continueConditionCSpeaking = async () => {
  if (!repairGateOpenRef.current) return;
  const nowMs = performance.now();
  const dwellMs = conditionCRepairGateStartMsRef.current
    ? nowMs - conditionCRepairGateStartMsRef.current
    : 0;
  conditionCTotalRepairGateDwellMsRef.current += dwellMs;

  await trackInteractionEvent("repair_gate_decision", {
    trigger_type: "continue_speaking",
    details: {
      turn_id: conditionCTurnIdRef.current,
      condition: "Condition_C",
      vad_trigger_index: conditionCVadTriggerCountRef.current,
      user_choice: "continue_speaking",
      reaction_time_ms: Math.round(dwellMs),
      timestamp_ms: nowMs,
    },
  });

  repairGateOpenRef.current = false;
  setRepairGateOpen(false);
  conditionCRepairGateStartMsRef.current = null;
  silenceStartRef.current = null;
  hasDetectedSpeechRef.current = false;

  try {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
    }
  } catch (err) {
    console.warn("MediaRecorder.resume failed", err);
  }
};

const sendConditionCNow = async () => {
  if (!repairGateOpenRef.current) return;
  const nowMs = performance.now();
  const dwellMs = conditionCRepairGateStartMsRef.current
    ? nowMs - conditionCRepairGateStartMsRef.current
    : 0;
  conditionCTotalRepairGateDwellMsRef.current += dwellMs;
  conditionCFinalRepairChoiceRef.current = "send_now_clicked";

  await trackInteractionEvent("repair_gate_decision", {
    trigger_type: "send_now",
    details: {
      turn_id: conditionCTurnIdRef.current,
      condition: "Condition_C",
      vad_trigger_index: conditionCVadTriggerCountRef.current,
      user_choice: "send_now",
      reaction_time_ms: Math.round(dwellMs),
      timestamp_ms: nowMs,
    },
  });

  repairGateOpenRef.current = false;
  setRepairGateOpen(false);
  conditionCRepairGateStartMsRef.current = null;
  stopRecording(false);
};

  
const startVAD = (stream: MediaStream) => {
  audioContextRef.current = new AudioContext();
  const source = audioContextRef.current.createMediaStreamSource(stream);
  analyserRef.current = audioContextRef.current.createAnalyser();
  analyserRef.current.fftSize = 256;
  source.connect(analyserRef.current);

  const checkVolume = () => {
    if (!analyserRef.current || !isRecordingRef.current) return;
    if (repairGateOpenRef.current) {
      requestRef.current = requestAnimationFrame(checkVolume);
      return;
    }

    const dataArray = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i += 1) sum += dataArray[i] * dataArray[i];
    const rms = Math.sqrt(sum / dataArray.length);
    setVolume(rms);

    const now = Date.now();
    const rawVadThreshold = Number(config.vad_threshold);
    const normalizedVadThreshold = Number.isFinite(rawVadThreshold) && rawVadThreshold > 1 ? rawVadThreshold / 1000 : rawVadThreshold;
    const effectiveVadThreshold = Number.isFinite(normalizedVadThreshold) && normalizedVadThreshold > 0 ? normalizedVadThreshold : 0.015;
    const effectiveTimeout = currentCondition === "A" ? config.vad_timeout_a : currentCondition === "C" ? config.vad_timeout_c : config.vad_timeout_b;

    if (rms >= effectiveVadThreshold) {
      hasDetectedSpeechRef.current = true;
      silenceStartRef.current = null;
      setShowHint(false);
    } else if (hasDetectedSpeechRef.current) {
      if (!silenceStartRef.current) silenceStartRef.current = now;
      const silenceDurationMs = now - silenceStartRef.current;
      if (silenceDurationMs / 1000 > effectiveTimeout) {
        if (currentCondition === "A") {
          stopRecording(true);
          return;
        }
        if (currentCondition === "C") {
          void openConditionCRepairGate(silenceDurationMs);
          silenceStartRef.current = null;
        } else if (currentCondition === "B") {
          // Voice B is pure manual control: never show a silence hint,
          // never pause, and never auto-submit because of silence.
          silenceStartRef.current = null;
          setShowHint(false);
        } else {
          setShowHint(true);
          if (!silenceHintLoggedRef.current) {
            silenceHintLoggedRef.current = true;
            void trackInteractionEvent("silence_hint_shown", {
              trigger_type: "manual_voice_submit",
              silence_duration_ms: silenceDurationMs,
              details: {
                vad_threshold: config.vad_threshold,
                vad_timeout_seconds: config.vad_timeout_b,
              },
            });
          }
        }
      }
    } else {
      silenceStartRef.current = null;
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
      conditionCTurnIdRef.current = makeId("voice_turn");
      conditionCVadTriggerCountRef.current = 0;
      conditionCTotalRepairGateDwellMsRef.current = 0;
      conditionCFinalRepairChoiceRef.current = "not_applicable";
      conditionCRepairGateStartMsRef.current = null;
      conditionCRepairGateShownThisTurnRef.current = 0;
      repairGateOpenRef.current = false;
      setRepairGateOpen(false);

      silenceStartRef.current = null;
      silenceHintLoggedRef.current = false;
      hasDetectedSpeechRef.current = false;
      setShowHint(false);
      recordingStartedAtRef.current = Date.now();
      pendingVoiceT5ClientRef.current = performance.now();
      await markResumeAfterInterruption("recording_start_after_interruption");
      void trackInteractionEvent("recording_start", {
        trigger_type: "manual",
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const isAuto = silenceStartRef.current !== null;
        const recordingDurationMs = recordingStartedAtRef.current
          ? Date.now() - recordingStartedAtRef.current
          : null;

        try {
          setIsTranscribing(true);
          setLoadingText("正在轉換語音");

          const transcription = await transcribeAudio(
            new Blob(chunksRef.current, { type: "audio/webm" }),
          );
          const text = transcription.text || "";
          pendingWhisperSttMsRef.current = transcription.whisper_stt_ms || 0;
          pendingVoiceDurationMsRef.current = recordingDurationMs || 0;
          pendingInterruptionCountRef.current = isAuto ? 1 : 0;
          const isConditionCVoice = currentCondition === "C";
          const conditionCPureSpeechDurationMs = isConditionCVoice
            ? Math.max(0, (recordingDurationMs || 0) - conditionCTotalRepairGateDwellMsRef.current)
            : 0;


          void trackInteractionEvent(
            isAuto ? "auto_vad_transcribed" : "manual_recording_transcribed",
            {
              trigger_type: isAuto ? "auto_vad" : "manual_voice_submit",
              recording_duration_ms: recordingDurationMs,
              text_length: text?.trim()?.length || 0,
              details: {
                whisper_stt_ms: transcription.whisper_stt_ms || 0,
              },
            },
          );

          if (text?.trim()) {
            await handleSend(text, isAuto ? "auto_vad" : "manual_voice_submit");
          } else if (isAuto) {
            void trackInteractionEvent("auto_vad_empty_transcription", {
              trigger_type: "auto_vad",
              recording_duration_ms: recordingDurationMs,
            });
          }
        } catch (err) {
          console.error("語音轉文字失敗", err);
          setWarningMessage("語音轉文字失敗，請改用文字輸入。");
        } finally {
          setIsTranscribing(false);
          setLoadingText("AI 正在回覆中");
          recordingStartedAtRef.current = null;
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
      const stoppedAt = Date.now();
      const recordingDurationMs = recordingStartedAtRef.current
        ? stoppedAt - recordingStartedAtRef.current
        : null;
      const silenceDurationMs = silenceStartRef.current
        ? stoppedAt - silenceStartRef.current
        : null;

      isRecordingRef.current = false;
      setIsRecording(false);

      if (isAuto) {
        lastInterruptionAtRef.current = stoppedAt;
        void trackInteractionEvent("vad_cutoff", {
          trigger_type: "auto_vad",
          recording_duration_ms: recordingDurationMs,
          silence_duration_ms: silenceDurationMs,
          details: {
            note: "VAD stopped recording automatically after silence threshold.",
            vad_threshold: config.vad_threshold,
            vad_timeout_seconds: config.vad_timeout_a,
          },
        });
      } else {
        void trackInteractionEvent("manual_stop_recording", {
          trigger_type: "manual",
          recording_duration_ms: recordingDurationMs,
          silence_duration_ms: silenceDurationMs,
        });
      }

      mediaRecorderRef.current.stop();

      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      if (!isAuto) silenceStartRef.current = null;
    }
  };

  const markTextReengagement = () => {
    if (pendingTextT5ClientRef.current === null && lastResponseT4ClientRef.current !== null) {
      pendingTextT5ClientRef.current = performance.now();
    }
  };

  const handleSend = async (customText?: string, trigger = "manual_button") => {
    const messageContent = customText || input;

    if (!participantId) {
      setWarningMessage("請先輸入受測者編號");
      return;
    }

    if (
      !selectedMission ||
      !selectedPhase ||
      !selectedChat ||
      !selectedMission.condition
    ) {
      setWarningMessage("目前階段不能送出訊息");
      return;
    }

    if (!canInteract || !messageContent.trim()) return;

    if (trigger === "manual" || trigger === "manual_enter" || trigger === "manual_button") {
      await markResumeAfterInterruption("manual_message_after_interruption");
    }

    const messageSendEventType =
      trigger === "auto_vad"
        ? "auto_vad_message_send"
        : trigger === "manual_voice_submit"
          ? "manual_voice_submit"
          : "manual_message_send";

    void trackInteractionEvent(messageSendEventType, {
      trigger_type: trigger,
      text_length: messageContent.trim().length,
      details:
        trigger === "auto_vad" || trigger === "manual_voice_submit"
          ? {
              voice_duration_ms: pendingVoiceDurationMsRef.current,
              whisper_stt_ms: pendingWhisperSttMsRef.current,
              interruption_count: pendingInterruptionCountRef.current,
            }
          : undefined,
    });

    const historyBeforeSend = selectedChat.messages
      .filter((msg) => !msg.hidden)
      .map(({ role, content }) => ({ role, content }));

    updateSelectedChat((chat) => ({
      ...chat,
      messages: [
        ...chat.messages,
        { role: "user", content: messageContent, phaseId: selectedPhase.id },
      ],
    }));

    if (!customText) {
      setInput("");
      setTimeout(resetTextareaHeight, 0);
    }

    setWarningMessage(null);
    setIsLoading(true);
    setLoadingText("AI 正在回覆中");

    let summaryTimer: ReturnType<typeof setTimeout> | null = null;

    if (selectedMission.condition === "C") {
      summaryTimer = setTimeout(() => {
        setLoadingText("正在檢查記憶上限，可能正在生成摘要");
      }, 2500);
    }

    try {
      const previousT4ClientMs = lastResponseT4ClientRef.current;
      const t5ClientMs =
        trigger === "auto_vad" || trigger === "manual_voice_submit"
          ? pendingVoiceT5ClientRef.current || performance.now()
          : pendingTextT5ClientRef.current || performance.now();
      const userReengagementMs = previousT4ClientMs
        ? Math.max(0, t5ClientMs - previousT4ClientMs)
        : 0;
      const t1ClientMs = performance.now();
      const voiceDurationMs =
        trigger === "auto_vad" || trigger === "manual_voice_submit"
          ? pendingVoiceDurationMsRef.current
          : null;
      const whisperSttMs =
        trigger === "auto_vad" || trigger === "manual_voice_submit"
          ? pendingWhisperSttMsRef.current
          : 0;
      const interruptionCount =
        trigger === "auto_vad" ? Math.max(1, pendingInterruptionCountRef.current || 1) : 0;

      const data = await sendChatMessage(
        participantId,
        messageContent,
        historyBeforeSend,
        selectedMission.condition,
        trigger,
        selectedChat.id,
        selectedPhase.id,
        {
          mission_id: selectedMission.id,
          mission_title: selectedMission.displayTitle,
          phase_label: selectedPhase.phaseLabel,
          task_type: selectedPhase.mode === "voice" ? "Voice_Restaurant" : "Text_Travel",
          current_phase: Number(selectedPhase.phaseLabel.replace("Phase", "").trim()) || 0,
          turn_count: phaseRounds + 1,
          input_method: customText ? "Voice" : "Text",
          t1_client_ms: t1ClientMs,
          t5_client_ms: t5ClientMs,
          previous_t4_client_ms: previousT4ClientMs,
          user_reengagement_ms: userReengagementMs,
          voice_duration_ms: voiceDurationMs,
          whisper_stt_ms: whisperSttMs,
          interruption_count: interruptionCount,
            turn_id: currentCondition === "C" ? conditionCTurnIdRef.current : undefined,
            vad_trigger_count: currentCondition === "C" ? conditionCVadTriggerCountRef.current : 0,
            final_repair_choice: currentCondition === "C" ? conditionCFinalRepairChoiceRef.current : "not_applicable",
            total_repair_gate_dwell_ms: currentCondition === "C" ? Math.round(conditionCTotalRepairGateDwellMsRef.current) : 0,
            pure_speech_duration_ms: currentCondition === "C" && voiceDurationMs ? Math.max(0, Math.round(voiceDurationMs - conditionCTotalRepairGateDwellMsRef.current)) : 0,
            final_transcript: currentCondition === "C" ? messageContent : "",
            final_audio_file_path: "",
            auto_submitted: trigger === "auto_vad" ? 1 : 0,
        },
      );

      if (data.status === "warning") {
        setWarningMessage(data.message);

        updateSelectedChat((chat) => ({
          ...chat,
          summary: data.summary || chat.summary,
        }));

        if (
          data.summary &&
          selectedMission.condition === "C" &&
          !migrationStartTime
        ) {
          setMigrationStartTime(Date.now());
        }
      } else {
        updateSelectedChat((chat) => ({
          ...chat,
          messages:
            selectedMission.condition === "A"
              ? applyConditionAResponse(chat, data.history || [], selectedPhase.id, config.round_limit)
              : appendLatestAssistantToChat(chat, data.history || [], selectedPhase.id),
          summary: data.summary || chat.summary,
        }));

        if (
          data.summary &&
          selectedMission.condition === "C" &&
          !migrationStartTime
        ) {
          setMigrationStartTime(Date.now());
        }
      }

      if (data.debug) setDebugData(data.debug);

      const returnedHistory = Array.isArray(data.history) ? data.history : [];
      let messagesToLog: { message_index: number; role: "user" | "assistant"; content: string }[] = [];

      if (selectedMission.condition === "A") {
        const lastAssistant = [...returnedHistory]
          .reverse()
          .find((msg) => msg?.role === "assistant" && msg?.content);

        messagesToLog = [
          {
            message_index: selectedChat.messages.length,
            role: "user",
            content: messageContent,
          },
        ];

        if (lastAssistant?.content) {
          messagesToLog.push({
            message_index: selectedChat.messages.length + 1,
            role: "assistant",
            content: lastAssistant.content,
          });
        }
      } else {
        const newReturnedMessages = returnedHistory.slice(historyBeforeSend.length);
        messagesToLog = newReturnedMessages.map((msg: Message, offset: number) => ({
          message_index: historyBeforeSend.length + offset,
          role: msg.role,
          content: msg.content,
        }));

        if (messagesToLog.length === 0) {
          messagesToLog = [
            {
              message_index: historyBeforeSend.length,
              role: "user",
              content: messageContent,
            },
          ];
        }
      }

      await logConversationMessages({
        participant_id: participantId,
        assignment_mode: assignmentMode,
        mission_id: selectedMission.id,
        mission_title: selectedMission.displayTitle,
        phase_id: selectedPhase.id,
        phase_label: selectedPhase.phaseLabel,
        chat_id: selectedChat.id,
        condition: selectedMission.condition,
        trigger_type: trigger,
        messages: messagesToLog,
      });

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      const t4ClientMs = performance.now();
      lastResponseT4ClientRef.current = t4ClientMs;

      if (data.action_log_id) {
        try {
          await updateActionTiming({
            action_log_id: Number(data.action_log_id),
            t1_client_ms: t1ClientMs,
            t4_client_ms: t4ClientMs,
            t5_client_ms: t5ClientMs,
            previous_t4_client_ms: previousT4ClientMs,
            user_reengagement_ms: userReengagementMs,
          });
        } catch (timingErr) {
          console.warn("action timing update failed", timingErr);
        }
      }

      if (trigger === "manual" || trigger === "manual_enter" || trigger === "manual_button") {
        pendingTextT5ClientRef.current = null;
      }

      if (trigger === "auto_vad" || trigger === "manual_voice_submit") {
        pendingVoiceT5ClientRef.current = null;
        pendingVoiceDurationMsRef.current = null;
        pendingWhisperSttMsRef.current = 0;
        pendingInterruptionCountRef.current = 0;
        conditionCTurnIdRef.current = null;
        conditionCVadTriggerCountRef.current = 0;
        conditionCFinalRepairChoiceRef.current = "not_applicable";
        conditionCTotalRepairGateDwellMsRef.current = 0;
        conditionCRepairGateShownThisTurnRef.current = 0;

      }
    } catch (err) {
      console.error(err);
      setWarningMessage(
        "系統暫時無法回應，可能是請求過長、API 限制或後端錯誤，請稍後再試。",
      );
    } finally {
      if (summaryTimer) clearTimeout(summaryTimer);
      setIsLoading(false);
      setLoadingText("AI 正在回覆中");
      inputRef.current?.focus();
    }
  };

  const handleMigration = async (summaryText: string) => {
    if (
      !selectedMission ||
      !selectedPhase ||
      !selectedChat ||
      selectedMission.status !== "active"
    )
      return;

    const clickTime = Date.now();
    const migrationTimeMs = migrationStartTime
      ? clickTime - migrationStartTime
      : 0;

    const newChat: Chat = {
      id: makeId("summary_chat"),
      title: `摘要接續 ${selectedMission.chats.length + 1}`,
      createdAt: nowIso(),
      messages: [
        {
          role: "assistant",
          phaseId: selectedPhase.id,
          content: `🔔 這是我們先前討論的重點摘要：\n\n${summaryText}\n\n我們可以從這裡繼續接續討論。`,
        },
      ],
    };

    setMissions((prev) =>
      prev.map((mission) =>
        mission.id === selectedMission.id
          ? {
              ...mission,
              chats: [newChat, ...mission.chats],
              activeChatId: newChat.id,
            }
          : mission,
      ),
    );
    setActiveChatId(newChat.id);

    try {
      await logMigration({
        user_id: participantId || "unknown",
        chat_id: selectedChat.id,
        migration_time: migrationTimeMs,
        summary: summaryText,
      });

      await logConversationMessages({
        participant_id: participantId || "unknown",
        assignment_mode: assignmentMode,
        mission_id: selectedMission.id,
        mission_title: selectedMission.displayTitle,
        phase_id: selectedPhase.id,
        phase_label: selectedPhase.phaseLabel,
        chat_id: newChat.id,
        condition: selectedMission.condition,
        trigger_type: "migration_summary",
        messages: newChat.messages.map((msg, index) => ({
          message_index: index,
          role: msg.role,
          content: msg.content,
        })),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const resetCurrentPhase = async () => {
    if (!isUnlocked) {
      setWarningMessage("只有管理員解鎖研究工具後才能重置");
      return;
    }
    if (
      !participantId ||
      !selectedMission ||
      !selectedPhase ||
      selectedMission.status !== "active"
    )
      return;

    const confirmed = window.confirm(
      `確定要重置「${selectedMission.displayTitle} / ${selectedPhase.phaseLabel}」嗎？\n\n這會清除目前階段的所有對話內容，並重新開始此階段。此操作會被記錄。`,
    );

    if (!confirmed) return;

    const reason =
      window.prompt(
        "請簡短填寫重置原因，例如：受測者做錯任務、操作失誤。",
        "受測者做錯任務",
      ) || "";

    let removedMessageCount = 0;
    const resetAt = nowIso();
    const newChat = createDefaultChat(selectedPhase.title);

    const nextMissions = missions.map((mission) => {
      if (mission.id !== selectedMission.id) return mission;

      const preservedChats = mission.chats
        .map((chat) => {
          const removedFromChat = chat.messages.filter(
            (msg) => msg.phaseId === selectedPhase.id,
          ).length;
          removedMessageCount += removedFromChat;
          return {
            ...chat,
            messages: chat.messages.filter(
              (msg) => msg.phaseId !== selectedPhase.id,
            ),
            summary: undefined,
          };
        })
        .filter((chat) => chat.messages.length > 0);

      return {
        ...mission,
        activeChatId: newChat.id,
        chats: [newChat, ...preservedChats],
        phases: mission.phases.map((phase) => {
          if (phase.id === selectedPhase.id) {
            return {
              ...phase,
              status: "active" as const,
              startedAt: resetAt,
              endedAt: null,
            };
          }
          return phase;
        }),
      };
    });

    setMissions(nextMissions);
    setActiveChatId(newChat.id);
    setInput("");
    resetTextareaHeight();
    setMigrationStartTime(null);

    try {
      await logResetEvent({
        participant_id: participantId,
        reset_type: "phase",
        mission_id: selectedMission.id,
        mission_title: selectedMission.displayTitle,
        phase_id: selectedPhase.id,
        phase_label: selectedPhase.phaseLabel,
        chat_count_removed: selectedMission.chats.length,
        message_count_removed: removedMessageCount,
        reason,
        operator: "admin",
      });

      await saveParticipantState({
        participant_id: participantId,
        assignment_mode: assignmentMode,
        assignment: assignmentInfo,
        active_mission_id: selectedMission.id,
        active_chat_id: newChat.id,
        missions: nextMissions,
      });
    } catch (err) {
      console.warn("reset log/state save failed", err);
    }
  };

  const resetCurrentMission = async () => {
    if (!isUnlocked) {
      setWarningMessage("只有管理員解鎖研究工具後才能重置");
      return;
    }
    if (
      !participantId ||
      !selectedMission ||
      selectedMission.status !== "active"
    )
      return;

    const confirmed = window.confirm(
      `確定要重置整個「${selectedMission.displayTitle}」嗎？\n\n這會清除這個任務內所有 Phase 的對話內容，並從第一個 Phase 重新開始。此操作會被記錄。`,
    );

    if (!confirmed) return;

    const reason =
      window.prompt(
        "請簡短填寫重置原因，例如：整個任務做錯、研究者要求重跑。",
        "整個任務重跑",
      ) || "";
    const resetAt = nowIso();
    const firstPhase = selectedMission.phases[0] || null;
    const needsChat = firstPhase && firstPhase.mode !== "read_only";
    const newChat =
      needsChat && firstPhase ? createDefaultChat(firstPhase.title) : null;
    const removedMessageCount = selectedMission.chats.reduce(
      (total, chat) => total + chat.messages.length,
      0,
    );

    const nextMissions = missions.map((mission) => {
      if (mission.id !== selectedMission.id) return mission;

      return {
        ...mission,
        status: "active" as const,
        startedAt: resetAt,
        endedAt: null,
        activePhaseId: firstPhase?.id || null,
        chats: newChat ? [newChat] : [],
        activeChatId: newChat?.id || null,
        phases: mission.phases.map((phase, index) => ({
          ...phase,
          status: index === 0 ? ("active" as const) : ("locked" as const),
          startedAt: index === 0 ? resetAt : null,
          endedAt: null,
        })),
      };
    });

    setMissions(nextMissions);
    setActiveMissionId(selectedMission.id);
    setActiveChatId(newChat?.id || null);
    setInput("");
    resetTextareaHeight();
    setMigrationStartTime(null);

    try {
      await logResetEvent({
        participant_id: participantId,
        reset_type: "mission",
        mission_id: selectedMission.id,
        mission_title: selectedMission.displayTitle,
        phase_id: firstPhase?.id || null,
        phase_label: firstPhase?.phaseLabel || null,
        chat_count_removed: selectedMission.chats.length,
        message_count_removed: removedMessageCount,
        reason,
        operator: "admin",
      });

      await saveParticipantState({
        participant_id: participantId,
        assignment_mode: assignmentMode,
        assignment: assignmentInfo,
        active_mission_id: selectedMission.id,
        active_chat_id: newChat?.id || null,
        missions: nextMissions,
      });
    } catch (err) {
      console.warn("mission reset log/state save failed", err);
    }
  };


  const completeExperimentAndRedirect = async (endedAt: string) => {
    if (!participantId || isCompletingExperiment) return;
    setIsCompletingExperiment(true);
    const context = qualtricsContext;
    const redirectBase = qualtricsRedirectUrl || context?.redirect_url || "";
    let finalRedirectUrl = "";
    try {
      const res = await completeExperiment({
        participant_id: participantId,
        rid: context?.rid || context?.sid || participantId,
        sid: context?.sid || participantId,
        qid: context?.qid || null,
        study: context?.study || null,
        redirect_url: redirectBase || null,
        completion_status: "completed",
        event_time_client: endedAt,
        metadata: {
          assignment_mode: assignmentMode,
          assignment: assignmentInfo,
          mission_count: missions.length,
        },
      });
      finalRedirectUrl = res.redirect_url || (context && redirectBase ? buildQualtricsReturnUrl(redirectBase, context) : "");
    } catch (err) {
      console.warn("experiment complete log failed", err);
      if (context && redirectBase) finalRedirectUrl = buildQualtricsReturnUrl(redirectBase, context);
    }

    if (context?.enabled && finalRedirectUrl) {
      setWarningMessage("實驗已完成，正在跳轉回 Qualtrics 後測...");
      window.location.assign(finalRedirectUrl);
    } else if (context?.enabled && !finalRedirectUrl) {
      setWarningMessage("實驗已完成，但 URL 沒有提供 redirect_url / post_survey_url。請通知研究者或手動返回 Qualtrics。");
      setIsCompletingExperiment(false);
    } else {
      setWarningMessage("實驗已完成。資料已寫入 SQLite。");
      setIsCompletingExperiment(false);
    }
  };

  const getSurveyReturnFromContext = () => {
    return (qualtricsContext?.from_survey || (qualtricsContext as any)?.from_ || "").trim();
  };

  const currentQuestionnaireReturnMatches = () => {
    if (!selectedPhase) return false;
    const fromSurvey = getSurveyReturnFromContext();
    if (!fromSurvey) return false;
    if (fromSurvey === "text_survey") return selectedPhase.taskDocId.includes("text_questionnaire");
    if (fromSurvey === "voice_survey") return selectedPhase.taskDocId.includes("voice_questionnaire");
    return false;
  };

  const completeCurrentPhase = async () => {
    if (
      !selectedMission ||
      !selectedPhase ||
      selectedMission.status !== "active"
    )
      return;
    if (phaseRounds < selectedPhase.minRounds) return;

    const missionIndex = missions.findIndex((m) => m.id === selectedMission.id);
    const phaseIndex = selectedMission.phases.findIndex(
      (p) => p.id === selectedPhase.id,
    );
    const nextPhaseInMission = selectedMission.phases[phaseIndex + 1];
    const nextMission = missions[missionIndex + 1];
    const endedAt = nowIso();

    try {
      if (participantId && selectedPhase.mode === "baseline") {
        await updateBaseline({
          participant_id: participantId,
          phase0_completed: true,
          raw_baseline_json: {
            phase0_completed_at: endedAt,
            typing_result: phase0TypingResult,
            speech_result: phase0SpeechResult,
          },
        });
      }
      if (participantId) {
        await logPhaseCompletion({
          participant_id: participantId,
          phase_id: selectedPhase.id,
          mission_title: selectedMission.displayTitle,
          condition: selectedMission.condition,
          phase_label: selectedPhase.phaseLabel,
          title: selectedPhase.title,
          round_count: phaseRounds,
          chat_count: selectedMission.chats.length,
          started_at:
            selectedPhase.startedAt || selectedMission.startedAt || null,
          ended_at: endedAt,
        });
      }
    } catch (err) {
      console.warn("phase completion log failed", err);
    }

    setMissions((prev) =>
      prev.map((mission, index) => {
        if (mission.id === selectedMission.id) {
          if (nextPhaseInMission) {
            const needsChat = nextPhaseInMission.mode !== "read_only";
            const firstChat =
              mission.chats.length > 0
                ? null
                : needsChat
                  ? createDefaultChat(nextPhaseInMission.title)
                  : null;
            const chats =
              mission.chats.length > 0
                ? mission.chats
                : firstChat
                  ? [firstChat]
                  : [];

            return {
              ...mission,
              activePhaseId: nextPhaseInMission.id,
              chats,
              activeChatId: mission.activeChatId || chats[0]?.id || null,
              phases: mission.phases.map((phase) => {
                if (phase.id === selectedPhase.id)
                  return { ...phase, status: "completed", endedAt };
                if (phase.id === nextPhaseInMission.id)
                  return { ...phase, status: "active", startedAt: nowIso() };
                return phase;
              }),
            };
          }

          return {
            ...mission,
            status: "completed",
            endedAt,
            chats: mission.chats.map((chat) => ({ ...chat, locked: true })),
            phases: mission.phases.map((phase) =>
              phase.id === selectedPhase.id
                ? { ...phase, status: "completed", endedAt }
                : phase,
            ),
          };
        }

        if (!nextPhaseInMission && index === missionIndex + 1) {
          const firstPhase = mission.phases[0] || null;
          const needsChat = firstPhase && firstPhase.mode !== "read_only";
          const firstChat =
            mission.chats.length > 0
              ? null
              : needsChat
                ? createDefaultChat(firstPhase.title)
                : null;
          const chats =
            mission.chats.length > 0
              ? mission.chats
              : firstChat
                ? [firstChat]
                : [];

          return {
            ...mission,
            status: "active",
            startedAt: nowIso(),
            activePhaseId: firstPhase?.id || null,
            chats,
            activeChatId: mission.activeChatId || chats[0]?.id || null,
            phases: mission.phases.map((phase, phaseIdx) =>
              phaseIdx === 0
                ? { ...phase, status: "active", startedAt: nowIso() }
                : phase,
            ),
          };
        }

        return mission;
      }),
    );

    if (nextPhaseInMission) {
      if (!selectedMission.activeChatId && selectedMission.chats[0]?.id) {
        setActiveChatId(selectedMission.chats[0].id);
      }
      setMigrationStartTime(null);
      setInput("");
      resetTextareaHeight();
    } else if (nextMission) {
      setActiveMissionId(nextMission.id);
      setActiveChatId(
        nextMission.activeChatId || nextMission.chats[0]?.id || null,
      );
      setMigrationStartTime(null);
      setInput("");
      resetTextareaHeight();
    } else {
      await completeExperimentAndRedirect(endedAt);
    }
  };

  useEffect(() => {
    if (!participantId || !selectedMission || !selectedPhase || selectedMission.status !== "active") return;
    if (!currentQuestionnaireReturnMatches()) return;

    const fromSurvey = getSurveyReturnFromContext();
    const storageKey = `survey_return_completed_${participantId}_${selectedPhase.id}_${fromSurvey}`;
    try {
      if (sessionStorage.getItem(storageKey) === "1") return;
      sessionStorage.setItem(storageKey, "1");
    } catch {}

    setWarningMessage("問卷完成，正在返回下一階段...");
    const timer = window.setTimeout(() => {
      void completeCurrentPhase().then(() => {
        setQualtricsContext((prev) =>
          prev ? ({ ...prev, from_survey: undefined, from_: undefined } as QualtricsContext) : prev,
        );
        try {
          const current = localStorage.getItem("qualtrics_context");
          if (current) {
            const parsed = JSON.parse(current);
            delete parsed.from_survey;
            delete parsed.from_;
            localStorage.setItem("qualtrics_context", JSON.stringify(parsed));
          }
        } catch {}
      });
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantId, selectedMission?.id, selectedMission?.status, selectedPhase?.id, selectedPhase?.taskDocId, qualtricsContext?.from_survey]);

  const showLoadingBubble = isLoading || isTranscribing;
  const selectedMissionStatusText =
    selectedMission?.status === "completed"
      ? "已完成，只能查看"
      : selectedMission?.status === "active"
        ? "進行中"
        : "尚未開始";

  return (
    <div className="flex h-screen bg-gray-50 text-gray-800 font-sans overflow-hidden">
      {qualtricsEntryError && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl p-8 border border-red-100">
            <h2 className="text-xl font-bold text-red-700 mb-3">Qualtrics 入口錯誤</h2>
            <p className="text-sm text-gray-700 leading-relaxed mb-4">{qualtricsEntryError}</p>
            <p className="text-xs text-gray-500">請確認 URL 至少包含 rid、consent、study、token，且 consent=yes。text / voice / order 可以省略，省略時由後端隨機分配。</p>
          </div>
        </div>
      )}

      {!participantId && !qualtricsEntryError && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              請輸入受測者編號
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              請輸入研究者提供的編號，例如
              P001、P002，或 Qualtrics ResponseID。這個編號只會用來區分實驗資料。
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

            <label className="block text-xs font-bold text-gray-500 mb-2">
              實驗分配模式
            </label>
            <select
              value={assignmentMode}
              onChange={(e) =>
                setAssignmentMode(e.target.value as AssignmentMode)
              }
              className="w-full p-4 border border-gray-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/20 mb-4 bg-white"
            >
              <option value="between_subject">
                人多版：文字任務 1 個，語音任務 1 個
              </option>
              <option value="within_subject">
                人少版：文字任務 1/2/3，語音任務 1/2，順序平衡
              </option>
              <option value="single_study">
                語音文字分開版：每位受測者只做文字或語音其中一種
              </option>
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

      <aside className="w-64 bg-[#171717] text-white flex flex-col border-r border-white/10">
        <div className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-lg font-bold">
            L
          </div>
          <button
            onClick={createNewChat}
            disabled={!canInteract}
            className={`flex-1 p-2 border rounded-lg transition text-sm flex items-center justify-center gap-2 ${
              canInteract
                ? "border-white/20 hover:bg-white/10"
                : "border-white/10 text-gray-500 cursor-not-allowed"
            }`}
          >
            <Plus size={18} /> 新增對話
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-3">
          {missions.map((mission) => {
            const isSelectedMission = mission.id === selectedMission?.id;
            const activePhase =
              mission.phases.find((p) => p.id === mission.activePhaseId) ||
              mission.phases[0];
            const rounds = countPhaseRounds(activePhase, mission);

            return (
              <div
                key={mission.id}
                className="border border-white/10 rounded-xl overflow-hidden"
              >
                <button
                  onClick={() =>
                    selectMissionChat(
                      mission.id,
                      mission.activeChatId || mission.chats[0]?.id || null,
                    )
                  }
                  className={`w-full text-left p-3 transition ${isSelectedMission ? "bg-[#252525]" : "bg-[#111] hover:bg-[#202020]"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-gray-100 mt-1">
                        {mission.displayTitle}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-1 truncate">
                        {mission.status === "completed"
                          ? "已完成"
                          : mission.status === "active"
                            ? `${activePhase?.phaseLabel || ""}：${activePhase?.title || ""}`
                            : "尚未開始"}
                      </div>
                    </div>
                    {mission.status === "completed" ? (
                      <CheckCircle2
                        size={16}
                        className="text-green-400 flex-shrink-0 mt-1"
                      />
                    ) : mission.status === "active" ? (
                      <span className="text-[10px] bg-blue-600 text-white px-2 py-1 rounded-full flex-shrink-0">
                        進行中
                      </span>
                    ) : (
                      <Lock
                        size={14}
                        className="text-gray-500 flex-shrink-0 mt-1"
                      />
                    )}
                  </div>
                  {activePhase?.minRounds > 0 && (
                    <div className="text-[11px] text-gray-500 mt-2">
                      目前階段輪數：{rounds}/{activePhase.minRounds}
                    </div>
                  )}
                </button>

                {mission.chats.length > 0 && (
                  <div className="bg-black/30 py-1">
                    {mission.chats.map((chat) => (
                      <button
                        key={chat.id}
                        onClick={() => selectMissionChat(mission.id, chat.id)}
                        className={`w-full p-2 pl-5 text-left flex items-center gap-2 text-sm transition ${
                          chat.id === selectedChat?.id
                            ? "bg-blue-600/25 text-white"
                            : "text-gray-300 hover:bg-white/5"
                        }`}
                      >
                        <MessageSquare size={14} className="text-gray-500" />
                        <span className="truncate">{chat.title}</span>
                        {chat.locked && (
                          <Lock size={12} className="ml-auto text-gray-500" />
                        )}
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
                      const configuredPassword = String((config as any).dev_password || "1234");
                      if (devPassword === configuredPassword) setIsUnlocked(true);
                      else setWarningMessage("開發工具密碼錯誤");
                    }}
                  >
                    <Lock size={12} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="rounded border border-white/10 bg-white/5 p-2 text-gray-200 space-y-1">
                    <div>
                      受測者：{participantId || "未設定"}
                    </div>
                    {participantId && (
                      <button
                        onClick={() => {
                          localStorage.removeItem("participant_id");
                          setParticipantId("");
                          setParticipantInput("");
                          setAssignmentInfo(null);
                          initializeMissions(fallbackFlow);
                        }}
                        className="text-blue-300 hover:underline"
                      >
                        更換受測者
                      </button>
                    )}
                  </div>
                  <div>
                    分配模式:{" "}
                    {assignmentInfo?.assignment_mode || assignmentMode}
                  </div>
                  <div>
                    文字:{" "}
                    {assignmentInfo?.text_order ||
                      assignmentInfo?.text_condition ||
                      "-"}
                  </div>
                  <div>
                    語音:{" "}
                    {assignmentInfo?.voice_order ||
                      assignmentInfo?.voice_condition ||
                      "-"}
                  </div>
                  <div>
                    目前任務內部情境: {selectedMission?.condition || "-"}
                  </div>
                  <div>
                    目前階段輪數: {phaseRounds}/{selectedPhase?.minRounds || 0}
                  </div>
                  <div>
                    Token: {debugData.tokens}/{config.token_threshold}
                  </div>
                  <div>音量: {volume.toFixed(4)}</div>
                  {(phase0TypingResult || phase0SpeechResult) && (
                    <div className="rounded border border-white/10 bg-white/5 p-2 text-gray-200 space-y-1">
                      <div className="text-green-300 font-bold">Phase 0 指標</div>
                      {phase0TypingResult && (
                        <>
                          <div>中文 CPM: {phase0TypingResult.cpm}</div>
                          <div>WPM: {phase0TypingResult.wpm}</div>
                          <div>打字時間: {Math.round(phase0TypingResult.durationMs / 1000)} 秒</div>
                          <div>正確率: {phase0TypingResult.accuracy}%</div>
                        </>
                      )}
                      {phase0SpeechResult && (
                        <>
                          <div>Speech Ratio: {phase0SpeechResult.speechRatio}</div>
                          <div>語音時間: {Math.round(phase0SpeechResult.durationMs / 1000)} 秒</div>
                          <div>Voice Frames: {phase0SpeechResult.voiceFrames}</div>
                          <div>Silence Frames: {phase0SpeechResult.silenceFrames}</div>
                        </>
                      )}
                    </div>
                  )}
                  <div>
                    中斷恢復追蹤:{" "}
                    {lastInterruptionAtRef.current ? "等待恢復" : "無"}
                  </div>
                  {selectedMission?.status === "active" && (
                    <div className="pt-2 space-y-2">
                      <button
                        onClick={resetCurrentPhase}
                        className="w-full rounded bg-red-600 px-2 py-1 text-white hover:bg-red-700"
                      >
                        管理員重置目前階段
                      </button>
                      <button
                        onClick={resetCurrentMission}
                        className="w-full rounded border border-red-500 px-2 py-1 text-red-300 hover:bg-red-950"
                      >
                        管理員重置整個任務
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col bg-white min-w-0">
        <header className="h-14 border-b flex items-center justify-between px-6 bg-white/80 backdrop-blur-md sticky top-0 z-10 font-bold">
          <div className="truncate">
            {selectedMission && selectedPhase
              ? `${selectedMission.displayTitle} - ${selectedPhase.phaseLabel}`
              : "實驗介面"}
          </div>
          <span className="text-xs text-gray-500 font-normal">
            {isUnlocked ? "研究工具已解鎖" : ""}
          </span>
        </header>

        {showTextRoundPrompt && (
          <div className="shrink-0 border-b bg-blue-50/95 backdrop-blur-md px-4 py-3 md:px-6 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="mx-auto flex max-w-3xl items-start justify-between gap-4 rounded-2xl border border-blue-100 bg-white/80 px-4 py-3 shadow-sm">
              <div className="min-w-0">
                <div className="text-xs font-bold text-blue-600 mb-1">
                  本輪討論提示｜第 {nextTextRound} / {selectedPhase?.minRounds || 0} 輪
                </div>
                <div className="text-sm text-blue-950 leading-relaxed font-semibold">
                  {textRoundGuidance}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDismissedRoundPromptKey(roundPromptKey)}
                className="shrink-0 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100"
              >
                關閉
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {isPhase0Selected && (
              <div className="p-6 rounded-3xl bg-white border shadow-sm space-y-6">
                <div>
                  <div className="text-sm font-bold text-blue-600 mb-1">Phase 0｜基準測試</div>
                  <h2 className="text-2xl font-bold text-gray-900">打字速度與語音節奏測試</h2>
                  <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                    這個階段會先記錄你的基準打字速度與語音節奏，作為後續分析控制變項。完成兩項測試後，右側按鈕會解鎖正式任務。
                  </p>
                </div>

                <section className="rounded-2xl border bg-gray-50 p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-gray-900">一、打字速度基準測試</h3>
                      <p className="text-xs text-gray-500 mt-1">請完整照抄下方文字。開始輸入時會自動計時。</p>
                    </div>
                    {phase0TypingResult && <CheckCircle2 size={20} className="text-green-500" />}
                  </div>
                  <div className="rounded-xl bg-white border p-4 text-gray-700 leading-7">{PHASE0_TYPING_TEXT}</div>
                  <textarea
                    value={phase0TypingInput}
                    onChange={(e) => {
                      if (!phase0TypingStartedAt) {
                        setPhase0TypingStartedAt(Date.now());
                        void trackInteractionEvent("baseline_typing_start", {
                          trigger_type: "phase0_typing_first_key",
                          details: { target_text_length: PHASE0_TYPING_TEXT.length },
                        });
                      }
                      setPhase0TypingInput(e.target.value);
                    }}
                    disabled={Boolean(phase0TypingResult)}
                    rows={4}
                    className="w-full rounded-2xl border border-gray-200 bg-white p-4 outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-100"
                    placeholder="請從這裡開始照抄上方文字"
                  />
                  <button
                    onClick={submitPhase0Typing}
                    disabled={!phase0TypingInput.trim() || Boolean(phase0TypingResult)}
                    className={`rounded-xl px-4 py-2 font-bold transition ${phase0TypingInput.trim() && !phase0TypingResult ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
                  >
                    送出打字測試
                  </button>
                  {phase0TypingResult && (
                    <div className="rounded-2xl bg-green-50 border border-green-200 text-green-700 p-4 text-sm font-semibold">
                      打字基準測試已完成。請繼續完成語音基準測試。
                      {isUnlocked && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mt-3">
                          <InfoRow label="中文 CPM" value={`${phase0TypingResult.cpm}`} />
                          <InfoRow label="WPM" value={`${phase0TypingResult.wpm}`} />
                          <InfoRow label="時間" value={`${Math.round(phase0TypingResult.durationMs / 1000)} 秒`} />
                          <InfoRow label="正確率" value={`${phase0TypingResult.accuracy}%`} />
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border bg-gray-50 p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-gray-900">二、語音節奏基準測試</h3>
                      <p className="text-xs text-gray-500 mt-1">請按下錄音並朗讀下方文字。系統會在背景記錄語音節奏資料。</p>
                    </div>
                    {phase0SpeechResult && <CheckCircle2 size={20} className="text-green-500" />}
                  </div>
                  <div className="rounded-xl bg-white border p-4 text-gray-700 leading-7">{PHASE0_SPEECH_TEXT}</div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={phase0Recording ? stopPhase0SpeechRecording : startPhase0SpeechRecording}
                      disabled={Boolean(phase0SpeechResult)}
                      className={`rounded-xl px-4 py-2 font-bold transition ${phase0Recording ? "bg-red-500 text-white animate-pulse" : phase0SpeechResult ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                    >
                      {phase0Recording ? "停止錄音" : "開始錄音"}
                    </button>
                    <span className="text-xs text-gray-500">
                      {phase0Recording ? "錄音中，朗讀完成後請按停止錄音。" : "請按開始錄音並朗讀上方文字。"}
                    </span>
                    {isUnlocked && (
                      <span className="text-xs text-gray-400">目前音量 RMS：{volume.toFixed(4)}</span>
                    )}
                  </div>
                  {phase0SpeechResult && (
                    <div className="rounded-2xl bg-green-50 border border-green-200 text-green-700 p-4 text-sm font-semibold">
                      語音基準測試已完成。兩項基準測試都完成後，請按右側按鈕進入正式任務。
                      {isUnlocked && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mt-3">
                          <InfoRow label="Speech Ratio" value={`${phase0SpeechResult.speechRatio}`} />
                          <InfoRow label="時間" value={`${Math.round(phase0SpeechResult.durationMs / 1000)} 秒`} />
                          <InfoRow label="Voice Frames" value={`${phase0SpeechResult.voiceFrames}`} />
                          <InfoRow label="Silence Frames" value={`${phase0SpeechResult.silenceFrames}`} />
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {!phase0Completed && (
                  <div className="rounded-2xl bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 text-sm">
                    請完成打字與語音兩項基準測試後，再按右側「完成此階段」進入正式任務。
                  </div>
                )}
              </div>
            )}

            {!selectedChat && selectedPhase?.mode === "read_only" && (
              <div className="p-6 rounded-3xl bg-gray-50 border text-gray-600 leading-relaxed">
                目前階段不需要聊天。請閱讀右側任務文件，完成後按右下角按鈕繼續。
              </div>
            )}

            {selectedChat?.messages
              .filter((m) => !m.hidden)
              .map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`flex gap-4 max-w-[85%] ${m.role === "user" ? "flex-row-reverse" : ""}`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        m.role === "user" ? "bg-blue-500" : "bg-emerald-600"
                      } text-white shadow-sm`}
                    >
                      {m.role === "user" ? (
                        <User size={16} />
                      ) : (
                        <Bot size={16} />
                      )}
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

            {selectedChat?.summary &&
              selectedMission?.condition === "C" &&
              selectedMission.status === "active" && (
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
            {isTextRoundLimitReached && selectedMission?.status === "active" && (
              <div className="mb-4 rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-blue-50 p-5 shadow-sm animate-in fade-in slide-in-from-bottom-3 duration-500">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <CheckCircle2 size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-emerald-700 mb-2">
                      已完成本階段 {selectedPhase?.minRounds || 0} 輪對話
                    </div>
                    <div className="min-h-[44px] text-sm md:text-base text-gray-800 leading-relaxed font-semibold whitespace-pre-wrap">
                      {typewriterText}
                      {typewriterText.length < textTransitionMessage.length && (
                        <span className="inline-block w-2 h-5 ml-1 bg-gray-700 align-middle animate-pulse" />
                      )}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={completeCurrentPhase}
                        className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 active:scale-95 transition-all"
                      >
                        繼續到下一階段
                      </button>
                      <span className="text-xs text-gray-500 self-center">
                        送出按鈕已鎖定，避免超過固定輪數。
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {warningMessage && (
              <div className="absolute -top-16 left-1/2 -translate-x-1/2 bg-red-50 text-red-700 text-xs py-3 px-6 rounded-2xl shadow-xl flex items-center gap-2 z-20 border border-red-200 animate-in fade-in zoom-in duration-300 max-w-[90%]">
                <AlertCircle size={14} />
                <span className="font-semibold whitespace-nowrap overflow-hidden text-ellipsis">
                  {warningMessage}
                </span>
              </div>
            )}

            
{repairGateOpen && currentCondition === "C" && canInteract && (
  <div className="absolute -top-32 left-1/2 -translate-x-1/2 bg-white text-gray-800 text-xs p-4 rounded-2xl shadow-xl z-30 border border-blue-200 w-[360px] space-y-3">
    <div className="font-semibold leading-relaxed">
      看起來你可能還有話想說。你要繼續說，還是現在送出給 AI？
    </div>
    <div className="flex gap-2">
      <button
        type="button"
        onClick={continueConditionCSpeaking}
        className="flex-1 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 px-3 py-2 font-bold hover:bg-blue-100"
      >
        繼續錄音
      </button>
      <button
        type="button"
        onClick={sendConditionCNow}
        className="flex-1 rounded-xl bg-blue-600 text-white px-3 py-2 font-bold hover:bg-blue-700"
      >
        現在送出
      </button>
    </div>
  </div>
)}
        {showHint && currentCondition !== "A" && currentCondition !== "B" && canInteract && (
              <div className="absolute -top-16 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs py-2 px-5 rounded-full shadow-xl animate-bounce z-20">
                偵測到停頓，若說完請停止
              </div>
            )}

            {selectedMission && selectedMission.status !== "active" && (
              <div className="mb-3 text-center text-sm text-gray-500 bg-gray-50 border rounded-2xl py-3">
                此任務
                {selectedMission.status === "completed"
                  ? "已完成，只能查看紀錄"
                  : "尚未開始"}
                。
                {currentActiveMission && (
                  <button
                    onClick={goToCurrentActiveMission}
                    className="ml-2 text-blue-600 hover:underline"
                  >
                    回到目前進行中任務
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
                  markTextReengagement();
                  setInput(e.target.value);
                  autoResizeTextarea();
                }}
                onInput={autoResizeTextarea}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(undefined, "manual_enter");
                  }
                }}
                placeholder={
                  canInteract
                    ? "輸入訊息，Shift + Enter 換行"
                    : "目前階段不能輸入"
                }
                className={`flex-1 resize-none max-h-[180px] min-h-[56px] overflow-y-auto p-4 border rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm transition-all leading-relaxed ${
                  canInteract
                    ? "bg-white border-gray-200"
                    : "bg-gray-100 border-gray-200 cursor-not-allowed text-gray-500"
                }`}
                disabled={!canInteract}
              />

              <button
                onClick={() => handleSend(undefined, "manual_button")}
                disabled={!canInteract || !input.trim()}
                className={`p-4 rounded-2xl transition-all shadow-sm ${
                  canInteract && input.trim()
                    ? "bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
                title="送出"
              >
                <Send size={22} />
              </button>

              <button
                onClick={() =>
                  isRecording ? stopRecording(false) : startRecording()
                }
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
                {isRecording ? (
                  <Square size={22} fill="currentColor" />
                ) : (
                  <Mic size={22} />
                )}
              </button>
            </div>

            <div className="mt-2 text-xs text-gray-400 text-center">
              Enter 送出，Shift + Enter 換行
            </div>
          </div>
        </div>
      </main>

      <aside className="w-[520px] bg-gray-50 border-l flex flex-col">
        <div className="flex-[3] overflow-y-auto p-6 border-b">
          <div className="flex items-center gap-2 text-gray-800 font-bold mb-3 text-lg">
            <FileText size={20} /> 任務文件
          </div>
          <div className="text-sm text-gray-500 mb-4">
            {selectedMission && selectedPhase
              ? `${selectedMission.displayTitle} / ${selectedPhase.phaseLabel} / ${selectedPhase.title}`
              : "尚未載入"}
          </div>
          <div className="bg-white border rounded-2xl p-5 text-base leading-8 whitespace-pre-wrap text-gray-700 shadow-sm">
            {renderTaskDocWithLinks(taskDoc)}
          </div>
        </div>

        <div className="flex-[1] p-5 bg-white overflow-y-auto">
          <h3 className="font-bold text-gray-900 mb-4">目前任務進度</h3>

          {selectedMission && selectedPhase ? (
            <div className="space-y-3 text-sm">
              <InfoRow label="任務" value={selectedMission.displayTitle} />
              <InfoRow
                label="目前階段"
                value={`${selectedPhase.phaseLabel}：${selectedPhase.title}`}
              />
              <InfoRow label="狀態" value={selectedMissionStatusText} />
              <InfoRow
                label="完成條件"
                value={
                  selectedPhase.minRounds > 0
                    ? selectedPhase.mode === "text"
                      ? `固定 ${selectedPhase.minRounds} 輪對話`
                      : `至少 ${selectedPhase.minRounds} 輪對話`
                    : "閱讀完成即可繼續"
                }
              />
              <InfoRow
                label="目前進度"
                value={`${phaseRounds} / ${selectedPhase.minRounds} 輪`}
              />

              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{
                    width: `${Math.min(100, selectedPhase.minRounds === 0 ? 100 : (phaseRounds / selectedPhase.minRounds) * 100)}%`,
                  }}
                />
              </div>

              {selectedMission.status === "active" ? (
                <div className="space-y-2">
                  {isUnlocked && selectedPhase.mode !== "read_only" && (
                    <button
                      onClick={resetCurrentPhase}
                      className="w-full py-3 rounded-xl font-bold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 active:scale-95 transition-all"
                    >
                      管理員：重置目前階段
                    </button>
                  )}
                  {isUnlocked && selectedMission.phases.length > 1 && (
                    <button
                      onClick={resetCurrentMission}
                      className="w-full py-3 rounded-xl font-bold border border-red-300 bg-white text-red-700 hover:bg-red-50 active:scale-95 transition-all"
                    >
                      管理員：重置整個任務
                    </button>
                  )}
                  <button
                    onClick={completeCurrentPhase}
                    disabled={!canCompletePhase}
                    className={`w-full py-3.5 rounded-xl font-bold transition-all ${
                      canCompletePhase
                        ? "bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
                        : "bg-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    {canCompletePhase
                      ? "完成此階段，進入下一階段"
                      : selectedPhase.mode === "baseline"
                        ? "請先完成兩項基準測試"
                        : selectedPhase.mode === "text"
                          ? "尚未完成固定輪數"
                          : "尚未完成最低輪數"}
                  </button>
                </div>
              ) : currentActiveMission ? (
                <button
                  onClick={goToCurrentActiveMission}
                  className="w-full py-3.5 rounded-xl font-bold bg-gray-900 text-white hover:bg-black active:scale-95 transition-all"
                >
                  返回目前進行中任務
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="w-full py-3.5 rounded-xl font-bold bg-green-50 text-green-700 text-center border border-green-100">
                    全部任務已完成
                  </div>
                  {qualtricsContext?.enabled && qualtricsRedirectUrl && (
                    <button
                      type="button"
                      disabled={isCompletingExperiment}
                      onClick={() => completeExperimentAndRedirect(nowIso())}
                      className="w-full py-3 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 transition-all"
                    >
                      返回 Qualtrics 後測
                    </button>
                  )}
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

function countPhaseRounds(
  phase?: ExperimentPhase | null,
  mission?: ExperimentMissionRun | null,
) {
  if (!phase || !mission) return 0;

  return mission.chats.reduce((total, chat) => {
    const userCount = chat.messages.filter(
      (m) =>
        m.role === "user" &&
        (m.phaseId === phase.id || (!m.phaseId && mission.phases.length === 1)),
    ).length;
    const assistantCount = chat.messages.filter(
      (m) =>
        m.role === "assistant" &&
        (m.phaseId === phase.id || (!m.phaseId && mission.phases.length === 1)),
    ).length;
    return total + Math.min(userCount, assistantCount);
  }, 0);
}

function appendLatestAssistantToChat(
  chat: Chat,
  rawHistory: any[],
  phaseId: string,
): Message[] {
  // For Condition B/C, the backend returns the full visible context plus the
  // latest reply. Do not replace the whole chat with that returned history,
  // because doing so would relabel old Phase 1 messages as Phase 2 messages
  // and make progress jump from 0/4 to 7/4.
  const nextMessages: Message[] = [...chat.messages];
  const returned = Array.isArray(rawHistory) ? rawHistory : [];
  const lastAssistant = [...returned]
    .reverse()
    .find((msg) => msg?.role === "assistant" && msg?.content);

  if (!lastAssistant?.content) return nextMessages;

  const alreadyLast =
    nextMessages.length > 0 &&
    nextMessages[nextMessages.length - 1].role === "assistant" &&
    nextMessages[nextMessages.length - 1].content === lastAssistant.content &&
    nextMessages[nextMessages.length - 1].phaseId === phaseId;

  if (alreadyLast) return nextMessages;

  return [
    ...nextMessages,
    {
      role: "assistant",
      content: lastAssistant.content,
      phaseId,
      hidden: false,
    },
  ];
}

function applyConditionAResponse(
  chat: Chat,
  rawHistory: any[],
  phaseId: string,
  roundLimit: number,
): Message[] {
  // Condition A simulates implicit context rolling based on backend/config.py:
  // SCENARIO_A_ROUND_LIMIT = N and SCENARIO_A_MSG_LIMIT = N * 2.
  //
  // Important:
  // 1. The rolling window is shared across Phase 1/2/3 inside the same task/chat.
  //    It must NOT restart just because the participant moves to a new phase.
  // 2. Example with roundLimit = 5:
  //    Phase 1 has 6 rounds and Phase 2 has 4 rounds => keep the latest 5 rounds
  //    overall: Phase 1's last round + Phase 2's four rounds.
  // 3. Hidden messages stay in state/backend so each phase's progress still counts them.
  // 4. Do not match returned messages by content; repeated test messages like "5"
  //    would otherwise make the wrong turn visible.
  const safeRoundLimit = Number.isFinite(roundLimit) && roundLimit > 0 ? roundLimit : 5;
  const messageLimit = safeRoundLimit * 2;

  const nextMessages: Message[] = chat.messages.map((msg) => ({
    ...msg,
    phaseId: msg.phaseId || phaseId,
  }));

  const returned = Array.isArray(rawHistory) ? rawHistory : [];
  const lastAssistant = [...returned]
    .reverse()
    .find((msg) => msg?.role === "assistant" && msg?.content);

  if (lastAssistant?.content) {
    const alreadyLast =
      nextMessages.length > 0 &&
      nextMessages[nextMessages.length - 1].role === "assistant" &&
      nextMessages[nextMessages.length - 1].content === lastAssistant.content &&
      nextMessages[nextMessages.length - 1].phaseId === phaseId;

    if (!alreadyLast) {
      nextMessages.push({
        role: "assistant",
        content: lastAssistant.content,
        phaseId,
        hidden: false,
      });
    }
  }

  // Roll over the whole task/chat, not only the current phase. This keeps the
  // token/context behavior consistent across Phase 1/2/3 in one task.
  const taskMessageIndexes = nextMessages
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg }) => msg.role === "user" || msg.role === "assistant");

  const shouldRoll = taskMessageIndexes.length > messageLimit;
  const visibleStartInTask = Math.max(0, taskMessageIndexes.length - messageLimit);

  taskMessageIndexes.forEach(({ index }, orderInTask) => {
    nextMessages[index] = {
      ...nextMessages[index],
      hidden: shouldRoll && orderInTask < visibleStartInTask,
    };
  });

  return nextMessages;
}

function ensurePhase0Flow(flowPhases: FlowPhaseConfig[]): FlowPhaseConfig[] {
  if (flowPhases.some((phase) => phase.id === "phase0_baseline" || phase.taskDocId === "phase0_baseline")) {
    return flowPhases;
  }

  return [
    {
      id: "phase0_baseline",
      missionTitle: "Phase 0｜基準測試",
      condition: null,
      conditionLabel: "Baseline",
      phaseLabel: "Phase 0",
      title: "打字速度與語音節奏基準測試",
      taskDocId: "phase0_baseline",
      minRounds: 0,
      mode: "baseline",
    },
    ...flowPhases,
  ];
}

function buildMissionRuns(
  flowPhases: FlowPhaseConfig[],
): ExperimentMissionRun[] {
  const missions: ExperimentMissionRun[] = [];
  const taskKeyToMissionId = new Map<string, string>();
  let textTaskCount = 0;
  let voiceTaskCount = 0;

  for (const phase of flowPhases) {
    const isInteractive = phase.mode === "text" || phase.mode === "voice";
    const isTextTaskPhase = phase.taskDocId.startsWith("text_travel_phase_");
    const isVoiceTaskPhase = phase.taskDocId.startsWith(
      "voice_restaurant_phase_",
    );
    const isBaselinePhase = phase.taskDocId === "phase0_baseline" || phase.mode === "baseline";
    const isTaskPhase = isTextTaskPhase || isVoiceTaskPhase;

    // Important: voice Phase 1 is read_only, but it is still part of the same
    // voice task as Phase 2/3. Therefore task phases must be grouped by the
    // backend run identity, not by whether the phase is interactive.
    const key = isBaselinePhase
      ? "phase0_baseline"
      : isTaskPhase
        ? `task|${phase.missionTitle}|${phase.condition || "none"}`
        : `${phase.id}|read_only`;

    let mission = taskKeyToMissionId.has(key)
      ? missions.find((m) => m.id === taskKeyToMissionId.get(key)) || null
      : null;

    if (!mission) {
      let displayTitle = phase.missionTitle;
      if (isBaselinePhase) {
        displayTitle = "Phase 0｜基準測試";
      } else if (phase.taskDocId === "text_questionnaire") {
        displayTitle = `文字任務 ${Math.max(textTaskCount, 1)} 問卷`;
      } else if (phase.taskDocId === "voice_questionnaire") {
        displayTitle = `語音任務 ${Math.max(voiceTaskCount, 1)} 問卷`;
      } else if (isTextTaskPhase) {
        textTaskCount += 1;
        displayTitle = `文字任務 ${textTaskCount}`;
      } else if (isVoiceTaskPhase) {
        voiceTaskCount += 1;
        displayTitle = `語音任務 ${voiceTaskCount}`;
      }

      const initialChat = isInteractive ? createDefaultChat(phase.title) : null;
      const missionId = isBaselinePhase ? "phase0_baseline" : makeId(isTaskPhase ? "mission" : "readonly");

      mission = {
        id: missionId,
        displayTitle,
        internalTitle: phase.missionTitle,
        condition: phase.condition,
        conditionLabel: phase.conditionLabel,
        status: missions.length === 0 ? "active" : "locked",
        phases: [],
        activePhaseId: phase.id,
        chats: initialChat ? [initialChat] : [],
        activeChatId: initialChat?.id || null,
        startedAt: missions.length === 0 ? nowIso() : null,
        endedAt: null,
      };

      missions.push(mission);
      taskKeyToMissionId.set(key, missionId);
    }

    // If a mission starts with a read-only phase, such as voice Phase 1, create
    // the first chat when we later encounter the first interactive phase.
    if (isInteractive && mission.chats.length === 0) {
      const initialChat = createDefaultChat(phase.title);
      mission.chats = [initialChat];
      mission.activeChatId = initialChat.id;
    }

    mission.phases.push({
      ...phase,
      status:
        mission.phases.length === 0 && mission.status === "active"
          ? "active"
          : "locked",
      startedAt:
        mission.phases.length === 0 && mission.status === "active"
          ? nowIso()
          : null,
      endedAt: null,
    });
  }

  return missions;
}
