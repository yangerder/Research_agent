# backend/config.py

# 全域設定
MODEL_NAME = "llama-3.1-8b-instant"
VAD_THRESHOLD = 0.05  
DEV_PASSWORD = "1234"

# 實驗 A (隱性裁切) 參數
SCENARIO_A_ROUND_LIMIT = 5 
SCENARIO_A_MSG_LIMIT = SCENARIO_A_ROUND_LIMIT * 2 
VAD_SILENCE_TIMEOUT_A = 1.0  

# 核心實驗門檻 (情境 B 與 C 共用) 💡 統一變數
TOKEN_THRESHOLD = 6000       # 總上限：300 tokens
SUMMARY_THRESHOLD = 0.8      # 觸發總結門檻 (2400 tokens)
SCENARIO_B_SHOW_HINT = True  
VAD_SILENCE_TIMEOUT_B = 2.0  
VAD_SILENCE_TIMEOUT_C = 2.0