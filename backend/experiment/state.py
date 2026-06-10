from __future__ import annotations

import csv
import json
import re
import os
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

BASE_DIR = Path(__file__).resolve().parents[1]
DATABASE_DIR = BASE_DIR / "database"
STATE_DIR = DATABASE_DIR / "participant_states"
MESSAGES_FILE = DATABASE_DIR / "messages.jsonl"
RESET_LOG_FILE = DATABASE_DIR / "reset_logs.csv"
INTERACTION_EVENT_FILE = DATABASE_DIR / "interaction_events.csv"
INTERACTION_EVENT_JSONL = DATABASE_DIR / "interaction_events.jsonl"

# In-memory helper for quick recovery-time calculation during one backend session.
# The frontend also sends recovery_time_ms when available, so analysis does not
# depend solely on this volatile tracker.
_unresolved_interruptions: Dict[str, float] = {}
_state_locks: Dict[str, threading.Lock] = {}
_state_locks_guard = threading.Lock()


def _get_state_lock(participant_id: str) -> threading.Lock:
    safe_id = _safe_participant_id(participant_id)
    with _state_locks_guard:
        if safe_id not in _state_locks:
            _state_locks[safe_id] = threading.Lock()
        return _state_locks[safe_id]


def _ensure_dirs() -> None:
    DATABASE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)


def _safe_participant_id(participant_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", participant_id.strip())
    return safe or "unknown"


def _state_path(participant_id: str) -> Path:
    return STATE_DIR / f"{_safe_participant_id(participant_id)}.json"


def load_participant_state(participant_id: str) -> Optional[Dict[str, Any]]:
    path = _state_path(participant_id)
    if not path.exists():
        return None

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def save_participant_state(payload: Dict[str, Any]) -> Dict[str, Any]:
    participant_id = str(payload.get("participant_id", "")).strip()
    if not participant_id:
        raise ValueError("participant_id is required")

    _ensure_dirs()

    lock = _get_state_lock(participant_id)
    with lock:
        now = datetime.now().isoformat()
        existing = load_participant_state(participant_id) or {}

        state = {
            **existing,
            **payload,
            "participant_id": participant_id,
            "created_at": existing.get("created_at") or now,
            "updated_at": now,
        }

        path = _state_path(participant_id)
        temp_path = path.with_name(f"{path.stem}.{uuid4().hex}.tmp")
        temp_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

        last_error: Optional[Exception] = None
        for _ in range(5):
            try:
                os.replace(temp_path, path)
                return state
            except PermissionError as exc:
                last_error = exc
                time.sleep(0.1)

        try:
            if temp_path.exists():
                temp_path.unlink()
        except Exception:
            pass

        raise last_error or PermissionError(f"Unable to replace participant state file: {path}")


def append_messages(payload: Dict[str, Any]) -> int:
    participant_id = str(payload.get("participant_id", "")).strip()
    messages: List[Dict[str, Any]] = payload.get("messages") or []
    if not participant_id:
        raise ValueError("participant_id is required")
    if not isinstance(messages, list):
        raise ValueError("messages must be a list")

    _ensure_dirs()

    common = {
        "participant_id": participant_id,
        "assignment_mode": payload.get("assignment_mode", ""),
        "mission_id": payload.get("mission_id", ""),
        "mission_title": payload.get("mission_title", ""),
        "phase_id": payload.get("phase_id", ""),
        "phase_label": payload.get("phase_label", ""),
        "chat_id": payload.get("chat_id", ""),
        "condition": payload.get("condition", ""),
        "trigger_type": payload.get("trigger_type", ""),
    }

    count = 0
    with open(MESSAGES_FILE, "a", encoding="utf-8") as f:
        for msg in messages:
            row = {
                "timestamp": datetime.now().isoformat(),
                **common,
                "message_index": msg.get("message_index", count),
                "role": msg.get("role", ""),
                "content": msg.get("content", ""),
            }
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            count += 1

    return count


def log_reset_event(payload: Dict[str, Any]) -> None:
    participant_id = str(payload.get("participant_id", "")).strip()
    if not participant_id:
        raise ValueError("participant_id is required")

    _ensure_dirs()

    file_exists = RESET_LOG_FILE.exists()
    headers = [
        "Timestamp",
        "Participant_ID",
        "Reset_Type",
        "Mission_ID",
        "Mission_Title",
        "Phase_ID",
        "Phase_Label",
        "Chat_Count_Removed",
        "Message_Count_Removed",
        "Reason",
        "Operator",
    ]

    with open(RESET_LOG_FILE, "a", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        if not file_exists:
            writer.writeheader()

        writer.writerow(
            {
                "Timestamp": datetime.now().isoformat(),
                "Participant_ID": participant_id,
                "Reset_Type": payload.get("reset_type", ""),
                "Mission_ID": payload.get("mission_id", ""),
                "Mission_Title": payload.get("mission_title", ""),
                "Phase_ID": payload.get("phase_id", ""),
                "Phase_Label": payload.get("phase_label", ""),
                "Chat_Count_Removed": payload.get("chat_count_removed", 0),
                "Message_Count_Removed": payload.get("message_count_removed", 0),
                "Reason": payload.get("reason", ""),
                "Operator": payload.get("operator", ""),
            }
        )


def log_interaction_event(payload: Dict[str, Any]) -> Dict[str, Any]:
    participant_id = str(payload.get("participant_id", "")).strip()
    if not participant_id:
        raise ValueError("participant_id is required")

    _ensure_dirs()

    event_type = str(payload.get("event_type", "")).strip()
    event_time_client = payload.get("event_time_client") or ""
    mission_id = payload.get("mission_id") or ""
    phase_id = payload.get("phase_id") or ""
    chat_id = payload.get("chat_id") or ""
    tracker_key = f"{participant_id}|{mission_id}|{phase_id}|{chat_id}"

    now = datetime.now()
    recovery_time_ms = payload.get("recovery_time_ms")

    # Auto VAD is treated as a system-triggered interruption candidate.
    # The next explicit user action can close this interruption window.
    if event_type in {"auto_vad_stop", "auto_vad_message_send", "micro_interruption"}:
        _unresolved_interruptions[tracker_key] = now.timestamp()

    if recovery_time_ms in (None, "") and event_type in {
        "manual_message_send",
        "manual_stop_recording",
        "recording_start",
        "resume_after_interruption",
    }:
        interruption_at = _unresolved_interruptions.pop(tracker_key, None)
        if interruption_at is not None:
            recovery_time_ms = round((now.timestamp() - interruption_at) * 1000, 2)

    details = payload.get("details", {})
    if not isinstance(details, str):
        details_text = json.dumps(details, ensure_ascii=False)
    else:
        details_text = details

    row = {
        "Timestamp": now.isoformat(),
        "Participant_ID": participant_id,
        "Assignment_Mode": payload.get("assignment_mode", "") or "",
        "Event_Type": event_type,
        "Mission_ID": mission_id,
        "Mission_Title": payload.get("mission_title", "") or "",
        "Phase_ID": phase_id,
        "Phase_Label": payload.get("phase_label", "") or "",
        "Chat_ID": chat_id,
        "Condition": payload.get("condition", "") or "",
        "Trigger_Type": payload.get("trigger_type", "") or "",
        "Event_Time_Client": event_time_client,
        "Recording_Duration_ms": payload.get("recording_duration_ms", "") if payload.get("recording_duration_ms") is not None else "",
        "Silence_Duration_ms": payload.get("silence_duration_ms", "") if payload.get("silence_duration_ms") is not None else "",
        "Recovery_Time_ms": recovery_time_ms if recovery_time_ms is not None else "",
        "Text_Length": payload.get("text_length", "") if payload.get("text_length") is not None else "",
        "Details": details_text,
    }

    headers = list(row.keys())
    file_exists = INTERACTION_EVENT_FILE.exists()
    with open(INTERACTION_EVENT_FILE, "a", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)

    with open(INTERACTION_EVENT_JSONL, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")

    return row
