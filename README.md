# Research_agent

A Windows-friendly web experiment platform for studying how different GenAI interaction designs affect user performance and experience. The system supports text and voice tasks, Phase 0 baseline measurement, Qualtrics entry/redirect flow, backend random assignment, configurable runtime settings through a root-level `config.json`, SQLite logging, and public remote testing through Vercel + Cloudflare Quick Tunnel.

This project is designed and implemented by **林悦揚**.

---

## 1. Project Overview

`Research_agent` is a controlled AI experiment platform. Participants enter through a Qualtrics-style URL, complete a Phase 0 baseline task, then complete assigned text and/or voice AI collaboration tasks. The platform records participant assignment, interaction logs, timing data, voice/VAD metadata, task state, LLM provider metadata, and completion status into a local SQLite database.

The current deployment model is:

```text
Participant browser
↓
Vercel fixed frontend URL
↓
Cloudflare Quick Tunnel backend URL
↓
Local FastAPI backend on the experiment computer
↓
Local SQLite database
```

This means the frontend URL can stay fixed, while the backend tunnel URL may change every time the experiment host computer restarts the tunnel. The provided Windows script automatically updates the Vercel frontend environment variable and redeploys the frontend.

---

## 2. Main Features

- Next.js frontend experiment interface
- FastAPI backend
- Root-level `config.json` for non-programmer experiment configuration
- LLM provider switching: Groq / OpenAI / Gemini
- Pilot/formal run mode configuration
- Text task and voice task support
- Phase 0 baseline task before formal tasks
- Qualtrics URL entry validation
- Qualtrics post-task redirect
- Backend random assignment
- Between-subject and within-subject assignment modes
- SQLite logging database
- Action logs, event logs, conversation logs, timing logs, and system errors
- T1/T4/T5 client timing measurement
- Server processing time, LLM TTFT, and total generation time
- Whisper/STT timing and voice duration logging
- Voice Condition A: automatic VAD cut-off
- Voice Condition B: silence hint / manual voice submission
- Voice Condition C: repairable VAD with “continue recording” or “send now”
- Repair gate event logging: `repair_gate_shown` and `repair_gate_decision`
- Voice Condition C metadata logging:
  - `Turn_ID`
  - `VAD_Trigger_Count`
  - `Final_Repair_Choice`
  - `Total_Repair_Gate_Dwell_ms`
  - `Pure_Speech_Duration_ms`
  - `Final_Transcript`
  - `Auto_Submitted`
- LLM covariate logging:
  - `LLM_Provider`
  - `LLM_Model`
  - `LLM_Run_Mode`
- Research tools panel protected by a password
- Participant ID hidden from the normal participant UI
- Windows PowerShell deployment scripts
- Vercel fixed frontend + Cloudflare Quick Tunnel backend

---

## 3. Recommended Environment

This README assumes the project is rebuilt on Windows.

Recommended tools:

```text
Windows 10/11
Anaconda or Miniconda
Python 3.10+
Node.js 20+
npm
Git
Vercel CLI
Cloudflare cloudflared
```

The tested project path was:

```text
C:\Users\USER\Desktop\Research_agent
```

You may use another path, but the commands below assume this path.

---

## 4. Project Structure

```text
Research_agent/
├─ config.json
├─ backend/
│  ├─ main.py
│  ├─ config.py
│  ├─ core/
│  │  ├─ llm_provider.py
│  │  ├─ scenario_a.py
│  │  ├─ scenario_b.py
│  │  └─ scenario_c.py
│  ├─ experiment/
│  │  ├─ assignment.py
│  │  └─ database.py
│  ├─ experiment_configs/
│  │  ├─ between_subject.json
│  │  └─ within_subject.json
│  ├─ task_docs/
│  │  └─ phase0_baseline.md
│  ├─ utils/
│  │  └─ logger.py
│  └─ database/
│     └─ experiment.db
│
├─ frontend/
│  ├─ app/
│  │  └─ page.tsx
│  ├─ services/
│  │  └─ api.ts
│  ├─ package.json
│  └─ package-lock.json
│
├─ scripts/
│  ├─ Start-VercelQuickTunnel.ps1
│  ├─ Start-VercelQuickTunnel.bat
│  └─ Set-VercelBackendUrl.ps1
│
├─ deployment/
│  └─ VERCEL_QUICK_TUNNEL_WINDOWS_README.md
│
├─ README.md
└─ AUTHORS.md
```

The recommended current remote deployment script is:

```powershell
.\scripts\Start-VercelQuickTunnel.ps1
```

---

## 5. Rebuild the Project on a New Computer

### 5.1 Clone the project

```powershell
cd C:\Users\USER\Desktop
git clone <YOUR_REPO_URL> Research_agent
cd C:\Users\USER\Desktop\Research_agent
```

If you are copying the folder manually, make sure the following are included:

```text
backend/
frontend/
scripts/
deployment/
config.json
README.md
```

Do not rely on old `.next` build folders. Rebuild the frontend on the new computer.

---

### 5.2 Create and activate Conda environment

```powershell
conda create -n ai-research python=3.10 -y
conda activate ai-research
```

Install backend dependencies. If your project has `backend/requirements.txt`, use:

```powershell
cd C:\Users\USER\Desktop\Research_agent\backend
pip install -r requirements.txt
```

If there is no `requirements.txt`, install the core packages manually:

```powershell
pip install fastapi uvicorn python-dotenv groq pydantic python-multipart requests
```

If you use OpenAI or Gemini for formal runs, also install the corresponding package:

```powershell
pip install openai google-generativeai
```

---

### 5.3 Create backend `.env`

Create this file:

```text
C:\Users\USER\Desktop\Research_agent\backend\.env
```

Example for pilot mode using Groq:

```env
GROQ_API_KEY=your_groq_api_key_here
```

Optional keys for formal mode:

```env
OPENAI_API_KEY=your_openai_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

Do not commit real API keys to GitHub.

---

### 5.4 Install frontend dependencies

```powershell
cd C:\Users\USER\Desktop\Research_agent\frontend
npm install
```

If `npm install` fails because of an old lockfile, try:

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item package-lock.json -ErrorAction SilentlyContinue
npm install
```

---

### 5.5 Install Vercel CLI

```powershell
npm i -g vercel
vercel login
```

Then link the frontend folder to your Vercel project:

```powershell
cd C:\Users\USER\Desktop\Research_agent\frontend
vercel link
```

When asked, select or create the correct Vercel project.

---

### 5.6 Install Cloudflare Tunnel

```powershell
winget install --id Cloudflare.cloudflared
```

Check installation:

```powershell
cloudflared --version
```

If PowerShell cannot find `cloudflared`, restart the terminal or add it to PATH.

---

## 6. Main Configuration: `config.json`

The main experiment configuration file is now at the project root:

```text
C:\Users\USER\Desktop\Research_agent\config.json
```

This file is designed so that a non-programmer can modify experiment settings without editing Python code.

Important settings include:

```json
{
  "dev_password": "1234",
  "experiment_assignment_mode": "between_subject",
  "qualtrics_allow_url_condition_override": true,
  "qualtrics_require_condition_in_url": false,

  "llm_run_mode": "pilot",
  "pilot_llm_provider": "groq",
  "formal_llm_provider": "openai",

  "groq_model_name": "llama-3.1-8b-instant",
  "openai_model_name": "gpt-5-nano",
  "gemini_model_name": "gemini-2.5-flash-lite",

  "stt_provider": "groq",
  "stt_model_name": "whisper-large-v3-turbo",
  "stt_language": "zh",

  "scenario_a_round_limit": 6,
  "token_threshold": 6000,
  "summary_threshold": 0.8,

  "vad_threshold": 0.015,
  "vad_silence_timeout_a": 1.0,
  "vad_silence_timeout_b": 1.0,
  "vad_silence_timeout_c": 0.7
}
```

Rules for editing `config.json`:

```text
Use double quotes for strings.
Use lowercase true / false.
Do not add comments inside JSON.
Do not leave a trailing comma after the last item.
Restart the backend after editing config.json.
```

`backend/config.py` is now a compatibility layer that reads values from root `config.json`. Most users should edit `config.json`, not `backend/config.py`.

---

## 7. Local Development

Use this when testing on your own computer only.

### 7.1 Start backend

```powershell
cd C:\Users\USER\Desktop\Research_agent\backend
conda activate ai-research
python -m uvicorn main:app --reload --port 8000
```

Check backend:

```text
http://127.0.0.1:8000/config
```

Expected response includes:

```text
vad_timeout_a
vad_timeout_b
vad_timeout_c
llm_provider
llm_model
llm_run_mode
```

---

### 7.2 Start frontend

Open another PowerShell:

```powershell
cd C:\Users\USER\Desktop\Research_agent\frontend
npm run dev
```

Open:

```text
http://localhost:3000
```

---

## 8. Formal Remote Experiment Deployment

Use this when participants need to access the experiment from another computer or phone.

The current recommended script is:

```powershell
.\scripts\Start-VercelQuickTunnel.ps1
```

It automatically:

```text
1. Starts local FastAPI backend
2. Waits for http://127.0.0.1:8000/config
3. Starts Cloudflare Quick Tunnel for the backend
4. Detects the public backend URL
5. Updates Vercel production env NEXT_PUBLIC_API_BASE
6. Deploys frontend to Vercel production
7. Prints the fixed frontend URL
8. Keeps backend and tunnel alive until you stop the script
```

### 8.1 Start public experiment

```powershell
cd C:\Users\USER\Desktop\Research_agent
conda activate ai-research
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\Start-VercelQuickTunnel.ps1
```

Successful output should look like:

```text
[READY] Public experiment is ready

Temporary public backend URL:
  https://xxxxx.trycloudflare.com

Vercel deployment URL:
  https://agent-ten-topaz.vercel.app
```

Keep this PowerShell window open during the experiment.

Closing this window stops:

```text
local backend
Cloudflare tunnel
remote backend access
```

The Vercel frontend URL may still open, but it cannot communicate with the backend after the tunnel stops.

---

### 8.2 If using the `.bat` file

You can also run:

```powershell
cd C:\Users\USER\Desktop\Research_agent
.\scripts\Start-VercelQuickTunnel.bat
```

The PowerShell script is recommended because it shows clearer logs.

---

### 8.3 Update only the backend URL

If the backend tunnel is already running and you only need to update Vercel:

```powershell
cd C:\Users\USER\Desktop\Research_agent
.\scripts\Set-VercelBackendUrl.ps1 -ApiBase https://xxxxx.trycloudflare.com
```

---

## 9. Qualtrics Entry URL

The frontend URL is fixed. Example:

```text
https://agent-ten-topaz.vercel.app
```

For manual testing, use a URL like:

```text
https://agent-ten-topaz.vercel.app/?sid=P_TEST_001&qid=R_TEST_001&consent=yes&study=main&token=testtoken&redirect_url=https%3A%2F%2Fexample.com%2Fposttest
```

For Qualtrics, use embedded fields. Example format:

```text
https://agent-ten-topaz.vercel.app/?sid=${e://Field/sid}&qid=${e://Field/ResponseID}&consent=yes&study=main&token=YOUR_TOKEN&redirect_url=https%3A%2F%2FYOUR_QUALTRICS_POST_SURVEY_URL
```

The condition can be omitted if backend random assignment is enabled.

Optional URL parameters for pilot testing:

```text
text=A|B|C
voice=A|B|C
```

Example for testing Voice Condition C:

```text
http://localhost:3000/?sid=P_TEST_C_001&qid=R_TEST_C_001&consent=yes&study=pilot&token=test&voice=C&text=A&redirect_url=https%3A%2F%2Fexample.com%2Fpost
```

If URL override is disabled in `config.json`, backend assignment will be used even if condition parameters are provided.

---

## 10. Assignment Configuration

Edit the root configuration file:

```text
config.json
```

Important settings:

```json
{
  "experiment_assignment_mode": "between_subject",
  "qualtrics_allow_url_condition_override": true,
  "qualtrics_require_condition_in_url": false,
  "between_subject_text_max_per_condition": 20,
  "between_subject_voice_max_per_condition": 20,
  "within_subject_text_max_per_order": 10,
  "within_subject_voice_max_per_order": 10
}
```

### Between-subject mode

Each participant receives one text condition and one voice condition.

```text
Text:  A / B / C
Voice: A / B / C
```

### Within-subject mode

Each participant receives an ordered sequence. The available orders depend on the experiment config files in:

```text
backend/experiment_configs/
```

Typical condition orders include:

```text
Text orders:  ABC / ACB / BAC / BCA / CAB / CBA
Voice orders: ABC / ACB / BAC / BCA / CAB / CBA
```

---

## 11. Text and Voice Conditions

### 11.1 Text conditions

```text
Text A: implicit rolling truncation
Text B: explicit warning / user-managed new conversation
Text C: summary migration
```

### 11.2 Voice conditions

```text
Voice A: automatic VAD cut-off after silence
Voice B: silence hint, user manually submits
Voice C: repairable VAD
```

Voice Condition C behavior:

```text
1. User starts recording.
2. When silence exceeds vad_silence_timeout_c, the recorder pauses.
3. A repair gate appears.
4. User chooses either:
   - 繼續錄音
   - 現在送出
5. If user chooses 繼續錄音, the same MediaRecorder turn resumes.
6. If user chooses 現在送出, the accumulated audio is sent to STT.
7. The final transcript is sent to the LLM.
```

Voice Condition C records:

```text
repair_gate_shown
repair_gate_decision
Turn_ID
VAD_Trigger_Count
Final_Repair_Choice
Total_Repair_Gate_Dwell_ms
Pure_Speech_Duration_ms
Final_Transcript
Auto_Submitted
```

---

## 12. Phase 0 Baseline

The first task is Phase 0 baseline.

It measures:

```text
Typing speed
Typing accuracy
Speech duration
Speech/silence ratio
Voice frame counts
```

The formal tasks are locked until Phase 0 is completed.

Phase 0 values are stored in the `Participants` table, including:

```text
Baseline_Typing_CPM_Chinese
Baseline_Typing_WPM
Baseline_Typing_Duration_ms
Baseline_Typing_Accuracy
Baseline_Speech_Ratio
Baseline_Speech_Duration_ms
Baseline_Voice_Frames
Baseline_Silence_Frames
Phase0_Completed
Phase0_Completed_At
Baseline_Raw_JSON
```

---

## 13. Research Tools Panel

The normal participant interface does not show the participant ID in the top-right corner.

The participant ID and reset tools are hidden inside the research tools panel. To unlock:

```text
Open Research Tools
Enter the dev_password from config.json
```

Default password:

```text
1234
```

After unlocking, the researcher can see participant/session information and use administrative controls.

---

## 14. SQLite Database

The main database is:

```text
backend/database/experiment.db
```

Main tables:

```text
Participants
Conversation_Messages
Action_Logs
Event_Logs
System_Errors
Data_Quality_Flags
```

### 14.1 Action_Logs important fields

Core fields:

```text
Subject_ID
Task_Type
Current_Phase
Mission_ID
Mission_Title
Phase_ID
Phase_Label
Chat_ID
Turn_Count
Input_Method
Trigger_Type
Prompt_Tokens
Completion_Tokens
User_Input
AI_Response
```

Timing fields:

```text
User_Reengagement_ms
Client_Roundtrip_ms
Server_Processing_ms
Estimated_Network_RTT_ms
Network_RTT_ms
LLM_TTFT_ms
LLM_Total_Generation_ms
Whisper_STT_ms
Raw_Timing_JSON
```

Voice / Condition C fields:

```text
Voice_Duration_ms
STT_Transcript
Turn_ID
VAD_Trigger_Count
Final_Repair_Choice
Total_Repair_Gate_Dwell_ms
Pure_Speech_Duration_ms
Final_Transcript
Final_Audio_File_Path
Auto_Submitted
```

LLM covariate fields:

```text
LLM_Provider
LLM_Model
LLM_Run_Mode
```

---

### 14.2 Check database tables

```powershell
cd C:\Users\USER\Desktop\Research_agent
@'
import sqlite3

conn = sqlite3.connect("backend/database/experiment.db")
for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
    print(row[0])
conn.close()
'@ | python
```

### 14.3 Show latest participants

```powershell
cd C:\Users\USER\Desktop\Research_agent
@'
import sqlite3
from pprint import pprint

conn = sqlite3.connect("backend/database/experiment.db")
conn.row_factory = sqlite3.Row

for r in conn.execute("""
SELECT Subject_ID, Qualtrics_Response_ID, Consent_Status, Study_Mode,
       Assigned_Text_Scenario, Assigned_Voice_Condition, Assigned_Task_Order,
       PreSurvey_Completed, Task_Completion_Status, Created_At
FROM Participants
ORDER BY Created_At DESC
LIMIT 10
"""):
    pprint(dict(r))

conn.close()
'@ | python
```

### 14.4 Backup database before formal testing

Before a real experiment session:

```powershell
cd C:\Users\USER\Desktop\Research_agent
Copy-Item backend\database\experiment.db backend\database\experiment_backup_$(Get-Date -Format "yyyyMMdd_HHmmss").db
```

Do this before any major deployment or code update.

---

## 15. Remote Connection Test Checklist

After running:

```powershell
.\scripts\Start-VercelQuickTunnel.ps1
```

### 15.1 Test backend tunnel

Open:

```text
https://xxxxx.trycloudflare.com/config
```

Expected result: JSON config response.

### 15.2 Test fixed frontend

Open:

```text
https://agent-ten-topaz.vercel.app
```

Expected result: experiment interface loads.

### 15.3 Test Qualtrics-style entry

Use a new `sid` each time:

```text
https://agent-ten-topaz.vercel.app/?sid=P_REMOTE_TEST_001&qid=R_REMOTE_TEST_001&consent=yes&study=main&token=testtoken&redirect_url=https%3A%2F%2Fexample.com%2Fposttest
```

Expected result:

```text
No manual condition selection
Phase 0 baseline appears first
Formal tasks remain locked until Phase 0 is completed
```

### 15.4 Test Voice Condition C

Use:

```text
https://agent-ten-topaz.vercel.app/?sid=P_REMOTE_TEST_C_001&qid=R_REMOTE_TEST_C_001&consent=yes&study=pilot&token=testtoken&voice=C&text=A&redirect_url=https%3A%2F%2Fexample.com%2Fposttest
```

Expected result:

```text
Voice task reaches Condition C
Silence triggers repair gate
Prompt appears in Traditional Chinese
User can choose 繼續錄音 or 現在送出
Final transcript is sent to the AI
Action_Logs records Condition C fields
Event_Logs records repair_gate_shown / repair_gate_decision
```

### 15.5 Check browser Network tab

Chrome:

```text
F12 → Network → Fetch/XHR
```

Requests should go to:

```text
https://xxxxx.trycloudflare.com/config
https://xxxxx.trycloudflare.com/experiment/start
https://xxxxx.trycloudflare.com/experiment/state
```

They should not go to:

```text
http://localhost:8000
https://agent-ten-topaz.vercel.app/https:/xxxxx.trycloudflare.com/...
https://agent-ten-topaz.vercel.app/%EF%BB%BFhttps:/xxxxx.trycloudflare.com/...
```

The `%EF%BB%BF` form means a UTF-8 BOM was accidentally written into `NEXT_PUBLIC_API_BASE`.

---

## 16. Logs

Deployment script logs are stored in:

```text
.remote_logs/
```

Useful commands:

```powershell
Get-Content .remote_logs\backend*.out.log -Tail 100
Get-Content .remote_logs\backend*.err.log -Tail 100
Get-Content .remote_logs\backend_tunnel*.out.log -Tail 100
Get-Content .remote_logs\backend_tunnel*.err.log -Tail 100
Get-Content .remote_logs\vercel_deploy*.out.log -Tail 100
Get-Content .remote_logs\vercel_deploy*.err.log -Tail 100
```

---

## 17. Common Problems and Fixes

### 17.1 PowerShell blocks script execution

Run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Then run the script again.

---

### 17.2 Backend cannot import `main`

Make sure backend is started from the backend folder:

```powershell
cd C:\Users\USER\Desktop\Research_agent\backend
python -m uvicorn main:app --reload --port 8000
```

Do not use this in PowerShell:

```powershell
cd /d "C:\Users\USER\Desktop\Research_agent\backend"
```

`cd /d` is a `cmd.exe` syntax, not PowerShell syntax.

---

### 17.3 Vercel frontend still calls old backend

Cause: `NEXT_PUBLIC_API_BASE` is build-time for Next.js.

Fix:

```powershell
.\scripts\Start-VercelQuickTunnel.ps1
```

The script updates the env and redeploys Vercel.

Then hard refresh the browser:

```text
Ctrl + Shift + R
```

Or use an incognito window.

---

### 17.4 Request URL contains `%EF%BB%BFhttps` or `agent-ten-topaz.vercel.app/https:/...`

Cause: `NEXT_PUBLIC_API_BASE` contains a hidden BOM or is malformed.

Fix:

Use the latest scripts that write the Vercel env value through no-BOM echo/pipe logic.

Then rerun:

```powershell
.\scripts\Start-VercelQuickTunnel.ps1
```

Check DevTools Network again. Correct requests must go directly to `https://xxxxx.trycloudflare.com/...`.

---

### 17.5 CORS error

If the browser console shows CORS errors, make sure the backend CORS settings allow your Vercel domain:

```text
https://agent-ten-topaz.vercel.app
```

Also allow local development origins if needed:

```text
http://localhost:3000
http://127.0.0.1:3000
```

---

### 17.6 Cloudflare tunnel URL changed

Cloudflare Quick Tunnel URL changes every time it starts.

Fix:

Always rerun:

```powershell
.\scripts\Start-VercelQuickTunnel.ps1
```

Do not manually reuse an old tunnel URL.

---

### 17.7 Vercel CLI prints warnings to stderr

On Windows, Vercel CLI may print normal messages to stderr. The script handles known successful messages and continues.

If deployment still fails, check:

```powershell
Get-Content .remote_logs\vercel_deploy*.err.log -Tail 100
```

---

## 18. Data Safety Before Formal Experiments

Before each formal data collection session:

```powershell
cd C:\Users\USER\Desktop\Research_agent
Copy-Item backend\database\experiment.db backend\database\experiment_backup_$(Get-Date -Format "yyyyMMdd_HHmmss").db
```

Recommended formal experiment checklist:

```text
1. Confirm backend/.env API keys are valid
2. Confirm config.json settings are correct
3. Confirm backend /config works locally
4. Run Start-VercelQuickTunnel.ps1
5. Confirm backend tunnel /config works remotely
6. Confirm Vercel frontend loads
7. Confirm Network requests go to trycloudflare.com
8. Run one test participant with a fresh sid
9. Confirm SQLite receives data
10. Backup experiment.db
11. Start participant collection
```

---

## 19. Git Notes

Files that should usually not be committed:

```text
backend/.env
.env
backend/database/experiment.db
backend/database/*.db
backend/database/*.db-wal
backend/database/*.db-shm
backend/database/*.csv
backend/database/*.jsonl
backend/database/participant_states/
.remote_logs/
analysis_exports_demo/
frontend/.next/
frontend/node_modules/
PATCH_NOTES.md
apply_*_patch.py
note.docx
*.bak
```

Recommended `.gitignore` entries:

```gitignore
# Python
__pycache__/
*.pyc
.venv/
venv/
.env
backend/.env

# Node / Next
node_modules/
.next/
out/
.vercel/
frontend/node_modules/
frontend/.next/
frontend/out/

# Experiment runtime data
backend/database/*.db
backend/database/*.db-journal
backend/database/*.db-wal
backend/database/*.db-shm
backend/database/*.sqlite
backend/database/*.sqlite3
backend/database/*.sqlite3-wal
backend/database/*.sqlite3-shm
backend/database/*.csv
backend/database/*.jsonl
backend/database/participant_states/
.remote_logs/
logs/
*.log
analysis_exports_demo/

# Local generated / backup files
*.tmp
*.bak
PATCH_NOTES.md
apply_*_patch.py
note.docx
```

If you want to version the database schema but not real participant data, export schema separately instead of committing `experiment.db`.

---

## 20. Quick Command Summary

### Local dev

```powershell
# Backend
cd C:\Users\USER\Desktop\Research_agent\backend
conda activate ai-research
python -m uvicorn main:app --reload --port 8000

# Frontend
cd C:\Users\USER\Desktop\Research_agent\frontend
npm run dev
```

### Remote formal testing

```powershell
cd C:\Users\USER\Desktop\Research_agent
conda activate ai-research
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\Start-VercelQuickTunnel.ps1
```

### Check SQLite latest participants

```powershell
cd C:\Users\USER\Desktop\Research_agent
@'
import sqlite3
from pprint import pprint
conn = sqlite3.connect("backend/database/experiment.db")
conn.row_factory = sqlite3.Row
for r in conn.execute("SELECT * FROM Participants ORDER BY Created_At DESC LIMIT 3"):
    pprint(dict(r))
conn.close()
'@ | python
```

---

## 21. Author

This project was designed and implemented by:

**林悦揚**
