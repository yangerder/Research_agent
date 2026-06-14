# backend/main.py
from pathlib import Path
import csv
import io
import json
import os
import tempfile
import time
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Optional, Any
from urllib.parse import urlencode

import config as app_config
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile, Query
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from pydantic import BaseModel

from core import scenario_a, scenario_b, scenario_c
from utils import logger
from experiment import assignment as assignment_manager
from experiment import state as state_manager
from experiment import database

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
TASK_DOC_DIR = BASE_DIR / "task_docs"
FLOW_CONFIG_PATH = BASE_DIR / "experiment_configs" / "between_subject.json"

app = FastAPI()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))
database.init_db()

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
    mission_id: Optional[str] = None
    mission_title: Optional[str] = None
    phase_label: Optional[str] = None
    task_type: Optional[str] = None
    current_phase: Optional[int] = None
    turn_count: Optional[int] = None
    input_method: Optional[str] = None
    t1_client_ms: Optional[float] = None
    t4_client_ms: Optional[float] = None
    t5_client_ms: Optional[float] = None
    previous_t4_client_ms: Optional[float] = None
    user_reengagement_ms: Optional[float] = None
    voice_duration_ms: Optional[float] = None
    whisper_stt_ms: Optional[float] = None
    interruption_count: Optional[int] = 0


class MigrationLog(BaseModel):
    user_id: str
    chat_id: str
    migration_time: float
    summary: str




class ExperimentStartRequest(BaseModel):
    participant_id: str
    assignment_mode: Optional[str] = "between_subject"
    # Qualtrics bridge fields. When any of these are supplied, the backend
    # validates that the full formal-entry parameter set is present.
    sid: Optional[str] = None
    qid: Optional[str] = None
    consent: Optional[str] = None
    study: Optional[str] = None
    text: Optional[str] = None
    voice: Optional[str] = None
    order: Optional[str] = None
    token: Optional[str] = None
    redirect_url: Optional[str] = None
    post_survey_url: Optional[str] = None
    device_browser: Optional[str] = None

class ExperimentCompleteRequest(BaseModel):
    participant_id: str
    qid: Optional[str] = None
    sid: Optional[str] = None
    study: Optional[str] = None
    redirect_url: Optional[str] = None
    completion_status: Optional[str] = "completed"
    event_time_client: Optional[str] = None
    metadata: Optional[Any] = None


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


class ActionLogRequest(BaseModel):
    subject_id: str
    task_type: str = "Platform"
    current_phase: int = 0
    mission_id: Optional[str] = ""
    mission_title: Optional[str] = ""
    phase_id: Optional[str] = ""
    phase_label: Optional[str] = ""
    chat_id: str = "unknown"
    turn_count: int = 0
    input_method: str = "Text"
    trigger_type: str = "manual"
    prompt_tokens: int = 0
    completion_tokens: int = 0
    interruption_count: int = 0
    user_reengagement_ms: int = 0
    client_roundtrip_ms: int = 0
    server_processing_ms: int = 0
    estimated_network_rtt_ms: int = 0
    network_rtt_ms: int = 0
    llm_ttft_ms: int = 0
    llm_total_generation_ms: int = 0
    whisper_stt_ms: int = 0
    raw_timing_json: Optional[Any] = None
    user_input_length_chars: int = 0
    correction_count: int = 0
    stt_transcript: Optional[str] = ""
    voice_duration_ms: int = 0
    manipulation_exposure_flag: bool = False
    user_input: Optional[str] = ""
    ai_response: Optional[str] = ""


class BaselineUpdateRequest(BaseModel):
    participant_id: str
    baseline_typing_wpm: Optional[float] = None
    baseline_typing_cpm_chinese: Optional[float] = None
    baseline_typing_duration_ms: Optional[int] = None
    baseline_typing_accuracy: Optional[float] = None
    baseline_speech_ratio: Optional[float] = None
    baseline_speech_duration_ms: Optional[int] = None
    baseline_voice_frames: Optional[int] = None
    baseline_silence_frames: Optional[int] = None
    phase0_completed: Optional[bool] = None
    raw_baseline_json: Optional[Any] = None


class ActionTimingUpdateRequest(BaseModel):
    action_log_id: int
    t1_client_ms: Optional[float] = None
    t4_client_ms: Optional[float] = None
    t5_client_ms: Optional[float] = None
    previous_t4_client_ms: Optional[float] = None
    user_reengagement_ms: Optional[float] = None


@app.get("/")
async def root():
    return {"status": "Research Backend is Running"}



def _get_chunk_text(chunk: Any) -> str:
    try:
        choice = chunk.choices[0]
        delta = getattr(choice, "delta", None)
        if delta is not None:
            value = getattr(delta, "content", None)
            if value:
                return value
        message = getattr(choice, "message", None)
        if message is not None:
            value = getattr(message, "content", None)
            if value:
                return value
    except Exception:
        return ""
    return ""


@contextmanager
def _collect_groq_chat_timing() -> Any:
    """Temporarily force scenario chat completions into streaming mode.

    The scenario modules still receive a normal-looking completion object
    (`choices[0].message.content`), but we can capture the real first streamed
    chunk timestamp for LLM_TTFT_ms as requested by the experiment spec.
    """
    metrics: dict[str, Any] = {"calls": []}
    modules = [scenario_a, scenario_b, scenario_c]
    originals: list[tuple[Any, Any]] = []

    def make_wrapper(original_create):
        def wrapped_create(*args, **kwargs):
            call_started_ms = time.perf_counter() * 1000
            call_metric = {
                "call_started_server_ms": call_started_ms,
                "first_token_server_ms": None,
                "call_finished_server_ms": None,
                "streaming_forced": False,
                "fallback_non_streaming": False,
            }
            try:
                # Preserve explicitly streaming callers by wrapping their iterator.
                if kwargs.get("stream") is True:
                    stream = original_create(*args, **kwargs)

                    def timing_iterator():
                        for chunk in stream:
                            if call_metric["first_token_server_ms"] is None:
                                call_metric["first_token_server_ms"] = time.perf_counter() * 1000
                            yield chunk
                        call_metric["call_finished_server_ms"] = time.perf_counter() * 1000
                        metrics["calls"].append(call_metric)

                    return timing_iterator()

                # Non-streaming scenario code is converted to streaming so TTFT
                # is measured at the first chunk, while returning a compatible
                # object to existing scenario_a/b/c code.
                stream_kwargs = dict(kwargs)
                stream_kwargs["stream"] = True
                call_metric["streaming_forced"] = True
                stream = original_create(*args, **stream_kwargs)
                content_parts: list[str] = []
                for chunk in stream:
                    if call_metric["first_token_server_ms"] is None:
                        call_metric["first_token_server_ms"] = time.perf_counter() * 1000
                    text = _get_chunk_text(chunk)
                    if text:
                        content_parts.append(text)
                call_metric["call_finished_server_ms"] = time.perf_counter() * 1000
                metrics["calls"].append(call_metric)
                content = "".join(content_parts)
                return SimpleNamespace(
                    choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
                    usage=None,
                )
            except TypeError:
                # SDK/model compatibility fallback: still record total server
                # processing but explicitly mark that TTFT was not measurable.
                call_metric["fallback_non_streaming"] = True
                completion = original_create(*args, **kwargs)
                call_metric["call_finished_server_ms"] = time.perf_counter() * 1000
                metrics["calls"].append(call_metric)
                return completion
        return wrapped_create

    try:
        for module in modules:
            module_client = getattr(module, "client", None)
            if not module_client:
                continue
            completions = getattr(getattr(module_client, "chat", None), "completions", None)
            if not completions or not hasattr(completions, "create"):
                continue
            original = completions.create
            originals.append((completions, original))
            completions.create = make_wrapper(original)
        yield metrics
    finally:
        for completions, original in originals:
            completions.create = original


@app.post("/chat")
async def chat(req: ChatRequest):
    request_received_server = time.perf_counter() * 1000
    try:
        with _collect_groq_chat_timing() as groq_timing:
            if req.scenario == "A":
                data = await scenario_a.handle_chat(req)
            elif req.scenario == "B":
                data = await scenario_b.handle_chat(req)
            elif req.scenario == "C":
                data = await scenario_c.handle_chat(req)
            else:
                raise HTTPException(status_code=400, detail="Invalid Scenario")

        response_end_server = time.perf_counter() * 1000
        server_processing_ms = max(0, response_end_server - request_received_server)

        history = data.get("history", []) if isinstance(data, dict) else []
        last_assistant = ""
        for msg in reversed(history):
            if msg.get("role") == "assistant":
                last_assistant = msg.get("content", "")
                break

        debug = data.get("debug", {}) if isinstance(data, dict) else {}
        groq_calls = groq_timing.get("calls", []) if isinstance(groq_timing, dict) else []
        primary_groq_call = groq_calls[0] if groq_calls else {}
        first_token_server_ms = primary_groq_call.get("first_token_server_ms")
        llm_ttft_ms = 0
        if first_token_server_ms is not None:
            llm_ttft_ms = max(0, int(round(float(first_token_server_ms) - float(request_received_server))))
        prompt_tokens = int(debug.get("tokens", 0) or database.estimate_tokens(json.dumps(req.history, ensure_ascii=False) + req.message))
        completion_tokens = int(debug.get("completion_tokens", 0) or database.estimate_tokens(last_assistant))
        task_type = req.task_type or ("Voice_Restaurant" if "voice" in str(req.phase_id).lower() else "Text_Travel" if "text" in str(req.phase_id).lower() else "Platform")
        current_phase = req.current_phase
        if current_phase is None:
            try:
                current_phase = int(str(req.phase_label or "").replace("Phase", "").strip() or 0)
            except Exception:
                current_phase = 0

        raw_timing = {
            "t1_client_ms": req.t1_client_ms,
            "t4_client_ms": None,
            "t5_client_ms": req.t5_client_ms,
            "previous_t4_client_ms": req.previous_t4_client_ms,
            "request_received_server_ms": request_received_server,
            "first_token_server_ms": first_token_server_ms,
            "response_end_server_ms": response_end_server,
            "timing_definition": {
                "t1_client_ms": "Browser performance.now() immediately before fetch(/chat).",
                "t4_client_ms": "Browser performance.now() after AI response is rendered; updated by /experiment/action_timing_update.",
                "t5_client_ms": "Browser performance.now() at the user's first re-engagement action before this turn, such as first key/mic click.",
                "previous_t4_client_ms": "Browser performance.now() of the previous AI response completion used to compute User_Reengagement_ms.",
                "request_received_server_ms": "Server monotonic/perf_counter timestamp at route entry.",
                "first_token_server_ms": "Server monotonic/perf_counter timestamp at the first streamed Groq chat completion chunk.",
                "response_end_server_ms": "Server monotonic/perf_counter timestamp after backend response is ready.",
            },
            "clock_note": "Client performance.now() and server monotonic clocks are stored separately and must not be directly subtracted.",
        }

        action_log_id = database.log_action({
            "Subject_ID": req.user_id,
            "Task_Type": task_type,
            "Current_Phase": current_phase or 0,
            "Mission_ID": req.mission_id or "",
            "Mission_Title": req.mission_title or "",
            "Phase_ID": req.phase_id or "",
            "Phase_Label": req.phase_label or "",
            "Chat_ID": req.chat_id,
            "Turn_Count": req.turn_count or int(debug.get("rounds", 0) or 0),
            "Input_Method": req.input_method or ("Voice" if req.trigger_type == "auto_vad" else "Text"),
            "Trigger_Type": req.trigger_type or "manual",
            "Prompt_Tokens": prompt_tokens,
            "Completion_Tokens": completion_tokens,
            "Interruption_Count": int(req.interruption_count or (1 if req.trigger_type == "auto_vad" else 0)),
            "User_Reengagement_ms": req.user_reengagement_ms or 0,
            "Client_Roundtrip_ms": 0,
            "Server_Processing_ms": round(server_processing_ms),
            "Estimated_Network_RTT_ms": 0,
            "Network_RTT_ms": 0,
            "LLM_TTFT_ms": llm_ttft_ms,
            "LLM_Total_Generation_ms": round(server_processing_ms),
            "Whisper_STT_ms": req.whisper_stt_ms or 0,
            "Raw_Timing_JSON": raw_timing,
            "User_Input_Length_Chars": len(req.message or ""),
            "STT_Transcript": req.message if (req.input_method == "Voice" or req.trigger_type == "auto_vad") else "",
            "Voice_Duration_ms": req.voice_duration_ms or 0,
            "Manipulation_Exposure_Flag": 1 if (
                req.trigger_type == "auto_vad"
                or (isinstance(data, dict) and (data.get("status") == "warning" or bool(data.get("summary"))))
            ) else 0,
            "User_Input": req.message,
            "AI_Response": last_assistant,
        })

        if isinstance(data, dict):
            data["action_log_id"] = action_log_id
            data["server_timing"] = {
                "server_processing_ms": round(server_processing_ms, 2),
                "request_received_server_ms": request_received_server,
                "first_token_server_ms": first_token_server_ms,
                "response_end_server_ms": response_end_server,
                "llm_ttft_ms": llm_ttft_ms,
                "groq_chat_completion_calls": groq_calls,
                "clock_note": "Client and server clocks are not directly comparable.",
            }
        return data
    except HTTPException:
        raise
    except Exception as e:
        database.log_system_error(req.user_id if req else None, "api_failure", str(e), metadata={"route": "/chat", "phase_id": getattr(req, "phase_id", None)})
        raise


@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_path = tmp.name
            tmp.write(await file.read())

        stt_start = time.perf_counter() * 1000
        with open(temp_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                file=(Path(temp_path).name, audio_file.read()),
                model="whisper-large-v3-turbo",
                response_format="text",
            )
        stt_end = time.perf_counter() * 1000

        return {"text": transcription, "whisper_stt_ms": round(stt_end - stt_start, 2)}
    except Exception as e:
        database.log_system_error(None, "whisper_failure", str(e), metadata={"filename": file.filename})
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





QUALTRICS_REQUIRED_PARAMS = ["sid", "qid", "consent", "study", "token"]
QUALTRICS_OPTIONAL_ASSIGNMENT_PARAMS = ["text", "voice", "order"]

def _is_qualtrics_start(req: ExperimentStartRequest) -> bool:
    return any(bool(getattr(req, name, None)) for name in QUALTRICS_REQUIRED_PARAMS + QUALTRICS_OPTIONAL_ASSIGNMENT_PARAMS + ["redirect_url", "post_survey_url"])

def _normalize_condition(value: Optional[str], allowed: set[str]) -> str:
    normalized = str(value or "").strip().upper()
    if normalized not in allowed:
        raise ValueError(f"Invalid condition: {value}")
    return normalized

def _configured_assignment_mode(requested_mode: Optional[str] = None) -> str:
    mode = (requested_mode or getattr(app_config, "EXPERIMENT_ASSIGNMENT_MODE", "between_subject") or "between_subject").strip()
    if mode not in {"between_subject", "within_subject"}:
        return "between_subject"
    return mode

def _assignment_cell(assignment: dict[str, Any]) -> str:
    mode = assignment.get("assignment_mode", "")
    if mode == "within_subject":
        return f"text_order={assignment.get('text_order','')};voice_order={assignment.get('voice_order','')}"
    return f"text={assignment.get('text_condition','')};voice={assignment.get('voice_condition','')}"

def _apply_url_assignment_override(mode: str, assignment: dict[str, Any], req: ExperimentStartRequest) -> dict[str, Any]:
    """Optionally override backend randomization from URL text/voice/order.

    Normal mode for this project is backend randomization: Qualtrics only passes
    sid/qid/consent/study/token. However, keeping this override allows pilot tests
    or future Qualtrics-side randomization without another code change.
    """
    allow_override = bool(getattr(app_config, "QUALTRICS_ALLOW_URL_CONDITION_OVERRIDE", True))
    require_url_assignment = bool(getattr(app_config, "QUALTRICS_REQUIRE_CONDITION_IN_URL", False))
    has_any_assignment_param = any(str(getattr(req, name, "") or "").strip() for name in QUALTRICS_OPTIONAL_ASSIGNMENT_PARAMS)

    if require_url_assignment and not has_any_assignment_param:
        raise ValueError("Qualtrics URL must include text/voice/order because QUALTRICS_REQUIRE_CONDITION_IN_URL=True")
    if not allow_override or not has_any_assignment_param:
        assignment = dict(assignment)
        assignment["qualtrics_locked"] = "1"
        assignment["assignment_source"] = "backend_random"
        return assignment

    assignment = dict(assignment)
    assignment["assignment_mode"] = mode
    assignment["qualtrics_locked"] = "1"
    assignment["assignment_source"] = "url_override"

    if mode == "within_subject":
        assignment["text_order"] = _normalize_condition(req.text, {"ABC", "ACB", "BAC", "BCA", "CAB", "CBA"})
        assignment["voice_order"] = _normalize_condition(req.voice, {"AB", "BA"})
    else:
        assignment["text_condition"] = _normalize_condition(req.text, {"A", "B", "C"})
        assignment["voice_condition"] = _normalize_condition(req.voice, {"A", "B"})
    return assignment

def _build_qualtrics_redirect_url(base_url: str, *, sid: str = "", qid: str = "", study: str = "", status: str = "completed") -> str:
    if not base_url:
        return ""
    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}{urlencode({'sid': sid, 'qid': qid, 'study': study, 'task_done': '1', 'completion': status})}"

@app.post("/experiment/start")
async def start_experiment(req: ExperimentStartRequest):
    participant_id = (req.sid or req.participant_id or "").strip()
    if not participant_id:
        raise HTTPException(status_code=400, detail="participant_id or sid is required")

    qualtrics_entry = _is_qualtrics_start(req)
    # For formal Qualtrics entry, backend/config.py is the source of truth for
    # randomization mode. The frontend may still send a default assignment_mode,
    # so do not let that override config.py.
    mode = _configured_assignment_mode(None if qualtrics_entry else req.assignment_mode)

    if qualtrics_entry:
        missing = [name for name in QUALTRICS_REQUIRED_PARAMS if not str(getattr(req, name, "") or "").strip()]
        if missing:
            database.log_system_error(
                participant_id or None,
                "missing_query_param",
                f"Missing Qualtrics URL parameters: {', '.join(missing)}",
                recoverability="blocking",
                metadata={"missing": missing, "received": _to_dict(req)},
            )
            raise HTTPException(status_code=400, detail={"error": "missing_query_param", "missing": missing})

        consent_value = str(req.consent or "").strip().lower()
        if consent_value not in {"yes", "y", "true", "1", "agree", "agreed"}:
            database.log_system_error(
                participant_id,
                "consent_not_granted",
                "Qualtrics entry attempted without consent=yes.",
                recoverability="blocking",
                metadata={"consent": req.consent, "qid": req.qid, "study": req.study},
            )
            raise HTTPException(status_code=403, detail={"error": "consent_not_granted"})

        # Formal Qualtrics entry is locked, but assignment can either be
        # generated by the backend or explicitly overridden by URL parameters.
        # The default mode/capacity settings live in backend/config.py.

    try:
        result = assignment_manager.start_experiment(participant_id, mode)
        assignment = result.get("assignment", {})

        if qualtrics_entry:
            try:
                assignment = _apply_url_assignment_override(result.get("assignment_mode", mode), assignment, req)
            except ValueError as e:
                database.log_system_error(
                    participant_id,
                    "invalid_assignment_param",
                    str(e),
                    recoverability="blocking",
                    metadata={"text": req.text, "voice": req.voice, "order": req.order, "qid": req.qid, "assignment_mode": mode},
                )
                raise HTTPException(status_code=400, detail={"error": "invalid_assignment_param", "message": str(e)})

            config = assignment_manager.load_config(assignment.get("assignment_mode", mode))
            result["assignment_mode"] = assignment.get("assignment_mode", mode)
            result["assignment"] = assignment
            result["phases"] = assignment_manager.build_flow(config, assignment)

        assignment_cell = _assignment_cell(assignment)
        randomization_block_id = f"{result.get('assignment_mode', mode)}:{assignment.get('assignment_source', 'backend_random' if qualtrics_entry else 'app_random')}"

        database.upsert_participant(
            participant_id,
            qualtrics_response_id=req.qid or "",
            consent_status=("granted" if qualtrics_entry else "unknown"),
            assignment_mode=result.get("assignment_mode", mode),
            assigned_text_scenario=(assignment.get("text_condition") or assignment.get("text_order", "")),
            assigned_voice_condition=(assignment.get("voice_condition") or assignment.get("voice_order", "")),
            study_mode=req.study or "",
            assigned_task_order=req.order or assignment.get("text_order") or "",
            randomization_block_id=randomization_block_id,
            randomization_cell=assignment_cell,
            device_browser=req.device_browser or "",
            run_token=req.token or "",
            task_completion_status="partial",
            pre_survey_completed=True if qualtrics_entry else None,
        )

        if qualtrics_entry:
            database.log_event(
                participant_id,
                "qualtrics_entry_validated",
                task_type="Platform",
                current_phase=0,
                mission_id="qualtrics_bridge",
                mission_title="Qualtrics Bridge",
                phase_id="qualtrics_entry",
                phase_label="Entry",
                trigger_type="url_entry",
                metadata={
                    "sid": participant_id,
                    "qid": req.qid,
                    "study": req.study,
                    "assignment_mode": result.get("assignment_mode", mode),
                    "assignment_source": assignment.get("assignment_source", "backend_random"),
                    "text": assignment.get("text_condition") or assignment.get("text_order") or req.text,
                    "voice": assignment.get("voice_condition") or assignment.get("voice_order") or req.voice,
                    "order": req.order or assignment.get("text_order") or "",
                    "randomization_cell": assignment_cell,
                    "token_hash": database.hash_token(req.token),
                    "redirect_url_present": bool(req.redirect_url or req.post_survey_url),
                    "device_browser": req.device_browser,
                },
            )

        result["qualtrics"] = {
            "enabled": qualtrics_entry,
            "sid": participant_id,
            "qid": req.qid or "",
            "study": req.study or "",
            "assignment_mode": result.get("assignment_mode", mode),
            "assignment_source": assignment.get("assignment_source", "backend_random" if qualtrics_entry else "app_random"),
            "text": assignment.get("text_condition") or assignment.get("text_order") or req.text or "",
            "voice": assignment.get("voice_condition") or assignment.get("voice_order") or req.voice or "",
            "order": req.order or assignment.get("text_order") or "",
            "redirect_url": req.redirect_url or req.post_survey_url or "",
        }
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
        # Phase 0 baseline events are formal experiment events.
        # Log them directly to SQLite as Phase0_Baseline instead of the generic
        # legacy Platform event format, so the baseline event stream stays clean.
        if req.event_type in {"baseline_typing_start", "baseline_speech_start"}:
            metadata = {
                "trigger_type": req.trigger_type,
                "event_time_client": req.event_time_client,
                "recording_duration_ms": req.recording_duration_ms,
                "silence_duration_ms": req.silence_duration_ms,
                "recovery_time_ms": req.recovery_time_ms,
                "text_length": req.text_length,
                "details": req.details,
            }
            database.log_event(
                req.participant_id,
                req.event_type,
                task_type="Phase0_Baseline",
                current_phase=0,
                mission_id=req.mission_id or "phase0_baseline",
                mission_title=req.mission_title or "Phase 0｜基準測試",
                phase_id=req.phase_id or "phase0_baseline",
                phase_label=req.phase_label or "Phase 0",
                chat_id=req.chat_id or "",
                condition=req.condition or "",
                trigger_type=req.trigger_type or "",
                metadata=metadata,
            )
            return {"status": "interaction event logged", "event_type": req.event_type, "recovery_time_ms": req.recovery_time_ms}

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


@app.post("/experiment/action_log")
async def log_action_log(req: ActionLogRequest):
    row = _to_dict(req)
    database.log_action({
        "Subject_ID": row.get("subject_id"),
        "Task_Type": row.get("task_type"),
        "Current_Phase": row.get("current_phase"),
        "Mission_ID": row.get("mission_id"),
        "Mission_Title": row.get("mission_title"),
        "Phase_ID": row.get("phase_id"),
        "Phase_Label": row.get("phase_label"),
        "Chat_ID": row.get("chat_id"),
        "Turn_Count": row.get("turn_count"),
        "Input_Method": row.get("input_method"),
        "Trigger_Type": row.get("trigger_type"),
        "Prompt_Tokens": row.get("prompt_tokens"),
        "Completion_Tokens": row.get("completion_tokens"),
        "Interruption_Count": row.get("interruption_count"),
        "User_Reengagement_ms": row.get("user_reengagement_ms"),
        "Client_Roundtrip_ms": row.get("client_roundtrip_ms"),
        "Server_Processing_ms": row.get("server_processing_ms"),
        "Estimated_Network_RTT_ms": row.get("estimated_network_rtt_ms"),
        "Network_RTT_ms": row.get("network_rtt_ms"),
        "LLM_TTFT_ms": row.get("llm_ttft_ms"),
        "LLM_Total_Generation_ms": row.get("llm_total_generation_ms"),
        "Whisper_STT_ms": row.get("whisper_stt_ms"),
        "Raw_Timing_JSON": row.get("raw_timing_json"),
        "User_Input_Length_Chars": row.get("user_input_length_chars"),
        "Correction_Count": row.get("correction_count"),
        "STT_Transcript": row.get("stt_transcript"),
        "Voice_Duration_ms": row.get("voice_duration_ms"),
        "Manipulation_Exposure_Flag": int(bool(row.get("manipulation_exposure_flag"))),
        "User_Input": row.get("user_input"),
        "AI_Response": row.get("ai_response"),
    })
    return {"status": "action log saved"}



def _phase0_metadata_from_row(row: dict) -> dict:
    """Build complete, analysis-ready Phase 0 metadata from the Participants row."""
    if not row:
        return {}
    return {
        "baseline_typing_wpm": row.get("Baseline_Typing_WPM"),
        "baseline_typing_cpm_chinese": row.get("Baseline_Typing_CPM_Chinese"),
        "baseline_typing_duration_ms": row.get("Baseline_Typing_Duration_ms"),
        "baseline_typing_accuracy": row.get("Baseline_Typing_Accuracy"),
        "baseline_speech_ratio": row.get("Baseline_Speech_Ratio"),
        "baseline_speech_duration_ms": row.get("Baseline_Speech_Duration_ms"),
        "baseline_voice_frames": row.get("Baseline_Voice_Frames"),
        "baseline_silence_frames": row.get("Baseline_Silence_Frames"),
        "phase0_completed": bool(row.get("Phase0_Completed")) if row.get("Phase0_Completed") is not None else None,
        "phase0_completed_at": row.get("Phase0_Completed_At"),
        "baseline_raw_json": row.get("Baseline_Raw_JSON"),
    }

def _phase0_current_metadata(participant_id: str, overrides: Optional[dict] = None) -> dict:
    row = database.get_participant_baseline(participant_id)
    metadata = _phase0_metadata_from_row(row)
    if overrides:
        metadata.update({k: v for k, v in overrides.items() if v is not None})
    return metadata

@app.post("/experiment/action_timing_update")
async def update_action_timing(req: ActionTimingUpdateRequest):
    database.update_action_timing(
        req.action_log_id,
        t1_client_ms=req.t1_client_ms,
        t4_client_ms=req.t4_client_ms,
        t5_client_ms=req.t5_client_ms,
        previous_t4_client_ms=req.previous_t4_client_ms,
        user_reengagement_ms=req.user_reengagement_ms,
    )
    return {"status": "action timing updated", "action_log_id": req.action_log_id}


@app.post("/experiment/baseline")
async def update_baseline(req: BaselineUpdateRequest):
    database.update_participant_baseline(
        req.participant_id,
        typing_wpm=req.baseline_typing_wpm,
        typing_cpm_chinese=req.baseline_typing_cpm_chinese,
        typing_duration_ms=req.baseline_typing_duration_ms,
        typing_accuracy=req.baseline_typing_accuracy,
        speech_ratio=req.baseline_speech_ratio,
        speech_duration_ms=req.baseline_speech_duration_ms,
        voice_frames=req.baseline_voice_frames,
        silence_frames=req.baseline_silence_frames,
        phase0_completed=req.phase0_completed,
        raw_json=req.raw_baseline_json,
    )

    # Build complete metadata from the stored Participants row after update.
    # This keeps phase0_complete analysis-ready and avoids null-only metadata.
    metadata = _phase0_current_metadata(
        req.participant_id,
        overrides={
            "request_raw_baseline_json": req.raw_baseline_json,
        },
    )

    if req.baseline_typing_wpm is not None or req.baseline_typing_cpm_chinese is not None:
        database.log_event(
            req.participant_id,
            "baseline_typing_complete",
            task_type="Phase0_Baseline",
            current_phase=0,
            mission_id="phase0_baseline",
            mission_title="Phase 0｜基準測試",
            phase_id="phase0_baseline",
            phase_label="Phase 0",
            trigger_type="phase0_typing_submit",
            metadata=metadata,
        )
    if req.baseline_speech_ratio is not None:
        database.log_event(
            req.participant_id,
            "baseline_speech_complete",
            task_type="Phase0_Baseline",
            current_phase=0,
            mission_id="phase0_baseline",
            mission_title="Phase 0｜基準測試",
            phase_id="phase0_baseline",
            phase_label="Phase 0",
            trigger_type="phase0_speech_recording_stop",
            metadata=metadata,
        )
    if req.phase0_completed:
        database.log_event(
            req.participant_id,
            "phase0_complete",
            task_type="Phase0_Baseline",
            current_phase=0,
            mission_id="phase0_baseline",
            mission_title="Phase 0｜基準測試",
            phase_id="phase0_baseline",
            phase_label="Phase 0",
            trigger_type="phase0_complete_button",
            metadata=metadata,
        )
    return {"status": "baseline updated"}



@app.post("/experiment/complete")
async def complete_experiment(req: ExperimentCompleteRequest):
    participant_id = (req.sid or req.participant_id or "").strip()
    if not participant_id:
        raise HTTPException(status_code=400, detail="participant_id or sid is required")

    status = req.completion_status or "completed"
    redirected = bool(req.redirect_url)
    database.mark_completed(participant_id, status=status, post_survey_redirected=redirected)
    final_redirect_url = _build_qualtrics_redirect_url(
        req.redirect_url or "",
        sid=req.sid or participant_id,
        qid=req.qid or "",
        study=req.study or "",
        status=status,
    )
    database.log_event(
        participant_id,
        "redirect_to_qualtrics" if redirected else "experiment_complete_no_redirect",
        task_type="Platform",
        current_phase=0,
        mission_id="qualtrics_bridge",
        mission_title="Qualtrics Bridge",
        phase_id="qualtrics_redirect",
        phase_label="Completion",
        trigger_type="experiment_complete",
        metadata={
            "sid": req.sid or participant_id,
            "qid": req.qid,
            "study": req.study,
            "completion_status": status,
            "event_time_client": req.event_time_client,
            "redirect_url": final_redirect_url,
            "metadata": req.metadata,
        },
    )
    return {"status": "experiment completed", "redirect_url": final_redirect_url}

@app.get("/api/admin/export")
async def admin_export(password: str = Query("")):
    from config import DEV_PASSWORD
    if password != DEV_PASSWORD:
        raise HTTPException(status_code=403, detail="Invalid admin password")
    data = database.export_sqlite_to_zip_bytes()
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=experiment_export.zip"},
    )


@app.post("/experiment/system_error")
async def log_system_error(payload: dict[str, Any]):
    database.log_system_error(
        payload.get("participant_id") or payload.get("subject_id"),
        payload.get("error_type", "api_failure"),
        payload.get("error_message", ""),
        recoverability=payload.get("recoverability", "recoverable"),
        metadata=payload.get("metadata"),
    )
    return {"status": "system error logged"}


@app.post("/log_migration")
async def log_migration(req: MigrationLog):
    logger.log_migration(req.user_id, req.chat_id, req.migration_time, req.summary)
    database.log_event(
        req.user_id,
        "migration_click",
        task_type="Text_Travel",
        current_phase=0,
        chat_id=req.chat_id,
        metadata={"migration_time_ms": req.migration_time, "summary_length": len(req.summary or ""), "summary": req.summary},
    )
    return {"status": "Migration logged"}
