# backend/core/scenario_c.py
import os
from groq import Groq
from utils import counter, logger
import config

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

async def handle_chat(req):
    """
    處理情境 C (摘要遷移)：
    1. 偵測硬上限：若爆掉 (>=300)，立刻生成摘要並回傳 warning 以鎖定前端。
    """
    current_tokens = counter.estimate_tokens(req.history)
    summary = None
    
    # 💡 修正：偵測到硬上限時，立刻處理摘要並阻斷輸入
    if current_tokens >= config.TOKEN_THRESHOLD:
        try:
            # 這裡加入 req.message，確保摘要包含使用者最後一句話
            summary_messages = req.history + [{"role": "user", "content": req.message}]
            summary_completion = client.chat.completions.create(
                model=config.MODEL_NAME,
                messages=[
                    {"role": "system", "content": "請用一句話摘要目前的對話重點，以便使用者開啟新對話。"},
                    *summary_messages
                ],
                max_tokens=150
            )
            summary = summary_completion.choices[0].message.content
        except Exception as e:
            print(f"❌ 爆掉時摘要生成失敗: {e}")

        return {
            "reply": "",
            "history": req.history,
            "status": "warning",
            "summary": summary, 
            "message": "⚠️ 記憶體已達上限。請點擊下方的「摘要遷移」按鈕開啟新對話。",
            "debug": { "tokens": current_tokens, "rounds": len(req.history) // 2 }
        }

    # 正常生成 AI 回覆
    completion = client.chat.completions.create(
        model=config.MODEL_NAME, 
        messages=req.history + [{"role": "user", "content": req.message}],
        temperature=0.7
    )
    
    ai_response = completion.choices[0].message.content
    updated_history = req.history + [
        {"role": "user", "content": req.message},
        {"role": "assistant", "content": ai_response}
    ]

    # 檢查預測性摘要門檻 (80%)
    status = "ok"
    if current_tokens > config.TOKEN_THRESHOLD * config.SUMMARY_THRESHOLD:
        try:
            summary_comp = client.chat.completions.create(
                model=config.MODEL_NAME,
                messages=[
                    {"role": "system", "content": "請用 50 字以內的一句話，精確摘要目前的對話進度。"},
                    *updated_history
                ],
                max_tokens=150,
            )
            summary = summary_comp.choices[0].message.content
            status = "limit_approaching"
        except Exception as e:
            print(f"❌ 預測性摘要生成失敗: {e}")

    # 紀錄實驗數據
    logger.log_event(
        subject_id=req.user_id,
        chat_id=req.chat_id, 
        scenario="C",
        trigger_type=req.trigger_type,
        user_input=req.message,
        ai_response=ai_response,
        tokens=current_tokens,
        rounds=len(updated_history) // 2
    )

    return {
        "reply": ai_response,
        "history": updated_history,
        "summary": summary,
        "status": status,
        "debug": { "tokens": current_tokens, "rounds": len(updated_history) // 2 }
    }