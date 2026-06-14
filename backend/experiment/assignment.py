
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

VALID_MODES = {"between_subject", "within_subject"}


def get_default_assignment_mode() -> str:
    mode = str(getattr(app_config, "EXPERIMENT_ASSIGNMENT_MODE", "between_subject") or "between_subject").strip()
    if mode not in VALID_MODES:
        return "between_subject"
    return mode


def _apply_runtime_assignment_config(mode: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Apply editable backend/config.py capacity settings on top of JSON flow config.

    The JSON files still define task docs/phases/order lists, while config.py is the
    convenient place for the experimenter to adjust randomization mode and maximum
    participants per condition/order.
    """
    domains = config.get("domains", {})
    text_domain = domains.get("text_travel", {})
    voice_domain = domains.get("voice_restaurant", {})

    if mode == "between_subject":
        text_domain["max_per_condition"] = int(getattr(app_config, "BETWEEN_SUBJECT_TEXT_MAX_PER_CONDITION", text_domain.get("max_per_condition", 999999)))
        voice_domain["max_per_condition"] = int(getattr(app_config, "BETWEEN_SUBJECT_VOICE_MAX_PER_CONDITION", voice_domain.get("max_per_condition", 999999)))
    elif mode == "within_subject":
        text_domain["max_per_order"] = int(getattr(app_config, "WITHIN_SUBJECT_TEXT_MAX_PER_ORDER", text_domain.get("max_per_order", 999999)))
        voice_domain["max_per_order"] = int(getattr(app_config, "WITHIN_SUBJECT_VOICE_MAX_PER_ORDER", voice_domain.get("max_per_order", 999999)))

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


def _write_assignment(row: Dict[str, str]) -> None:
    _ensure_database_dir()

    file_exists = ASSIGNMENT_FILE.exists()
    headers = [
        "created_at",
        "participant_id",
        "assignment_mode",
        "text_condition",
        "voice_condition",
        "text_order",
        "voice_order",
    ]

    with open(ASSIGNMENT_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        if not file_exists:
            writer.writeheader()
        writer.writerow({h: row.get(h, "") for h in headers})


def _existing_assignment(participant_id: str) -> Optional[Dict[str, str]]:
    for row in _read_assignments():
        if row.get("participant_id") == participant_id:
            return row
    return None


def _pick_with_capacity(items: List[str], counts: Dict[str, int], limit: int) -> str:
    available = [item for item in items if counts.get(item, 0) < limit]
    if not available:
        # If all slots are full, fall back to the currently least-used item instead of crashing.
        min_count = min(counts.get(item, 0) for item in items)
        available = [item for item in items if counts.get(item, 0) == min_count]
    return random.choice(available)


def _build_counts(rows: List[Dict[str, str]], mode: str, key: str) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for row in rows:
        if row.get("assignment_mode") != mode:
            continue
        value = row.get(key, "")
        if value:
            counts[value] = counts.get(value, 0) + 1
    return counts


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

        assignment["text_condition"] = _pick_with_capacity(
            text_domain["conditions"], text_counts, int(text_domain.get("max_per_condition", 999999))
        )
        assignment["voice_condition"] = _pick_with_capacity(
            voice_domain["conditions"], voice_counts, int(voice_domain.get("max_per_condition", 999999))
        )

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


def build_flow(config: Dict[str, Any], assignment: Dict[str, str]) -> List[Dict[str, Any]]:
    phases: List[Dict[str, Any]] = []
    phases.append(_read_only_phase("intro", "實驗介紹", "實驗內容介紹", "intro"))

    text_config = config["domains"]["text_travel"]
    voice_config = config["domains"]["voice_restaurant"]

    if assignment["assignment_mode"] == "between_subject":
        text_conditions = [assignment["text_condition"]]
        voice_conditions = [assignment["voice_condition"]]
    else:
        text_conditions = list(assignment["text_order"])
        voice_conditions = list(assignment["voice_order"])

    for idx, condition in enumerate(text_conditions, start=1):
        phases.extend(_build_domain_phases("text_travel", condition, idx, text_config))
        phases.append(
            _read_only_phase(
                f"text_questionnaire_run{idx}",
                "文字旅遊問卷",
                "文字旅遊任務問卷",
                "text_questionnaire",
            )
        )

    for idx, condition in enumerate(voice_conditions, start=1):
        phases.extend(_build_domain_phases("voice_restaurant", condition, idx, voice_config))
        phases.append(
            _read_only_phase(
                f"voice_questionnaire_run{idx}",
                "餐廳語音問卷",
                "餐廳語音任務問卷",
                "voice_questionnaire",
            )
        )

    phases.append(_read_only_phase("end", "實驗結束", "完成實驗", "end"))
    return phases


def start_experiment(participant_id: str, assignment_mode: str) -> Dict[str, Any]:
    config = load_config(assignment_mode)
    assignment = create_or_get_assignment(participant_id, assignment_mode)

    # If a participant already exists with a different mode, keep the original assignment and load its config.
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
