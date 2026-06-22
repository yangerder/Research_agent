from __future__ import annotations

import csv
import hashlib
import io
import json
import sqlite3
import threading
import time
import zipfile
from datetime import datetime
from uuid import uuid4
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

BASE_DIR = Path(__file__).resolve().parents[1]
DATABASE_DIR = BASE_DIR / "database"
DB_PATH = DATABASE_DIR / "experiment.db"

_db_lock = threading.RLock()


def _ensure_database_dir() -> None:
    DATABASE_DIR.mkdir(parents=True, exist_ok=True)


def _connect() -> sqlite3.Connection:
    _ensure_database_dir()
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def _json(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def _now() -> str:
    return datetime.now().isoformat()


def hash_token(token: Optional[str]) -> str:
    if not token:
        return ""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()



def _ensure_columns(conn: sqlite3.Connection, table_name: str, columns: Dict[str, str]) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()}
    for column_name, column_def in columns.items():
        if column_name not in existing:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_def}")

def init_db() -> None:
    with _db_lock:
        conn = _connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS Participants (
                    Subject_ID TEXT PRIMARY KEY,
                    Qualtrics_Response_ID TEXT,
                    Consent_Status TEXT DEFAULT 'unknown',
                    Assigned_Text_Scenario TEXT,
                    Assigned_Voice_Condition TEXT,
                    Session_ID TEXT UNIQUE,
                    Baseline_Typing_WPM REAL,
                    Baseline_Typing_CPM_Chinese REAL,
                    Baseline_Typing_Duration_ms INTEGER DEFAULT 0,
                    Baseline_Typing_Accuracy REAL,
                    Baseline_Speech_Ratio REAL,
                    Baseline_Speech_Duration_ms INTEGER DEFAULT 0,
                    Baseline_Voice_Frames INTEGER DEFAULT 0,
                    Baseline_Silence_Frames INTEGER DEFAULT 0,
                    Phase0_Completed INTEGER DEFAULT 0,
                    Phase0_Completed_At TEXT,
                    Baseline_Raw_JSON TEXT,
                    Task_Completion_Status TEXT DEFAULT 'not_started',
                    Study_Mode TEXT,
                    Assigned_Task_Order TEXT,
                    AI_Proficiency_Score REAL,
                    PreSurvey_Completed INTEGER DEFAULT 0,
                    PostSurvey_Redirected INTEGER DEFAULT 0,
                    Device_Browser TEXT,
                    Run_Token_Hash TEXT,
                    Assignment_Mode TEXT,
                    Randomization_Block_ID TEXT,
                    Randomization_Cell TEXT,
                    Created_At TEXT DEFAULT CURRENT_TIMESTAMP,
                    Updated_At TEXT,
                    Completed_At TEXT
                );

                CREATE TABLE IF NOT EXISTS Action_Logs (
                    Log_ID INTEGER PRIMARY KEY AUTOINCREMENT,
                    Subject_ID TEXT,
                    Task_Type TEXT NOT NULL,
                    Current_Phase INTEGER NOT NULL,
                    Mission_ID TEXT,
                    Mission_Title TEXT,
                    Phase_ID TEXT,
                    Phase_Label TEXT,
                    Chat_ID TEXT NOT NULL,
                    Turn_Count INTEGER NOT NULL,
                    Input_Method TEXT NOT NULL,
                    Trigger_Type TEXT NOT NULL,
                    Prompt_Tokens INTEGER DEFAULT 0,
                    Completion_Tokens INTEGER DEFAULT 0,
                    Interruption_Count INTEGER DEFAULT 0,
                    User_Reengagement_ms INTEGER DEFAULT 0,
                    Client_Roundtrip_ms INTEGER DEFAULT 0,
                    Server_Processing_ms INTEGER DEFAULT 0,
                    Estimated_Network_RTT_ms INTEGER DEFAULT 0,
                    Network_RTT_ms INTEGER DEFAULT 0,
                    LLM_TTFT_ms INTEGER DEFAULT 0,
                    LLM_Total_Generation_ms INTEGER DEFAULT 0,
                    Whisper_STT_ms INTEGER DEFAULT 0,
                    Raw_Timing_JSON TEXT,
                    User_Input_Length_Chars INTEGER DEFAULT 0,
                    Correction_Count INTEGER DEFAULT 0,
                    STT_Transcript TEXT,
                    Voice_Duration_ms INTEGER DEFAULT 0,
                    Manipulation_Exposure_Flag INTEGER DEFAULT 0,
                    User_Input TEXT,
                    AI_Response TEXT,
                    Created_At TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (Subject_ID) REFERENCES Participants(Subject_ID)
                );

                CREATE TABLE IF NOT EXISTS Event_Logs (
                    Event_ID INTEGER PRIMARY KEY AUTOINCREMENT,
                    Subject_ID TEXT,
                    Event_Type TEXT NOT NULL,
                    Task_Type TEXT NOT NULL,
                    Current_Phase INTEGER NOT NULL,
                    Mission_ID TEXT,
                    Mission_Title TEXT,
                    Phase_ID TEXT,
                    Phase_Label TEXT,
                    Chat_ID TEXT,
                    Event_Timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                    Event_Metadata_JSON TEXT,
                    FOREIGN KEY (Subject_ID) REFERENCES Participants(Subject_ID)
                );

                CREATE TABLE IF NOT EXISTS System_Errors (
                    Error_ID INTEGER PRIMARY KEY AUTOINCREMENT,
                    Subject_ID TEXT,
                    Error_Timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                    Error_Type TEXT NOT NULL,
                    Error_Message TEXT NOT NULL,
                    Recoverability TEXT DEFAULT 'recoverable',
                    Resolved_Flag INTEGER DEFAULT 0,
                    Metadata_JSON TEXT,
                    FOREIGN KEY (Subject_ID) REFERENCES Participants(Subject_ID)
                );

                CREATE TABLE IF NOT EXISTS Data_Quality_Flags (
                    Flag_ID INTEGER PRIMARY KEY AUTOINCREMENT,
                    Subject_ID TEXT,
                    Flag_Type TEXT NOT NULL,
                    Flag_Severity TEXT NOT NULL,
                    Flag_Details_JSON TEXT,
                    Created_At TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (Subject_ID) REFERENCES Participants(Subject_ID)
                );

                CREATE TABLE IF NOT EXISTS Conversation_Messages (
                    Message_ID INTEGER PRIMARY KEY AUTOINCREMENT,
                    Subject_ID TEXT,
                    Assignment_Mode TEXT,
                    Mission_ID TEXT,
                    Mission_Title TEXT,
                    Phase_ID TEXT,
                    Phase_Label TEXT,
                    Chat_ID TEXT,
                    Condition TEXT,
                    Trigger_Type TEXT,
                    Message_Index INTEGER,
                    Role TEXT,
                    Content TEXT,
                    Hidden INTEGER DEFAULT 0,
                    Created_At TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (Subject_ID) REFERENCES Participants(Subject_ID)
                );
                """
            )
            # Lightweight schema migration for existing test DBs.
            _ensure_columns(conn, "Action_Logs", {
                "Client_Roundtrip_ms": "INTEGER DEFAULT 0",
                "Server_Processing_ms": "INTEGER DEFAULT 0",
                "Estimated_Network_RTT_ms": "INTEGER DEFAULT 0",
                "Turn_ID": "TEXT DEFAULT ''",
                "VAD_Trigger_Count": "INTEGER DEFAULT 0",
                "Final_Repair_Choice": "TEXT DEFAULT 'not_applicable'",
                "Total_Repair_Gate_Dwell_ms": "INTEGER DEFAULT 0",
                "Pure_Speech_Duration_ms": "INTEGER DEFAULT 0",
                "Final_Transcript": "TEXT DEFAULT ''",
                "Final_Audio_File_Path": "TEXT DEFAULT ''",
                "Auto_Submitted": "INTEGER DEFAULT 0",
                "LLM_Provider": "TEXT DEFAULT ''",
                "LLM_Model": "TEXT DEFAULT ''",
                "LLM_Run_Mode": "TEXT DEFAULT ''",
            })

            _ensure_columns(conn, "Participants", {
                "Qualtrics_Response_ID": "TEXT",
                "Consent_Status": "TEXT DEFAULT 'unknown'",
                "Study_Mode": "TEXT",
                "Assigned_Text_Scenario": "TEXT",
                "Assigned_Voice_Condition": "TEXT",
                "Assigned_Task_Order": "TEXT",
                "Run_Token_Hash": "TEXT",
                "PreSurvey_Completed": "INTEGER DEFAULT 0",
                "PostSurvey_Redirected": "INTEGER DEFAULT 0",
                "Task_Completion_Status": "TEXT DEFAULT 'not_started'",
                "Completed_At": "TEXT",
                "Baseline_Typing_Duration_ms": "INTEGER DEFAULT 0",
                "Baseline_Typing_Accuracy": "REAL",
                "Baseline_Speech_Duration_ms": "INTEGER DEFAULT 0",
                "Baseline_Voice_Frames": "INTEGER DEFAULT 0",
                "Baseline_Silence_Frames": "INTEGER DEFAULT 0",
                "Phase0_Completed": "INTEGER DEFAULT 0",
                "Phase0_Completed_At": "TEXT",
                "Baseline_Raw_JSON": "TEXT",
            })

            # Older test databases may contain an empty string in Session_ID.
            # SQLite UNIQUE treats empty strings as duplicate values, while NULLs
            # remain unique-friendly. Normalize old rows so logging endpoints can
            # safely upsert participants without passing a session id.
            conn.execute("UPDATE Participants SET Session_ID=NULL WHERE Session_ID=''")
            conn.commit()
        finally:
            conn.close()


def participant_exists(subject_id: Optional[str]) -> bool:
    if not subject_id:
        return False
    init_db()
    with _db_lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT 1 FROM Participants WHERE Subject_ID=? LIMIT 1",
                (str(subject_id),),
            ).fetchone()
            return row is not None
        finally:
            conn.close()


def upsert_participant(
    subject_id: str,
    *,
    qualtrics_response_id: str = "",
    consent_status: str = "unknown",
    assigned_text_scenario: str = "",
    assigned_voice_condition: str = "",
    session_id: str = "",
    study_mode: str = "",
    assigned_task_order: str = "",
    assignment_mode: str = "",
    device_browser: str = "",
    run_token: str = "",
    run_token_hash: str = "",
    task_completion_status: str = "",
    pre_survey_completed: Optional[bool] = None,
    ai_proficiency_score: Optional[float] = None,
    randomization_block_id: str = "",
    randomization_cell: str = "",
) -> None:
    """Create or update a participant row safely.

    Important SQLite behavior:
    - Session_ID is UNIQUE.
    - Multiple NULL values are allowed, but multiple empty strings are not.

    Most logging endpoints call this function only to ensure the participant
    exists and do not know the real browser/session UUID. Therefore we must not
    insert an empty string into Session_ID. New rows get a UUID only when no
    explicit session id is supplied; existing rows keep their original Session_ID.
    """
    subject_id = str(subject_id or "").strip()
    if not subject_id:
        return

    init_db()
    now = _now()
    token_hash = run_token_hash or hash_token(run_token)

    # Normalize blank strings to None so SQLite UNIQUE does not conflict on ''.
    normalized_session_id = str(session_id).strip() if session_id else None
    if normalized_session_id == "":
        normalized_session_id = None

    with _db_lock:
        conn = _connect()
        try:
            existing = conn.execute(
                "SELECT Session_ID FROM Participants WHERE Subject_ID=?",
                (subject_id,),
            ).fetchone()

            if existing:
                # Update metadata, but do not overwrite Session_ID unless a real
                # non-empty session_id was explicitly passed.
                conn.execute(
                    """
                    UPDATE Participants SET
                        Qualtrics_Response_ID=COALESCE(NULLIF(?,''), Qualtrics_Response_ID),
                        Consent_Status=CASE WHEN ? != 'unknown' THEN ? ELSE Consent_Status END,
                        Assigned_Text_Scenario=COALESCE(NULLIF(?,''), Assigned_Text_Scenario),
                        Assigned_Voice_Condition=COALESCE(NULLIF(?,''), Assigned_Voice_Condition),
                        Session_ID=COALESCE(?, Session_ID),
                        Study_Mode=COALESCE(NULLIF(?,''), Study_Mode),
                        Assigned_Task_Order=COALESCE(NULLIF(?,''), Assigned_Task_Order),
                        Assignment_Mode=COALESCE(NULLIF(?,''), Assignment_Mode),
                        Device_Browser=COALESCE(NULLIF(?,''), Device_Browser),
                        Run_Token_Hash=COALESCE(NULLIF(?,''), Run_Token_Hash),
                        Task_Completion_Status=CASE
                            WHEN Task_Completion_Status='completed' AND COALESCE(NULLIF(?,''), Task_Completion_Status) != 'completed'
                            THEN Task_Completion_Status
                            ELSE COALESCE(NULLIF(?,''), Task_Completion_Status)
                        END,
                        PreSurvey_Completed=COALESCE(?, PreSurvey_Completed),
                        AI_Proficiency_Score=COALESCE(?, AI_Proficiency_Score),
                        Randomization_Block_ID=COALESCE(NULLIF(?,''), Randomization_Block_ID),
                        Randomization_Cell=COALESCE(NULLIF(?,''), Randomization_Cell),
                        Updated_At=?
                    WHERE Subject_ID=?
                    """,
                    (
                        qualtrics_response_id,
                        consent_status,
                        consent_status,
                        assigned_text_scenario,
                        assigned_voice_condition,
                        normalized_session_id,
                        study_mode,
                        assigned_task_order,
                        assignment_mode,
                        device_browser,
                        token_hash,
                        task_completion_status,
                        task_completion_status,
                        None if pre_survey_completed is None else int(pre_survey_completed),
                        ai_proficiency_score,
                        randomization_block_id,
                        randomization_cell,
                        now,
                        subject_id,
                    ),
                )
            else:
                # Create a stable Session_ID for new participants. This is safe
                # because UUIDv4 collisions are practically impossible and avoids
                # repeated empty-string UNIQUE violations.
                if normalized_session_id is None:
                    normalized_session_id = str(uuid4())

                conn.execute(
                    """
                    INSERT INTO Participants (
                        Subject_ID, Qualtrics_Response_ID, Consent_Status,
                        Assigned_Text_Scenario, Assigned_Voice_Condition,
                        Session_ID, Study_Mode, Assigned_Task_Order,
                        Assignment_Mode, Device_Browser, Run_Token_Hash,
                        Task_Completion_Status, PreSurvey_Completed,
                        AI_Proficiency_Score, Randomization_Block_ID,
                        Randomization_Cell, Created_At, Updated_At
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        subject_id,
                        qualtrics_response_id,
                        consent_status,
                        assigned_text_scenario,
                        assigned_voice_condition,
                        normalized_session_id,
                        study_mode,
                        assigned_task_order,
                        assignment_mode,
                        device_browser,
                        token_hash,
                        task_completion_status or "partial",
                        None if pre_survey_completed is None else int(pre_survey_completed),
                        ai_proficiency_score,
                        randomization_block_id,
                        randomization_cell,
                        now,
                        now,
                    ),
                )

            conn.commit()
        except sqlite3.IntegrityError:
            conn.rollback()
            # If an old/broken db still has a Session_ID collision, retry once
            # after normalizing empty Session_IDs to NULL and forcing a fresh UUID.
            conn.execute("UPDATE Participants SET Session_ID=NULL WHERE Session_ID=''")
            conn.commit()
            if normalized_session_id is not None:
                # Avoid reusing a potentially duplicated explicit Session_ID.
                normalized_session_id = str(uuid4())
            conn.execute(
                """
                INSERT INTO Participants (
                    Subject_ID, Session_ID, Assignment_Mode,
                    Task_Completion_Status, Created_At, Updated_At
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(Subject_ID) DO UPDATE SET
                    Assignment_Mode=COALESCE(NULLIF(excluded.Assignment_Mode,''), Assignment_Mode),
                    Task_Completion_Status=CASE
                        WHEN Participants.Task_Completion_Status='completed' AND excluded.Task_Completion_Status!='completed'
                        THEN Participants.Task_Completion_Status
                        ELSE COALESCE(NULLIF(excluded.Task_Completion_Status,''), Participants.Task_Completion_Status)
                    END,
                    Updated_At=excluded.Updated_At
                """,
                (
                    subject_id,
                    normalized_session_id or str(uuid4()),
                    assignment_mode,
                    task_completion_status or "partial",
                    now,
                    now,
                ),
            )
            conn.commit()
        finally:
            conn.close()


def get_participant_baseline(subject_id: str) -> Dict[str, Any]:
    """Return the current stored Phase 0 baseline values for one participant."""
    if not subject_id:
        return {}
    init_db()
    conn = _connect()
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            """
            SELECT
                Baseline_Typing_WPM,
                Baseline_Typing_CPM_Chinese,
                Baseline_Typing_Duration_ms,
                Baseline_Typing_Accuracy,
                Baseline_Speech_Ratio,
                Baseline_Speech_Duration_ms,
                Baseline_Voice_Frames,
                Baseline_Silence_Frames,
                Phase0_Completed,
                Phase0_Completed_At,
                Baseline_Raw_JSON
            FROM Participants
            WHERE Subject_ID=?
            """,
            (subject_id,),
        ).fetchone()
        if not row:
            return {}
        return dict(row)
    finally:
        conn.close()

def update_participant_baseline(
    subject_id: str,
    *,
    typing_wpm: Optional[float] = None,
    typing_cpm_chinese: Optional[float] = None,
    typing_duration_ms: Optional[int] = None,
    typing_accuracy: Optional[float] = None,
    speech_ratio: Optional[float] = None,
    speech_duration_ms: Optional[int] = None,
    voice_frames: Optional[int] = None,
    silence_frames: Optional[int] = None,
    phase0_completed: Optional[bool] = None,
    raw_json: Any = None,
) -> None:
    if not subject_id:
        return
    init_db()
    upsert_participant(subject_id, task_completion_status="partial")
    completed_at = _now() if phase0_completed else None
    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                """
                UPDATE Participants
                SET Baseline_Typing_WPM=COALESCE(?, Baseline_Typing_WPM),
                    Baseline_Typing_CPM_Chinese=COALESCE(?, Baseline_Typing_CPM_Chinese),
                    Baseline_Typing_Duration_ms=COALESCE(?, Baseline_Typing_Duration_ms),
                    Baseline_Typing_Accuracy=COALESCE(?, Baseline_Typing_Accuracy),
                    Baseline_Speech_Ratio=COALESCE(?, Baseline_Speech_Ratio),
                    Baseline_Speech_Duration_ms=COALESCE(?, Baseline_Speech_Duration_ms),
                    Baseline_Voice_Frames=COALESCE(?, Baseline_Voice_Frames),
                    Baseline_Silence_Frames=COALESCE(?, Baseline_Silence_Frames),
                    Phase0_Completed=CASE WHEN ? IS NULL THEN Phase0_Completed ELSE ? END,
                    Phase0_Completed_At=COALESCE(?, Phase0_Completed_At),
                    Baseline_Raw_JSON=COALESCE(?, Baseline_Raw_JSON),
                    Updated_At=?
                WHERE Subject_ID=?
                """,
                (
                    typing_wpm,
                    typing_cpm_chinese,
                    typing_duration_ms,
                    typing_accuracy,
                    speech_ratio,
                    speech_duration_ms,
                    voice_frames,
                    silence_frames,
                    None if phase0_completed is None else int(bool(phase0_completed)),
                    None if phase0_completed is None else int(bool(phase0_completed)),
                    completed_at,
                    None if raw_json is None else _json(raw_json),
                    _now(),
                    subject_id,
                ),
            )
            conn.commit()
        finally:
            conn.close()

def mark_completed(subject_id: str, status: str = "completed", *, post_survey_redirected: Optional[bool] = None) -> None:
    if not subject_id:
        return
    init_db()
    upsert_participant(subject_id, task_completion_status=status)
    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                """
                UPDATE Participants
                SET Task_Completion_Status=?,
                    Completed_At=COALESCE(Completed_At, ?),
                    PostSurvey_Redirected=CASE WHEN ? IS NULL THEN PostSurvey_Redirected ELSE ? END,
                    Updated_At=?
                WHERE Subject_ID=?
                """,
                (
                    status,
                    _now(),
                    None if post_survey_redirected is None else int(bool(post_survey_redirected)),
                    None if post_survey_redirected is None else int(bool(post_survey_redirected)),
                    _now(),
                    subject_id,
                ),
            )
            conn.commit()
        finally:
            conn.close()


def log_action(row: Dict[str, Any]) -> int:
    init_db()
    subject_id = row.get("Subject_ID") or row.get("subject_id") or ""
    if subject_id:
        upsert_participant(str(subject_id), assignment_mode=str(row.get("Assignment_Mode") or ""))

    fields = [
        "Subject_ID", "Task_Type", "Current_Phase", "Mission_ID", "Mission_Title",
        "Phase_ID", "Phase_Label", "Chat_ID", "Turn_Count", "Input_Method",
        "Trigger_Type", "Prompt_Tokens", "Completion_Tokens", "Interruption_Count",
        "User_Reengagement_ms", "Client_Roundtrip_ms", "Server_Processing_ms",
        "Estimated_Network_RTT_ms", "Network_RTT_ms", "LLM_TTFT_ms",
        "LLM_Total_Generation_ms", "Whisper_STT_ms", "Raw_Timing_JSON",
        "User_Input_Length_Chars", "Correction_Count", "STT_Transcript",
        "Voice_Duration_ms", "Manipulation_Exposure_Flag", "User_Input", "AI_Response",
        "Turn_ID", "VAD_Trigger_Count", "Final_Repair_Choice",
        "Total_Repair_Gate_Dwell_ms", "Pure_Speech_Duration_ms",
        "Final_Transcript", "Final_Audio_File_Path", "Auto_Submitted",
        "LLM_Provider", "LLM_Model", "LLM_Run_Mode"
    ]
    values = {field: row.get(field, row.get(field.lower(), None)) for field in fields}
    values["Task_Type"] = values.get("Task_Type") or "Platform"
    values["Current_Phase"] = int(values.get("Current_Phase") or 0)
    values["Chat_ID"] = values.get("Chat_ID") or "unknown"
    values["Turn_Count"] = int(values.get("Turn_Count") or 0)
    values["Input_Method"] = values.get("Input_Method") or "Text"
    values["Trigger_Type"] = values.get("Trigger_Type") or "manual"
    values["Turn_ID"] = values.get("Turn_ID") or ""
    values["Final_Repair_Choice"] = values.get("Final_Repair_Choice") or "not_applicable"
    values["Final_Transcript"] = values.get("Final_Transcript") or ""
    values["Final_Audio_File_Path"] = values.get("Final_Audio_File_Path") or ""
    values["LLM_Provider"] = values.get("LLM_Provider") or ""
    values["LLM_Model"] = values.get("LLM_Model") or ""
    values["LLM_Run_Mode"] = values.get("LLM_Run_Mode") or ""
    for k in ["Prompt_Tokens", "Completion_Tokens", "Interruption_Count", "User_Reengagement_ms", "Client_Roundtrip_ms", "Server_Processing_ms", "Estimated_Network_RTT_ms", "Network_RTT_ms", "LLM_TTFT_ms", "LLM_Total_Generation_ms", "Whisper_STT_ms", "User_Input_Length_Chars", "Correction_Count", "Voice_Duration_ms", "Manipulation_Exposure_Flag", "VAD_Trigger_Count", "Total_Repair_Gate_Dwell_ms", "Pure_Speech_Duration_ms", "Auto_Submitted"]:
        try:
            values[k] = int(float(values.get(k) or 0))
        except Exception:
            values[k] = 0
    if not isinstance(values.get("Raw_Timing_JSON"), str):
        values["Raw_Timing_JSON"] = _json(values.get("Raw_Timing_JSON"))

    with _db_lock:
        conn = _connect()
        try:
            cursor = conn.execute(
                f"INSERT INTO Action_Logs ({','.join(fields)}) VALUES ({','.join(['?'] * len(fields))})",
                tuple(values.get(field) for field in fields),
            )
            conn.commit()
            return int(cursor.lastrowid)
        finally:
            conn.close()


def update_action_timing(log_id: int, *, t4_client_ms: Optional[float] = None, t1_client_ms: Optional[float] = None, t5_client_ms: Optional[float] = None, previous_t4_client_ms: Optional[float] = None, user_reengagement_ms: Optional[float] = None) -> None:
    if not log_id:
        return
    init_db()
    with _db_lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT Raw_Timing_JSON, Server_Processing_ms FROM Action_Logs WHERE Log_ID=?",
                (int(log_id),),
            ).fetchone()
            if not row:
                return

            raw_value = row["Raw_Timing_JSON"] or "{}"
            try:
                raw_timing = json.loads(raw_value) if raw_value else {}
            except Exception:
                raw_timing = {"unparsed_raw_timing": raw_value}

            if t1_client_ms is None:
                t1_client_ms = raw_timing.get("t1_client_ms")
            if t5_client_ms is None:
                t5_client_ms = raw_timing.get("t5_client_ms")
            if previous_t4_client_ms is None:
                previous_t4_client_ms = raw_timing.get("previous_t4_client_ms")

            raw_timing["t4_client_ms"] = t4_client_ms
            raw_timing["t1_client_ms"] = t1_client_ms
            raw_timing["t5_client_ms"] = t5_client_ms
            raw_timing["previous_t4_client_ms"] = previous_t4_client_ms
            raw_timing["user_reengagement_formula"] = "User_Reengagement_ms = t5_client_ms - previous_t4_client_ms; first turn is 0 when previous_t4_client_ms is null."
            raw_timing["client_timing_updated_at"] = _now()
            raw_timing["clock_note"] = "Client performance.now() and server monotonic clocks are stored separately. Do not subtract client timestamps from server timestamps."

            client_roundtrip_ms = 0
            if t1_client_ms is not None and t4_client_ms is not None:
                try:
                    client_roundtrip_ms = max(0, int(round(float(t4_client_ms) - float(t1_client_ms))))
                except Exception:
                    client_roundtrip_ms = 0

            server_processing_ms = int(row["Server_Processing_ms"] or 0)
            estimated_network_rtt_ms = max(0, int(client_roundtrip_ms - server_processing_ms))
            if user_reengagement_ms is None:
                if previous_t4_client_ms is not None and t5_client_ms is not None:
                    try:
                        user_reengagement_ms = max(0, float(t5_client_ms) - float(previous_t4_client_ms))
                    except Exception:
                        user_reengagement_ms = 0
                else:
                    user_reengagement_ms = 0

            conn.execute(
                """
                UPDATE Action_Logs SET
                    User_Reengagement_ms=?,
                    Client_Roundtrip_ms=?,
                    Estimated_Network_RTT_ms=?,
                    Network_RTT_ms=?,
                    Raw_Timing_JSON=?
                WHERE Log_ID=?
                """,
                (
                    int(round(float(user_reengagement_ms or 0))),
                    client_roundtrip_ms,
                    estimated_network_rtt_ms,
                    estimated_network_rtt_ms,
                    _json(raw_timing),
                    int(log_id),
                ),
            )
            conn.commit()
        finally:
            conn.close()


def log_event(
    subject_id: str,
    event_type: str,
    *,
    task_type: str = "Platform",
    current_phase: int = 0,
    mission_id: str = "",
    mission_title: str = "",
    phase_id: str = "",
    phase_label: str = "",
    chat_id: str = "",
    condition: str = "",
    trigger_type: str = "",
    metadata: Any = None,
) -> None:
    """Write one formal event row to SQLite.

    `condition` and `trigger_type` are accepted for compatibility with
    endpoint-level event logging. Event_Logs does not have dedicated columns
    for them, so they are preserved inside Event_Metadata_JSON. This keeps
    Phase 0 events analysis-ready while avoiding TypeError when callers pass
    these fields.
    """
    init_db()
    if subject_id:
        upsert_participant(subject_id)

    metadata_payload = metadata
    if condition or trigger_type:
        if metadata_payload is None:
            metadata_payload = {}
        elif isinstance(metadata_payload, dict):
            metadata_payload = dict(metadata_payload)
        else:
            metadata_payload = {"details": metadata_payload}
        if condition:
            metadata_payload.setdefault("condition", condition)
        if trigger_type:
            metadata_payload.setdefault("trigger_type", trigger_type)

    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO Event_Logs (
                    Subject_ID, Event_Type, Task_Type, Current_Phase, Mission_ID,
                    Mission_Title, Phase_ID, Phase_Label, Chat_ID, Event_Timestamp,
                    Event_Metadata_JSON
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    subject_id or None,
                    event_type,
                    task_type or "Platform",
                    int(current_phase or 0),
                    mission_id,
                    mission_title,
                    phase_id,
                    phase_label,
                    chat_id,
                    _now(),
                    _json(metadata_payload),
                ),
            )
            conn.commit()
        finally:
            conn.close()


def log_system_error(subject_id: Optional[str], error_type: str, error_message: str, *, recoverability: str = "recoverable", metadata: Any = None) -> None:
    init_db()
    # System errors must never fail because the participant row is missing.
    # If the participant has not been created yet, store NULL instead of causing
    # a FOREIGN KEY failure while trying to report the original error.
    safe_subject_id = str(subject_id).strip() if subject_id and participant_exists(str(subject_id).strip()) else None
    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO System_Errors (Subject_ID, Error_Timestamp, Error_Type, Error_Message, Recoverability, Metadata_JSON)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (safe_subject_id, _now(), error_type, error_message, recoverability, _json(metadata)),
            )
            conn.commit()
        finally:
            conn.close()


def log_data_quality_flag(subject_id: str, flag_type: str, flag_severity: str = "warning", details: Any = None) -> None:
    init_db()
    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO Data_Quality_Flags (Subject_ID, Flag_Type, Flag_Severity, Flag_Details_JSON, Created_At)
                VALUES (?, ?, ?, ?, ?)
                """,
                (subject_id, flag_type, flag_severity, _json(details), _now()),
            )
            conn.commit()
        finally:
            conn.close()


def append_conversation_messages(payload: Dict[str, Any]) -> int:
    init_db()
    subject_id = str(payload.get("participant_id") or payload.get("Subject_ID") or "").strip()
    messages = payload.get("messages") or []
    if subject_id:
        upsert_participant(subject_id, assignment_mode=str(payload.get("assignment_mode") or ""))
    count = 0
    with _db_lock:
        conn = _connect()
        try:
            for msg in messages:
                conn.execute(
                    """
                    INSERT INTO Conversation_Messages (
                        Subject_ID, Assignment_Mode, Mission_ID, Mission_Title, Phase_ID,
                        Phase_Label, Chat_ID, Condition, Trigger_Type, Message_Index,
                        Role, Content, Hidden, Created_At
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        subject_id,
                        payload.get("assignment_mode", ""),
                        payload.get("mission_id", ""),
                        payload.get("mission_title", ""),
                        payload.get("phase_id", ""),
                        payload.get("phase_label", ""),
                        payload.get("chat_id", ""),
                        payload.get("condition", ""),
                        payload.get("trigger_type", ""),
                        msg.get("message_index", count),
                        msg.get("role", ""),
                        msg.get("content", ""),
                        int(bool(msg.get("hidden", False))),
                        _now(),
                    ),
                )
                count += 1
            conn.commit()
        finally:
            conn.close()
    return count


def export_sqlite_to_zip_bytes() -> bytes:
    init_db()
    table_names = [
        "Participants",
        "Action_Logs",
        "Event_Logs",
        "System_Errors",
        "Data_Quality_Flags",
        "Conversation_Messages",
    ]
    output = io.BytesIO()
    with _db_lock:
        conn = _connect()
        try:
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zf:
                for table in table_names:
                    rows = conn.execute(f"SELECT * FROM {table}").fetchall()
                    csv_buffer = io.StringIO(newline="")
                    if rows:
                        writer = csv.DictWriter(csv_buffer, fieldnames=rows[0].keys())
                        writer.writeheader()
                        for row in rows:
                            writer.writerow({k: row[k] for k in row.keys()})
                    else:
                        columns = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
                        writer = csv.writer(csv_buffer)
                        writer.writerow(columns)
                    zf.writestr(f"{table}.csv", "\ufeff" + csv_buffer.getvalue())
        finally:
            conn.close()
    output.seek(0)
    return output.getvalue()


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    # A lightweight fallback. Real tokenization can be added later with tiktoken.
    return max(1, int(len(text) / 2))
