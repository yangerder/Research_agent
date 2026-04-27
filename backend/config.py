# backend/config.py

# 實驗 A (隱性裁切) 參數
SCENARIO_A_ROUND_LIMIT = 3 
SCENARIO_A_MSG_LIMIT = SCENARIO_A_ROUND_LIMIT * 2 
VAD_SILENCE_TIMEOUT_A =1   # 靜音 0.5 秒即自動送出

# 實驗 B (顯性告知) 參數
SCENARIO_B_TOKEN_THRESHOLD = 1000 
SCENARIO_B_SHOW_HINT = True  # 開關：是否顯示「說完了嗎？」的提示
VAD_SILENCE_TIMEOUT_B = 2.0  # 靜音 2.0 秒才處理

# 全域設定
MODEL_NAME = "llama-3.1-8b-instant"
VAD_THRESHOLD = 0.05  # 音量偵測門檻 (RMS)
DEV_PASSWORD = "1234"