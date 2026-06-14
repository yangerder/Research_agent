import axios from "axios";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export type Scenario = "A" | "B" | "C";
export type AssignmentMode = "between_subject" | "within_subject";

export const sendChatMessage = async (
  userId: string,
  message: string,
  history: any[],
  scenario: Scenario,
  trigger: string = "manual",
  chatId: string,
  phaseId?: string,
  metadata: Record<string, any> = {}
) => {
  const response = await axios.post(`${API_BASE}/chat`, {
    user_id: userId,
    chat_id: chatId,
    message,
    history,
    scenario,
    trigger_type: trigger,
    phase_id: phaseId,
    ...metadata,
  });

  return response.data;
};

export const transcribeAudio = async (audioBlob: Blob): Promise<{ text: string; whisper_stt_ms: number }> => {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");

  const response = await axios.post(`${API_BASE}/transcribe`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return {
    text: response.data?.text || "",
    whisper_stt_ms: Number(response.data?.whisper_stt_ms || 0),
  };
};

export interface QualtricsStartPayload {
  sid?: string;
  qid?: string;
  consent?: string;
  study?: string;
  text?: string;
  voice?: string;
  order?: string;
  token?: string;
  redirect_url?: string;
  post_survey_url?: string;
  device_browser?: string;
}

export const startExperiment = async (
  participantId: string,
  assignmentMode: AssignmentMode = "between_subject",
  qualtrics?: QualtricsStartPayload | null,
) => {
  const response = await axios.post(`${API_BASE}/experiment/start`, {
    participant_id: participantId,
    assignment_mode: assignmentMode,
    ...(qualtrics || {}),
  });
  return response.data;
};

export const getExperimentFlow = async () => {
  const response = await axios.get(`${API_BASE}/experiment/flow`);
  return response.data;
};

export const getTaskDoc = async (docId: string) => {
  const response = await axios.get(`${API_BASE}/experiment/task_doc/${docId}`);
  return response.data;
};

export const saveParticipantState = async (payload: {
  participant_id: string;
  assignment_mode?: AssignmentMode;
  assignment?: any;
  active_mission_id?: string | null;
  active_chat_id?: string | null;
  missions: any[];
}) => {
  const response = await axios.post(`${API_BASE}/experiment/state`, payload);
  return response.data;
};

export const getParticipantState = async (participantId: string) => {
  const response = await axios.get(`${API_BASE}/experiment/state/${participantId}`);
  return response.data;
};

export const logConversationMessages = async (payload: {
  participant_id: string;
  assignment_mode?: AssignmentMode;
  mission_id: string;
  mission_title: string;
  phase_id: string;
  phase_label: string;
  chat_id: string;
  condition?: string | null;
  trigger_type?: string;
  messages: Array<{
    message_index: number;
    role: "user" | "assistant";
    content: string;
  }>;
}) => {
  const response = await axios.post(`${API_BASE}/experiment/messages`, payload);
  return response.data;
};


export const logInteractionEvent = async (payload: {
  participant_id: string;
  assignment_mode?: AssignmentMode;
  event_type: string;
  mission_id?: string | null;
  mission_title?: string | null;
  phase_id?: string | null;
  phase_label?: string | null;
  chat_id?: string | null;
  condition?: string | null;
  trigger_type?: string | null;
  event_time_client?: string | null;
  recording_duration_ms?: number | null;
  silence_duration_ms?: number | null;
  recovery_time_ms?: number | null;
  text_length?: number | null;
  details?: any;
}) => {
  const response = await axios.post(`${API_BASE}/experiment/interaction_event`, payload);
  return response.data;
};

export const logResetEvent = async (payload: {
  participant_id: string;
  reset_type: "phase" | "mission";
  mission_id: string;
  mission_title: string;
  phase_id?: string | null;
  phase_label?: string | null;
  chat_count_removed: number;
  message_count_removed: number;
  reason?: string;
  operator?: string;
}) => {
  const response = await axios.post(`${API_BASE}/experiment/reset`, payload);
  return response.data;
};

export const logPhaseCompletion = async (payload: {
  participant_id: string;
  phase_id: string;
  mission_title: string;
  condition?: string | null;
  phase_label: string;
  title: string;
  round_count: number;
  chat_count: number;
  started_at?: string | null;
  ended_at: string;
}) => {
  const response = await axios.post(`${API_BASE}/experiment/complete_phase`, payload);
  return response.data;
};

export const logMigration = async (payload: {
  user_id: string;
  chat_id: string;
  migration_time: number;
  summary: string;
}) => {
  const response = await axios.post(`${API_BASE}/log_migration`, payload);
  return response.data;
};



export const updateActionTiming = async (payload: {
  action_log_id: number;
  t1_client_ms?: number | null;
  t4_client_ms?: number | null;
  t5_client_ms?: number | null;
  previous_t4_client_ms?: number | null;
  user_reengagement_ms?: number | null;
}) => {
  const response = await axios.post(`${API_BASE}/experiment/action_timing_update`, payload);
  return response.data;
};

export const updateBaseline = async (payload: {
  participant_id: string;
  baseline_typing_wpm?: number | null;
  baseline_typing_cpm_chinese?: number | null;
  baseline_typing_duration_ms?: number | null;
  baseline_typing_accuracy?: number | null;
  baseline_speech_ratio?: number | null;
  baseline_speech_duration_ms?: number | null;
  baseline_voice_frames?: number | null;
  baseline_silence_frames?: number | null;
  phase0_completed?: boolean | null;
  raw_baseline_json?: any;
}) => {
  const response = await axios.post(`${API_BASE}/experiment/baseline`, payload);
  return response.data;
};

export const logSystemError = async (payload: {
  participant_id?: string | null;
  error_type: string;
  error_message: string;
  recoverability?: string;
  metadata?: any;
}) => {
  const response = await axios.post(`${API_BASE}/experiment/system_error`, payload);
  return response.data;
};

export const completeExperiment = async (payload: {
  participant_id: string;
  sid?: string | null;
  qid?: string | null;
  study?: string | null;
  redirect_url?: string | null;
  completion_status?: string;
  event_time_client?: string | null;
  metadata?: any;
}) => {
  const response = await axios.post(`${API_BASE}/experiment/complete`, payload);
  return response.data;
};
