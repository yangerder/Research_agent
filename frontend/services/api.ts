import axios from 'axios';

// 指向你啟動中的 FastAPI 後端
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

/**
 * 送出聊天訊息
 * @param trigger - 標記訊息來源：'manual' (手動) 或 'auto_vad' (系統自動截斷)
 */
export const sendChatMessage = async (
  userId: string, 
  message: string, 
  history: any[], 
  scenario: 'A' | 'B'| 'C',
  trigger: string = "manual", // 新增預設參數，不影響舊有呼叫
  chatId: string
) => {
  try {
    const response = await axios.post(`${API_BASE}/chat`, {
      user_id: userId,
      chat_id: chatId,
      message: message,
      history: history,
      scenario: scenario,
      trigger_type: trigger // 將觸發類型傳給後端 logger
    });
    return response.data;
  } catch (error) {
    console.error("API Error:", error);
    throw error;
  }
};

/**
 * 語音轉文字 (STT) 接口
 * @param audioBlob - 錄製的 WebM/WAV 音訊檔案
 */
export const transcribeAudio = async (audioBlob: Blob) => {
  try {
    const formData = new FormData();
    // 檔名設定為 audio.webm 以符合 Chrome/Firefox 預設錄音格式
    formData.append('file', audioBlob, 'audio.webm');

    const response = await axios.post(`${API_BASE}/transcribe`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data.text; // 回傳轉出的文字內容
  } catch (error) {
    console.error("Transcription Error:", error);
    throw error;
  }
};