# backend/utils/logger.py
import csv
import os
import time
from datetime import datetime

LOG_FILE = "database/experiment_logs.csv"

# 建立一個記憶體內的字典，紀錄每個受試者最後一次被「中斷」的時間點
# 格式: { subject_id: float_timestamp }
# backend/utils/logger.py 修正版

# ... 前面 import 不變

# 💡 修正：使用複合金鑰追蹤各別對話的中斷時間點
interruption_tracker = {} # 格式: { (user_id, chat_id): timestamp }

# 💡 修正：定義必須包含 chat_id，並加入 migration_time_ms 預設值
def log_event(subject_id, chat_id, scenario, trigger_type, user_input="", ai_response="", tokens=0, rounds=0, migration_time_ms=0):
    file_exists = os.path.isfile(LOG_FILE)
    current_time = time.time()
    
    recovery_time_ms = 0
    tracker_key = (subject_id, chat_id) # 💡 使用複合金鑰
    
    # 💡 修正：計算復原時間
    if trigger_type == "manual" and tracker_key in interruption_tracker:
        recovery_time_ms = (current_time - interruption_tracker[tracker_key]) * 1000
        del interruption_tracker[tracker_key]

    # --- 修正 CSV 欄位，確保包含 Chat_ID 與 Migration_Time ---
    headers = [
        "Timestamp", "Subject_ID", "Chat_ID", "Scenario", "Trigger_Type", 
        "Recovery_Time_ms", "Migration_Time_ms", "Tokens", "Rounds", "Input_Length"
    ]
    
    with open(LOG_FILE, mode='a', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        if not file_exists:
            writer.writeheader()
        
        writer.writerow({
            "Timestamp": datetime.now().isoformat(),
            "Subject_ID": subject_id,
            "Chat_ID": chat_id, # 💡 寫入對話 ID
            "Scenario": scenario,
            "Trigger_Type": trigger_type,
            "Recovery_Time_ms": round(recovery_time_ms, 2),
            "Migration_Time_ms": round(migration_time_ms, 2), # 💡 寫入遷移時間
            "Tokens": tokens,
            "Rounds": rounds,
            "Input_Length": len(user_input)
        })

def log_migration(user_id, chat_id, migration_time, summary):
    # 💡 呼叫修正後的 log_event，並傳入遷移耗時
    log_event(
        subject_id=user_id, 
        chat_id=chat_id, 
        scenario="C", 
        trigger_type="migration_click", 
        user_input=f"[SUMMARY]: {summary}", 
        migration_time_ms=migration_time
    )

def record_interruption(subject_id, chat_id, scenario): # 💡 修正：傳入 chat_id
    tracker_key = (subject_id, chat_id)
    interruption_tracker[tracker_key] = time.time()
    
    log_event(
        subject_id=subject_id, 
        chat_id=chat_id, # 💡 傳入 chat_id
        scenario=scenario, 
        trigger_type="auto_vad",
        user_input="[SYSTEM_AUTO_CUTOFF]"
    )