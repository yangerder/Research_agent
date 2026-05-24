# backend/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from core import scenario_a, scenario_b, scenario_c
from utils import logger
import os # 加上這行
from typing import List, Optional
from config import SCENARIO_A_ROUND_LIMIT, TOKEN_THRESHOLD
from dotenv import load_dotenv # 修正：補上 load_dotenv
from groq import Groq
from fastapi import FastAPI, HTTPException, File, UploadFile 
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq
import os
from dotenv import load_dotenv
from core import scenario_a, scenario_b
from typing import List, Optional

load_dotenv()
app = FastAPI()
client = Groq(api_key=os.getenv("GROQ_API_KEY")) # 這樣這行才不會報錯

# 解決跨域問題，讓前端可以串接
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    user_id: str
    chat_id: str
    message: str
    history: list
    scenario: str  # "A" 代表隱性, "B" 代表顯性
    trigger_type: Optional[str] = "manual"

class MigrationLog(BaseModel):
    user_id: str
    chat_id: str
    migration_time: float
    summary: str

@app.get("/")
async def root():
    return {"status": "Research Backend is Running"}

@app.post("/chat")
async def chat(req: ChatRequest):
    # 紀錄實驗開始時間戳記，用於計算復原時間 
    if req.scenario == "A":
        # 執行隱性最佳化邏輯：10輪裁切 
        return await scenario_a.handle_chat(req)
    elif req.scenario == "B":
        # 執行顯性賦權邏輯：Token 警告 
        return await scenario_b.handle_chat(req)
    elif req.scenario == "C": # 💡 路由到情境 C
        return await scenario_c.handle_chat(req)
    else:
        raise HTTPException(status_code=400, detail="Invalid Scenario")
    
# 新增：語音轉文字接口 (STT)
@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    # 1. 暫存檔案到本地
    temp_filename = f"temp_{file.filename}"
    with open(temp_filename, "wb") as buffer:
        buffer.write(await file.read())

    try:
        # 2. 呼叫 Groq Whisper API
        with open(temp_filename, "rb") as audio_file:
            # 這裡使用 whisper-large-v3-turbo 模型
            transcription = client.audio.transcriptions.create(
                file=(temp_filename, audio_file.read()),
                model="whisper-large-v3-turbo",
                response_format="text",
            )
        return {"text": transcription}
    except Exception as e:
        return {"error": str(e)}, 500
    finally:
        # 3. 清理暫存檔
        if os.path.exists(temp_filename):
            os.remove(temp_filename)

@app.get("/config")
async def get_config():
    # 💡 修正處：確保導入的變數與 config.py 一致
    from config import SCENARIO_A_ROUND_LIMIT, TOKEN_THRESHOLD, VAD_SILENCE_TIMEOUT_A, VAD_SILENCE_TIMEOUT_B, VAD_THRESHOLD, SCENARIO_B_SHOW_HINT
    return {
        "round_limit": SCENARIO_A_ROUND_LIMIT,
        "token_threshold": TOKEN_THRESHOLD,
        "vad_timeout_a": VAD_SILENCE_TIMEOUT_A,
        "vad_timeout_b": VAD_SILENCE_TIMEOUT_B,
        "vad_threshold": VAD_THRESHOLD,
        "show_hint_b": SCENARIO_B_SHOW_HINT
    }

@app.post("/log_migration")
async def log_migration(req: MigrationLog):
    # 💡 紀錄遷移復原時間
    logger.log_migration(req.user_id, req.chat_id, req.migration_time, req.summary)
    return {"status": "Migration logged"}