# backend/utils/logger.py
import csv
import os
import time
from datetime import datetime

LOG_FILE = "database/experiment_logs.csv"

# 建立一個記憶體內的字典，紀錄每個受試者最後一次被「中斷」的時間點
# 格式: { subject_id: float_timestamp }
interruption_tracker = {}

def log_event(subject_id, scenario, trigger_type, user_input="", ai_response="", tokens=0, rounds=0):
    """
    紀錄實驗數據，並自動計算復原時間。
    trigger_type: 'manual' (打字/手動點錄音) 或 'auto_vad' (系統自動截斷)
    """
    file_exists = os.path.isfile(LOG_FILE)
    current_time = time.time()
    
    # --- 核心邏輯：計算復原時間 (Recovery Time) ---
    recovery_time_ms = 0
    # 如果這是一次手動互動，且之前剛好發生過自動中斷
    if trigger_type == "manual" and subject_id in interruption_tracker:
        # 復原時間 = 現在 - 中斷發生的時間
        recovery_time_ms = (current_time - interruption_tracker[subject_id]) * 1000
        # 計算完就清除，直到下一次中斷發生
        del interruption_tracker[subject_id]

    # --- 寫入 CSV ---
    # 擴展欄位，方便你之後直接丟進 SPSS 或 Excel 分析
    headers = [
        "Timestamp", "Subject_ID", "Scenario", "Trigger_Type", 
        "Recovery_Time_ms", "Tokens", "Rounds", "Input_Length"
    ]
    
    with open(LOG_FILE, mode='a', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        if not file_exists:
            writer.writeheader()
        
        writer.writerow({
            "Timestamp": datetime.now().isoformat(),
            "Subject_ID": subject_id,
            "Scenario": scenario,
            "Trigger_Type": trigger_type,
            "Recovery_Time_ms": round(recovery_time_ms, 2),
            "Tokens": tokens,
            "Rounds": rounds,
            "Input_Length": len(user_input)
        })

def record_interruption(subject_id, scenario):
    """
    當系統自動截斷時調用。
    除了紀錄一次事件，最重要的任務是標記「中斷開始」的時間點。
    """
    # 紀錄中斷發生的當下時間
    interruption_tracker[subject_id] = time.time()
    
    # 寫入一筆紀錄，標記這是一次自動中斷
    log_event(
        subject_id=subject_id, 
        scenario=scenario, 
        trigger_type="auto_vad",
        user_input="[SYSTEM_AUTO_CUTOFF]"
    )