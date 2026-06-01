# backend/config.py

# 全域設定
MODEL_NAME = "llama-3.1-8b-instant"
VAD_THRESHOLD = 5  
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

SYSTEM_PROMPT_ZH = """
你是繁體中文 AI 助手。
無論使用者輸入中文、英文、日文或語音轉文字結果如何，你都必須使用繁體中文回答。
請不要使用英文回答，除非使用者明確要求翻譯或要求英文。
回答要自然、清楚，符合台灣使用者習慣。
"""

SUMMARY_PROMPT_ZH = """
請整理目前對話中需要延續到下一段對話的重要資訊。
請一定使用繁體中文。
不要使用英文。
請用繁體中文條列。
最多 8 點，每點 20 字以內。

必須優先保留：
1. 住宿位置
2. 預算
3. 必去景點
4. 同行者限制
5. 飲食限制
6. 使用者偏好
7. 已決定行程
8. 後續注意事項
"""