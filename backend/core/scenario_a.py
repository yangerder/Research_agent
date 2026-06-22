# backend/core/scenario_a.py
from utils import logger

from utils import counter
from config import SCENARIO_A_MSG_LIMIT, MODEL_NAME, SYSTEM_PROMPT_ZH
from core.llm_provider import get_chat_client, get_active_llm_model
from utils.logger import log_event

client = get_chat_client()

async def handle_chat(req):
    history = req.history
    trigger = req.trigger_type # 取得來源：'manual' 或 'auto_vad'
    
    # 修正：使用正確的變數名稱，並根據 config 動態裁切
    if len(history) > SCENARIO_A_MSG_LIMIT:
        history = history[-SCENARIO_A_MSG_LIMIT:]
    
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_ZH},
        *history,
        {"role": "user", "content": req.message}
    ]
    
    # 修正：模型名稱改由 config 控制
    completion = client.chat.completions.create(
        model=get_active_llm_model(), 
        messages=messages
    )
    
    ai_response = completion.choices[0].message.content

    updated_history = history + [
        {"role": "user", "content": req.message},
        {"role": "assistant", "content": ai_response}
    ]

    print(f"[DATA] Scenario A - Trigger: {trigger}, Rounds: {len(updated_history)//2}")
    
    current_tokens = counter.estimate_tokens(updated_history)
    current_rounds = len(updated_history) // 2

    # 在 return 前加入紀錄
    logger.log_event(
        subject_id=req.user_id,
        chat_id=req.chat_id,
        scenario="A",
        trigger_type=req.trigger_type,
        user_input=req.message,
        ai_response=ai_response,
        tokens=current_tokens,
        rounds=current_rounds
    )

    return {
        "reply": ai_response,
        "history": updated_history,
        "status": "normal",
        "debug": {
            "tokens": current_tokens,
            "rounds": current_rounds
        }
    }