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
from experiment import state as state_manager

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


def _to_dict(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


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


class ParticipantStateSave(BaseModel):
    participant_id: str
    assignment_mode: Optional[str] = None
    assignment: Optional[Any] = None
    active_mission_id: Optional[str] = None
    active_chat_id: Optional[str] = None
    missions: list[dict[str, Any]]


class ConversationMessage(BaseModel):
    message_index: int
    role: str
    content: str


class ConversationMessagesLog(BaseModel):
    participant_id: str
    assignment_mode: Optional[str] = None
    mission_id: str
    mission_title: str
    phase_id: str
    phase_label: str
    chat_id: str
    condition: Optional[str] = None
    trigger_type: Optional[str] = None
    messages: list[ConversationMessage]




class InteractionEventLog(BaseModel):
    participant_id: str
    assignment_mode: Optional[str] = None
    event_type: str
    mission_id: Optional[str] = None
    mission_title: Optional[str] = None
    phase_id: Optional[str] = None
    phase_label: Optional[str] = None
    chat_id: Optional[str] = None
    condition: Optional[str] = None
    trigger_type: Optional[str] = None
    event_time_client: Optional[str] = None
    recording_duration_ms: Optional[float] = None
    silence_duration_ms: Optional[float] = None
    recovery_time_ms: Optional[float] = None
    text_length: Optional[int] = None
    details: Optional[Any] = None

class ResetEventLog(BaseModel):
    participant_id: str
    reset_type: str
    mission_id: str
    mission_title: str
    phase_id: Optional[str] = None
    phase_label: Optional[str] = None
    chat_count_removed: int = 0
    message_count_removed: int = 0
    reason: Optional[str] = ""
    operator: Optional[str] = ""


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
        VAD_SILENCE_TIMEOUT_C,
        VAD_THRESHOLD,
    )

    return {
        "round_limit": SCENARIO_A_ROUND_LIMIT,
        "token_threshold": TOKEN_THRESHOLD,
        "vad_timeout_a": VAD_SILENCE_TIMEOUT_A,
        "vad_timeout_b": VAD_SILENCE_TIMEOUT_B,
        "vad_timeout_c": VAD_SILENCE_TIMEOUT_C,
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
        result = assignment_manager.start_experiment(participant_id, mode)
        result["saved_state"] = state_manager.load_participant_state(participant_id)
        return result
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


@app.get("/experiment/state/{participant_id}")
async def get_participant_state(participant_id: str):
    state = state_manager.load_participant_state(participant_id)
    return {"participant_id": participant_id, "state": state}


@app.post("/experiment/state")
async def save_participant_state(req: ParticipantStateSave):
    try:
        state = state_manager.save_participant_state(_to_dict(req))
        return {"status": "participant state saved", "updated_at": state.get("updated_at")}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/experiment/messages")
async def log_conversation_messages(req: ConversationMessagesLog):
    try:
        count = state_manager.append_messages(_to_dict(req))
        return {"status": "messages logged", "count": count}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))




@app.post("/experiment/interaction_event")
async def log_interaction_event(req: InteractionEventLog):
    try:
        row = state_manager.log_interaction_event(_to_dict(req))
        return {"status": "interaction event logged", "event_type": row.get("Event_Type"), "recovery_time_ms": row.get("Recovery_Time_ms")}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/experiment/reset")
async def log_reset_event(req: ResetEventLog):
    try:
        state_manager.log_reset_event(_to_dict(req))
        return {"status": "reset logged"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


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
