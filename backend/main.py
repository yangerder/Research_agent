# backend/main.py
from pathlib import Path
import json
import os
import tempfile
from typing import Optional, Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from pydantic import BaseModel

from core import scenario_a, scenario_b, scenario_c
from utils import logger
from experiment import assignment as assignment_manager

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
TASK_DOC_DIR = BASE_DIR / "task_docs"
FLOW_CONFIG_PATH = BASE_DIR / "experiment_configs" / "between_subject.json"

app = FastAPI()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

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
    history: list[dict[str, Any]]
    scenario: str
    trigger_type: Optional[str] = "manual"
    phase_id: Optional[str] = None


class MigrationLog(BaseModel):
    user_id: str
    chat_id: str
    migration_time: float
    summary: str




class ExperimentStartRequest(BaseModel):
    participant_id: str
    assignment_mode: Optional[str] = "between_subject"


class PhaseCompletionLog(BaseModel):
    participant_id: str
    phase_id: str
    mission_title: str
    condition: Optional[str] = None
    phase_label: str
    title: str
    round_count: int
    chat_count: int
    started_at: Optional[str] = None
    ended_at: str


@app.get("/")
async def root():
    return {"status": "Research Backend is Running"}


@app.post("/chat")
async def chat(req: ChatRequest):
    if req.scenario == "A":
        return await scenario_a.handle_chat(req)
    if req.scenario == "B":
        return await scenario_b.handle_chat(req)
    if req.scenario == "C":
        return await scenario_c.handle_chat(req)

    raise HTTPException(status_code=400, detail="Invalid Scenario")


@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_path = tmp.name
            tmp.write(await file.read())

        with open(temp_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                file=(Path(temp_path).name, audio_file.read()),
                model="whisper-large-v3-turbo",
                response_format="text",
                language="zh",
                prompt="以下是繁體中文語音，內容與旅遊規劃、餐廳選擇、使用者實驗有關。請以繁體中文轉寫，不要翻譯成英文。",
            )

        return {"text": transcription}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.get("/config")
async def get_config():
    from config import (
        SCENARIO_A_ROUND_LIMIT,
        SCENARIO_B_SHOW_HINT,
        TOKEN_THRESHOLD,
        VAD_SILENCE_TIMEOUT_A,
        VAD_SILENCE_TIMEOUT_B,
        VAD_THRESHOLD,
    )

    return {
        "round_limit": SCENARIO_A_ROUND_LIMIT,
        "token_threshold": TOKEN_THRESHOLD,
        "vad_timeout_a": VAD_SILENCE_TIMEOUT_A,
        "vad_timeout_b": VAD_SILENCE_TIMEOUT_B,
        "vad_threshold": VAD_THRESHOLD,
        "show_hint_b": SCENARIO_B_SHOW_HINT,
    }




@app.post("/experiment/start")
async def start_experiment(req: ExperimentStartRequest):
    participant_id = req.participant_id.strip()
    if not participant_id:
        raise HTTPException(status_code=400, detail="participant_id is required")

    mode = req.assignment_mode or "between_subject"

    try:
        return assignment_manager.start_experiment(participant_id, mode)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.get("/experiment/flow")
async def get_experiment_flow():
    if not FLOW_CONFIG_PATH.exists():
        raise HTTPException(status_code=404, detail="Experiment flow config not found")

    with open(FLOW_CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/experiment/task_doc/{doc_id}")
async def get_task_doc(doc_id: str):
    safe_doc_id = Path(doc_id).name
    doc_path = TASK_DOC_DIR / f"{safe_doc_id}.md"

    if not doc_path.exists():
        raise HTTPException(status_code=404, detail=f"Task doc not found: {doc_id}")

    return {
        "doc_id": safe_doc_id,
        "content": doc_path.read_text(encoding="utf-8"),
    }


@app.post("/experiment/complete_phase")
async def complete_phase(req: PhaseCompletionLog):
    logger.log_phase_completion(
        participant_id=req.participant_id,
        phase_id=req.phase_id,
        mission_title=req.mission_title,
        condition=req.condition,
        phase_label=req.phase_label,
        title=req.title,
        round_count=req.round_count,
        chat_count=req.chat_count,
        started_at=req.started_at,
        ended_at=req.ended_at,
    )
    return {"status": "phase completion logged"}


@app.post("/log_migration")
async def log_migration(req: MigrationLog):
    logger.log_migration(req.user_id, req.chat_id, req.migration_time, req.summary)
    return {"status": "Migration logged"}
