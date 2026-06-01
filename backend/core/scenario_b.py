# backend/core/scenario_b.py
import os
from utils import logger
from groq import Groq
from dotenv import load_dotenv
from utils import counter
# 修正：補上 SCENARIO_B_TOKEN_THRESHOLD 的 import
from config import TOKEN_THRESHOLD, MODEL_NAME, SYSTEM_PROMPT_ZH
from utils.logger import log_event # 加上這行導入

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

async def handle_chat(req):
    history = req.history
    trigger = req.trigger_type
    current_tokens = counter.estimate_tokens(history)
    
    # 使用 config 中的 Token 門檻
    if current_tokens > TOKEN_THRESHOLD:
        return {
            "reply": "",
            "history": history,
            "status": "warning",
            "message": "⚠️ 此對話記憶體已達上限。為了確保 AI 回應品質，請點擊左側「新增對話」重新開始。",
            "debug": {
                "tokens": current_tokens,
                "rounds": len(history) // 2
            }
        }
    
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_ZH},
        *history,
        {"role": "user", "content": req.message}
    ]
    
    # 修正：模型名稱改由 config 控制
    completion = client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages
    )
    
    ai_response = completion.choices[0].message.content

    updated_history = history + [
        {"role": "user", "content": req.message},
        {"role": "assistant", "content": ai_response}
    ]
    print(f"[DATA] Scenario B - Trigger: {trigger}")

    # 在 return 前加入紀錄
    logger.log_event(
        subject_id=req.user_id,
        chat_id=req.chat_id,
        scenario="B",
        trigger_type=req.trigger_type,
        user_input=req.message,
        ai_response=ai_response,
        tokens=counter.estimate_tokens(updated_history),
        rounds=len(updated_history) // 2
    )

    return {
        "reply": ai_response,
        "history": updated_history,
        "status": "normal",
        "debug": {
            "tokens": counter.estimate_tokens(updated_history),
            "rounds": len(updated_history) // 2
        }
    }
    