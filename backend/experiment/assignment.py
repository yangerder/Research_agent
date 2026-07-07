
from __future__ import annotations

import csv
import json
import random
import config as app_config
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

BASE_DIR = Path(__file__).resolve().parents[1]
CONFIG_DIR = BASE_DIR / "experiment_configs"
DATABASE_DIR = BASE_DIR / "database"
ASSIGNMENT_FILE = DATABASE_DIR / "assignments.csv"

VALID_MODES = {"between_subject", "within_subject", "single_study"}
ASSIGNMENT_HEADERS = [
    "created_at",
    "participant_id",
    "assignment_mode",
    "assigned_study",
    "task_order",
    "text_condition",
    "voice_condition",
    "text_order",
    "voice_order",
]


def get_default_assignment_mode() -> str:
    mode = str(getattr(app_config, "EXPERIMENT_ASSIGNMENT_MODE", "between_subject") or "between_subject").strip()
    if mode not in VALID_MODES:
        return "between_subject"
    return mode


def _apply_runtime_assignment_config(mode: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Apply editable root config.json capacity settings on top of JSON flow config."""
    domains = config.get("domains", {})
    text_domain = domains.get("text_travel", {})
    voice_domain = domains.get("voice_restaurant", {})

    if mode == "between_subject":
        text_domain["max_per_condition"] = int(getattr(app_config, "BETWEEN_SUBJECT_TEXT_MAX_PER_CONDITION", text_domain.get("max_per_condition", 999999)))
        voice_domain["max_per_condition"] = int(getattr(app_config, "BETWEEN_SUBJECT_VOICE_MAX_PER_CONDITION", voice_domain.get("max_per_condition", 999999)))
        config["randomize_task_order"] = bool(getattr(app_config, "BETWEEN_SUBJECT_RANDOMIZE_TASK_ORDER", True))
    elif mode == "within_subject":
        text_domain["max_per_order"] = int(getattr(app_config, "WITHIN_SUBJECT_TEXT_MAX_PER_ORDER", text_domain.get("max_per_order", 999999)))
        voice_domain["max_per_order"] = int(getattr(app_config, "WITHIN_SUBJECT_VOICE_MAX_PER_ORDER", voice_domain.get("max_per_order", 999999)))
    elif mode == "single_study":
        text_domain["max_total"] = int(getattr(app_config, "SINGLE_STUDY_TEXT_TOTAL_MAX", text_domain.get("max_total", 999999)))
        voice_domain["max_total"] = int(getattr(app_config, "SINGLE_STUDY_VOICE_TOTAL_MAX", voice_domain.get("max_total", 999999)))
        text_domain["max_per_condition"] = int(getattr(app_config, "SINGLE_STUDY_TEXT_MAX_PER_CONDITION", text_domain.get("max_per_condition", 999999)))
        voice_domain["max_per_condition"] = int(getattr(app_config, "SINGLE_STUDY_VOICE_MAX_PER_CONDITION", voice_domain.get("max_per_condition", 999999)))

    return config


def _ensure_database_dir() -> None:
    DATABASE_DIR.mkdir(parents=True, exist_ok=True)


def load_config(mode: str) -> Dict[str, Any]:
    if mode not in VALID_MODES:
        raise ValueError(f"Invalid assignment mode: {mode}")

    path = CONFIG_DIR / f"{mode}.json"
    if not path.exists():
        raise FileNotFoundError(f"Experiment config not found: {path}")

    config = json.loads(path.read_text(encoding="utf-8"))
    return _apply_runtime_assignment_config(mode, config)


def _read_assignments() -> List[Dict[str, str]]:
    if not ASSIGNMENT_FILE.exists():
        return []
    with open(ASSIGNMENT_FILE, "r", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _rewrite_assignments(rows: List[Dict[str, str]]) -> None:
    _ensure_database_dir()
    with open(ASSIGNMENT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=ASSIGNMENT_HEADERS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({h: row.get(h, "") for h in ASSIGNMENT_HEADERS})


def _write_assignment(row: Dict[str, str]) -> None:
    rows = _read_assignments()
    rows.append(row)
    _rewrite_assignments(rows)


def _existing_assignment(participant_id: str) -> Optional[Dict[str, str]]:
    for row in _read_assignments():
        if row.get("participant_id") == participant_id:
            return row
    return None


def _pick_with_capacity(items: List[str], counts: Dict[str, int], limit: int) -> str:
    available = [item for item in items if counts.get(item, 0) < limit]
    if not available:
        min_count = min(counts.get(item, 0) for item in items)
        available = [item for item in items if counts.get(item, 0) == min_count]
    min_available = min(counts.get(item, 0) for item in available)
    least_used = [item for item in available if counts.get(item, 0) == min_available]
    return random.choice(least_used)


def _build_counts(rows: List[Dict[str, str]], mode: str, key: str) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for row in rows:
        if row.get("assignment_mode") != mode:
            continue
        value = row.get(key, "")
        if value:
            counts[value] = counts.get(value, 0) + 1
    return counts


def _build_single_study_counts(rows: List[Dict[str, str]]) -> Dict[str, int]:
    counts = {"text": 0, "voice": 0}
    for row in rows:
        if row.get("assignment_mode") != "single_study":
            continue
        study = row.get("assigned_study") or ("text" if row.get("text_condition") else "voice" if row.get("voice_condition") else "")
        if study in counts:
            counts[study] += 1
    return counts


def _pick_single_study(config: Dict[str, Any], rows: List[Dict[str, str]]) -> str:
    text_domain = config["domains"]["text_travel"]
    voice_domain = config["domains"]["voice_restaurant"]
    counts = _build_single_study_counts(rows)
    limits = {
        "text": int(text_domain.get("max_total", 999999)),
        "voice": int(voice_domain.get("max_total", 999999)),
    }
    available = [study for study in ["text", "voice"] if counts.get(study, 0) < limits.get(study, 999999)]
    if not available:
        available = ["text", "voice"]
    min_count = min(counts.get(study, 0) for study in available)
    return random.choice([study for study in available if counts.get(study, 0) == min_count])


def create_or_get_assignment(participant_id: str, requested_mode: str) -> Dict[str, str]:
    existing = _existing_assignment(participant_id)
    if existing:
        return existing

    config = load_config(requested_mode)
    rows = _read_assignments()

    assignment: Dict[str, str] = {
        "created_at": datetime.now().isoformat(),
        "participant_id": participant_id,
        "assignment_mode": requested_mode,
        "assigned_study": "",
        "task_order": "",
        "text_condition": "",
        "voice_condition": "",
        "text_order": "",
        "voice_order": "",
    }

    if requested_mode == "between_subject":
        text_domain = config["domains"]["text_travel"]
        voice_domain = config["domains"]["voice_restaurant"]

        text_counts = _build_counts(rows, requested_mode, "text_condition")
        voice_counts = _build_counts(rows, requested_mode, "voice_condition")
        order_counts = _build_counts(rows, requested_mode, "task_order")

        assignment["text_condition"] = _pick_with_capacity(
            text_domain["conditions"], text_counts, int(text_domain.get("max_per_condition", 999999))
        )
        assignment["voice_condition"] = _pick_with_capacity(
            voice_domain["conditions"], voice_counts, int(voice_domain.get("max_per_condition", 999999))
        )
        if config.get("randomize_task_order", True):
            assignment["task_order"] = _pick_with_capacity(["text_first", "voice_first"], order_counts, 999999)
        else:
            assignment["task_order"] = "text_first"

    elif requested_mode == "within_subject":
        text_domain = config["domains"]["text_travel"]
        voice_domain = config["domains"]["voice_restaurant"]

        text_counts = _build_counts(rows, requested_mode, "text_order")
        voice_counts = _build_counts(rows, requested_mode, "voice_order")

        assignment["text_order"] = _pick_with_capacity(
            text_domain["orders"], text_counts, int(text_domain.get("max_per_order", 999999))
        )
        assignment["voice_order"] = _pick_with_capacity(
            voice_domain["orders"], voice_counts, int(voice_domain.get("max_per_order", 999999))
        )
        assignment["task_order"] = "text_first"

    elif requested_mode == "single_study":
        text_domain = config["domains"]["text_travel"]
        voice_domain = config["domains"]["voice_restaurant"]
        assigned_study = _pick_single_study(config, rows)
        assignment["assigned_study"] = assigned_study

        if assigned_study == "text":
            text_counts = _build_counts(rows, requested_mode, "text_condition")
            assignment["text_condition"] = _pick_with_capacity(
                text_domain["conditions"], text_counts, int(text_domain.get("max_per_condition", 999999))
            )
        else:
            voice_counts = _build_counts(rows, requested_mode, "voice_condition")
            assignment["voice_condition"] = _pick_with_capacity(
                voice_domain["conditions"], voice_counts, int(voice_domain.get("max_per_condition", 999999))
            )

    _write_assignment(assignment)
    return assignment


def _read_only_phase(phase_id: str, mission_title: str, title: str, task_doc_id: str) -> Dict[str, Any]:
    return {
        "id": phase_id,
        "missionTitle": mission_title,
        "condition": None,
        "conditionLabel": "說明",
        "phaseLabel": "Info",
        "title": title,
        "taskDocId": task_doc_id,
        "minRounds": 0,
        "mode": "read_only",
    }


def _build_domain_phases(domain_id: str, condition: str, run_index: int, domain_config: Dict[str, Any]) -> List[Dict[str, Any]]:
    phases: List[Dict[str, Any]] = []
    condition_label = domain_config["condition_labels"].get(condition, f"情境 {condition}")
    mission_title = domain_config["title"]

    if run_index > 1:
        mission_title = f"{mission_title} Mission {run_index}"

    for phase in domain_config["phases"]:
        phase_id = f"{domain_id}_{condition.lower()}_run{run_index}_phase_{str(phase['phase']).lower()}"
        phases.append(
            {
                "id": phase_id,
                "missionTitle": mission_title,
                "condition": condition,
                "conditionLabel": condition_label,
                "phaseLabel": phase["phase_label"],
                "title": phase["title"],
                "taskDocId": phase["task_doc_id"],
                "minRounds": int(phase.get("min_rounds", 0)),
                "mode": phase.get("mode", domain_config.get("mode", "text")),
                "durationSeconds": phase.get("duration_seconds"),
            }
        )

    return phases


def _append_text_run(phases: List[Dict[str, Any]], text_config: Dict[str, Any], condition: str, idx: int) -> None:
    phases.extend(_build_domain_phases("text_travel", condition, idx, text_config))
    phases.append(_read_only_phase(f"text_questionnaire_run{idx}", "文字旅遊問卷", "文字旅遊任務問卷", "text_questionnaire"))


def _append_voice_run(phases: List[Dict[str, Any]], voice_config: Dict[str, Any], condition: str, idx: int) -> None:
    phases.extend(_build_domain_phases("voice_restaurant", condition, idx, voice_config))
    phases.append(_read_only_phase(f"voice_questionnaire_run{idx}", "餐廳語音問卷", "餐廳語音任務問卷", "voice_questionnaire"))


def build_flow(config: Dict[str, Any], assignment: Dict[str, str]) -> List[Dict[str, Any]]:
    phases: List[Dict[str, Any]] = []
    phases.append(_read_only_phase("intro", "實驗介紹", "實驗內容介紹", "intro"))

    text_config = config["domains"]["text_travel"]
    voice_config = config["domains"]["voice_restaurant"]
    mode = assignment.get("assignment_mode", "between_subject")

    if mode == "between_subject":
        text_condition = assignment.get("text_condition", "")
        voice_condition = assignment.get("voice_condition", "")
        task_order = assignment.get("task_order") or "text_first"
        if task_order == "voice_first":
            if voice_condition:
                _append_voice_run(phases, voice_config, voice_condition, 1)
            if text_condition:
                _append_text_run(phases, text_config, text_condition, 1)
        else:
            if text_condition:
                _append_text_run(phases, text_config, text_condition, 1)
            if voice_condition:
                _append_voice_run(phases, voice_config, voice_condition, 1)

    elif mode == "within_subject":
        text_conditions = list(assignment.get("text_order", ""))
        voice_conditions = list(assignment.get("voice_order", ""))
        for idx, condition in enumerate(text_conditions, start=1):
            _append_text_run(phases, text_config, condition, idx)
        for idx, condition in enumerate(voice_conditions, start=1):
            _append_voice_run(phases, voice_config, condition, idx)

    elif mode == "single_study":
        assigned_study = assignment.get("assigned_study") or ("text" if assignment.get("text_condition") else "voice")
        if assigned_study == "text":
            _append_text_run(phases, text_config, assignment.get("text_condition", "A") or "A", 1)
        else:
            _append_voice_run(phases, voice_config, assignment.get("voice_condition", "A") or "A", 1)

    phases.append(_read_only_phase("end", "實驗結束", "完成實驗", "end"))
    return phases


def start_experiment(participant_id: str, assignment_mode: str) -> Dict[str, Any]:
    config = load_config(assignment_mode)
    assignment = create_or_get_assignment(participant_id, assignment_mode)

    actual_mode = assignment.get("assignment_mode", assignment_mode)
    if actual_mode != assignment_mode:
        config = load_config(actual_mode)

    phases = build_flow(config, assignment)

    return {
        "participant_id": participant_id,
        "assignment_mode": actual_mode,
        "assignment": assignment,
        "phases": phases,
    }
