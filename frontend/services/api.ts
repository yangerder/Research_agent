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
  phaseId?: string
) => {
  const response = await axios.post(`${API_BASE}/chat`, {
    user_id: userId,
    chat_id: chatId,
    message,
    history,
    scenario,
    trigger_type: trigger,
    phase_id: phaseId,
  });

  return response.data;
};

export const transcribeAudio = async (audioBlob: Blob) => {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");

  const response = await axios.post(`${API_BASE}/transcribe`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return response.data.text;
};


export const startExperiment = async (participantId: string, assignmentMode: AssignmentMode = "between_subject") => {
  const response = await axios.post(`${API_BASE}/experiment/start`, {
    participant_id: participantId,
    assignment_mode: assignmentMode,
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
