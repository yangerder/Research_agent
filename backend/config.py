# backend/config.py

# 全域設定
MODEL_NAME = "llama-3.1-8b-instant"
VAD_THRESHOLD = 0.015 
DEV_PASSWORD = "1234"

# 實驗 A (隱性裁切) 參數
SCENARIO_A_ROUND_LIMIT = 6 
SCENARIO_A_MSG_LIMIT = SCENARIO_A_ROUND_LIMIT * 2 
VAD_SILENCE_TIMEOUT_A = 1.0  

# 核心實驗門檻 (情境 B 與 C 共用) 💡 統一變數
TOKEN_THRESHOLD = 6000       # 總上限：300 tokens
SUMMARY_THRESHOLD = 0.8      # 觸發總結門檻 (2400 tokens)
SCENARIO_B_SHOW_HINT = True  
VAD_SILENCE_TIMEOUT_B = 1.0  
VAD_SILENCE_TIMEOUT_C = 1.0

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
# -----------------------------
# Experiment assignment settings
# -----------------------------
# Choose the default randomization design used when the Qualtrics URL does not
# explicitly provide text/voice/order. Valid values:
#   "between_subject": each participant gets one text condition and one voice condition
#   "within_subject": each participant gets all conditions in a balanced order
EXPERIMENT_ASSIGNMENT_MODE = "between_subject"

# If True, text/voice/order in the Qualtrics URL will override backend randomization.
# If False, the backend always uses EXPERIMENT_ASSIGNMENT_MODE randomization.
QUALTRICS_ALLOW_URL_CONDITION_OVERRIDE = True

# If True, Qualtrics URL must provide text and voice condition/order values.
# Recommended for the current design: False, so Qualtrics only needs sid/qid/consent/study/token.
QUALTRICS_REQUIRE_CONDITION_IN_URL = False

# Between-subject capacity controls.
# These are the maximum number of participants per condition before the assignment
# helper falls back to the least-used condition.
BETWEEN_SUBJECT_TEXT_MAX_PER_CONDITION = 20   # A/B/C
BETWEEN_SUBJECT_VOICE_MAX_PER_CONDITION = 20  # A/B

# Within-subject capacity controls.
# In within-subject mode, every participant sees all conditions, so balancing is
# by order/counterbalancing sequence rather than by condition.
WITHIN_SUBJECT_TEXT_MAX_PER_ORDER = 10        # ABC/ACB/BAC/BCA/CAB/CBA
WITHIN_SUBJECT_VOICE_MAX_PER_ORDER = 10       # AB/BA