# backend/utils/logger.py
import csv
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parents[1]
DATABASE_DIR = BASE_DIR / "database"
LOG_FILE = DATABASE_DIR / "experiment_logs.csv"
PHASE_LOG_FILE = DATABASE_DIR / "phase_logs.csv"

# Use (subject_id, chat_id) so different participants/chats do not affect each other.
interruption_tracker = {}


def _ensure_database_dir():
    DATABASE_DIR.mkdir(parents=True, exist_ok=True)


def log_event(
    subject_id,
    chat_id,
    scenario,
    trigger_type,
    user_input="",
    ai_response="",
    tokens=0,
    rounds=0,
    migration_time_ms=0,
    phase_id="",
):
    _ensure_database_dir()

    file_exists = LOG_FILE.exists()
    current_time = time.time()
    recovery_time_ms = 0
    tracker_key = (subject_id, chat_id)

    if trigger_type == "manual" and tracker_key in interruption_tracker:
        recovery_time_ms = (current_time - interruption_tracker[tracker_key]) * 1000
        del interruption_tracker[tracker_key]

    headers = [
        "Timestamp",
        "Subject_ID",
        "Chat_ID",
        "Phase_ID",
        "Scenario",
        "Trigger_Type",
        "Recovery_Time_ms",
        "Migration_Time_ms",
        "Tokens",
        "Rounds",
        "Input_Length",
    ]

    with open(LOG_FILE, mode="a", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        if not file_exists:
            writer.writeheader()

        writer.writerow(
            {
                "Timestamp": datetime.now().isoformat(),
                "Subject_ID": subject_id,
                "Chat_ID": chat_id,
                "Phase_ID": phase_id or "",
                "Scenario": scenario,
                "Trigger_Type": trigger_type,
                "Recovery_Time_ms": round(recovery_time_ms, 2),
                "Migration_Time_ms": round(migration_time_ms, 2),
                "Tokens": tokens,
                "Rounds": rounds,
                "Input_Length": len(user_input),
            }
        )


def log_migration(user_id, chat_id, migration_time, summary):
    log_event(
        subject_id=user_id,
        chat_id=chat_id,
        scenario="C",
        trigger_type="migration_click",
        user_input=f"[SUMMARY]: {summary}",
        migration_time_ms=migration_time,
    )


def record_interruption(subject_id, chat_id, scenario, phase_id="") :
    tracker_key = (subject_id, chat_id)
    interruption_tracker[tracker_key] = time.time()

    log_event(
        subject_id=subject_id,
        chat_id=chat_id,
        scenario=scenario,
        trigger_type="auto_vad",
        phase_id=phase_id,
        user_input="[SYSTEM_AUTO_CUTOFF]",
    )


def log_phase_completion(
    participant_id: str,
    phase_id: str,
    mission_title: str,
    condition: Optional[str],
    phase_label: str,
    title: str,
    round_count: int,
    chat_count: int,
    started_at: Optional[str],
    ended_at: str,
):
    _ensure_database_dir()

    file_exists = PHASE_LOG_FILE.exists()
    headers = [
        "Timestamp",
        "Participant_ID",
        "Phase_ID",
        "Mission_Title",
        "Condition",
        "Phase_Label",
        "Title",
        "Round_Count",
        "Chat_Count",
        "Started_At",
        "Ended_At",
    ]

    with open(PHASE_LOG_FILE, mode="a", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        if not file_exists:
            writer.writeheader()

        writer.writerow(
            {
                "Timestamp": datetime.now().isoformat(),
                "Participant_ID": participant_id,
                "Phase_ID": phase_id,
                "Mission_Title": mission_title,
                "Condition": condition or "",
                "Phase_Label": phase_label,
                "Title": title,
                "Round_Count": round_count,
                "Chat_Count": chat_count,
                "Started_At": started_at or "",
                "Ended_At": ended_at,
            }
        )
