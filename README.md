# Research_agent

A Windows-friendly web experiment platform for studying how different GenAI interaction designs affect user performance and experience. The system supports text and voice tasks, Phase 0 baseline measurement, Qualtrics entry/redirect flow, backend random assignment, SQLite logging, and public remote testing through Vercel + Cloudflare Quick Tunnel.

This project is designed and implemented by **林悦揚**.

---

## 1. Project Overview

`Research_agent` is a controlled AI experiment platform. Participants enter through a Qualtrics-style URL, complete a Phase 0 baseline task, then complete assigned text and/or voice AI collaboration tasks. The platform records participant assignment, interaction logs, timing data, voice/VAD metadata, task state, and completion status into a local SQLite database.

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
- Groq LLM integration
- Text task and voice task support
- Phase 0 baseline task before formal tasks
- Qualtrics URL entry validation
- Qualtrics post-task redirect
- Backend random assignment
- Between-subject and within-subject assignment modes
- SQLite logging database
- Action logs, event logs, conversation logs, timing logs, and system errors
- T1/T4/T5 client timing measurement
- Server processing time, LLM TTFT, total generation time
- Whisper/STT timing and voice duration logging
- VAD interruption/manipulation logging
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
├─ backend/
│  ├─ main.py
│  ├─ config.py
│  ├─ core/
│  │  ├─ scenario_a.py
│  │  ├─ scenario_b.py
│  │  └─ scenario_c.py
│  ├─ experiment/
│  │  ├─ assignment.py
│  │  └─ database.py
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

Older scripts such as `Start-PublicExperiment.ps1` or `start_remote.ps1` may still exist, but the recommended current script is:

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

If your current backend uses extra packages, install them as needed based on import errors.

---

### 5.3 Create backend `.env`

Create this file:

```text
C:\Users\USER\Desktop\Research_agent\backend\.env
```

Example:

```env
GROQ_API_KEY=your_groq_api_key_here
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

## 6. Local Development

Use this when testing on your own computer only.

### 6.1 Start backend

```powershell
cd C:\Users\USER\Desktop\Research_agent\backend
conda activate ai-research
python -m uvicorn main:app --reload --port 8000
```

Check backend:

```text
http://127.0.0.1:8000/config
```

---

### 6.2 Start frontend

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

## 7. Formal Remote Experiment Deployment

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

### 7.1 Start public experiment

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

### 7.2 If using the `.bat` file

You can also run:

```powershell
cd C:\Users\USER\Desktop\Research_agent
.\scripts\Start-VercelQuickTunnel.bat
```

The PowerShell script is recommended because it shows clearer logs.

---

### 7.3 Update only the backend URL

If the backend tunnel is already running and you only need to update Vercel:

```powershell
cd C:\Users\USER\Desktop\Research_agent
.\scripts\Set-VercelBackendUrl.ps1 -ApiBase https://xxxxx.trycloudflare.com
```

---

## 8. Qualtrics Entry URL

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

Optional URL parameters:

```text
text=A|B|C
voice=A|B
order=text_first|voice_first
```

If URL override is disabled in `backend/config.py`, backend assignment will be used even if condition parameters are provided.

---

## 9. Assignment Configuration

Edit:

```text
backend/config.py
```

Important settings:

```python
EXPERIMENT_ASSIGNMENT_MODE = "between_subject"  # or "within_subject"

QUALTRICS_ALLOW_URL_CONDITION_OVERRIDE = True
QUALTRICS_REQUIRE_CONDITION_IN_URL = False

BETWEEN_SUBJECT_TEXT_MAX_PER_CONDITION = 20
BETWEEN_SUBJECT_VOICE_MAX_PER_CONDITION = 20

WITHIN_SUBJECT_TEXT_MAX_PER_ORDER = 10
WITHIN_SUBJECT_VOICE_MAX_PER_ORDER = 10
```

### Between-subject mode

Each participant receives one text condition and one voice condition.

```text
Text:  A / B / C
Voice: A / B
```

### Within-subject mode

Each participant receives an ordered sequence.

```text
Text orders:  ABC / ACB / BAC / BCA / CAB / CBA
Voice orders: AB / BA
```

---

## 10. Phase 0 Baseline

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

## 11. SQLite Database

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

### 11.1 Check database tables

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

### 11.2 Show latest participants

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

### 11.3 Backup database before formal testing

Before a real experiment session:

```powershell
cd C:\Users\USER\Desktop\Research_agent
Copy-Item backend\database\experiment.db backend\database\experiment_backup_$(Get-Date -Format "yyyyMMdd_HHmmss").db
```

Do this before any major deployment or code update.

---

## 12. Remote Connection Test Checklist

After running:

```powershell
.\scripts\Start-VercelQuickTunnel.ps1
```

### 12.1 Test backend tunnel

Open:

```text
https://xxxxx.trycloudflare.com/config
```

Expected result: JSON config response.

### 12.2 Test fixed frontend

Open:

```text
https://agent-ten-topaz.vercel.app
```

Expected result: experiment interface loads.

### 12.3 Test Qualtrics-style entry

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

### 12.4 Check browser Network tab

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

## 13. Logs

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

## 14. Common Problems and Fixes

### 14.1 PowerShell blocks script execution

Run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Then run the script again.

---

### 14.2 Backend cannot import `main`

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

### 14.3 Vercel frontend still calls old backend

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

### 14.4 Request URL contains `%EF%BB%BFhttps` or `agent-ten-topaz.vercel.app/https:/...`

Cause: `NEXT_PUBLIC_API_BASE` contains a hidden BOM or is malformed.

Fix:

Use the latest scripts that write the Vercel env value through no-BOM echo/pipe logic.

Then rerun:

```powershell
.\scripts\Start-VercelQuickTunnel.ps1
```

Check DevTools Network again. Correct requests must go directly to `https://xxxxx.trycloudflare.com/...`.

---

### 14.5 CORS error

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

### 14.6 Cloudflare tunnel URL changed

Cloudflare Quick Tunnel URL changes every time it starts.

Fix:

Always rerun:

```powershell
.\scripts\Start-VercelQuickTunnel.ps1
```

Do not manually reuse an old tunnel URL.

---

### 14.7 Vercel CLI prints warnings to stderr

On Windows, Vercel CLI may print normal messages to stderr. The script handles known successful messages and continues.

If deployment still fails, check:

```powershell
Get-Content .remote_logs\vercel_deploy*.err.log -Tail 100
```

---

## 15. Data Safety Before Formal Experiments

Before each formal data collection session:

```powershell
cd C:\Users\USER\Desktop\Research_agent
Copy-Item backend\database\experiment.db backend\database\experiment_backup_$(Get-Date -Format "yyyyMMdd_HHmmss").db
```

Recommended formal experiment checklist:

```text
1. Confirm GROQ_API_KEY is valid
2. Confirm backend /config works locally
3. Run Start-VercelQuickTunnel.ps1
4. Confirm backend tunnel /config works remotely
5. Confirm Vercel frontend loads
6. Confirm Network requests go to trycloudflare.com
7. Run one test participant with a fresh sid
8. Confirm SQLite receives data
9. Backup experiment.db
10. Start participant collection
```

---

## 16. Git Notes

Files that should usually not be committed:

```text
backend/.env
backend/database/experiment.db
backend/database/*.db
.remote_logs/
frontend/.next/
frontend/node_modules/
```

Recommended `.gitignore` entries:

```gitignore
# env
.env
backend/.env

# Python
__pycache__/
*.pyc
.venv/

# SQLite data
backend/database/*.db
backend/database/*.db-journal
backend/database/*.db-wal
backend/database/*.db-shm

# frontend
frontend/node_modules/
frontend/.next/
frontend/out/

# deployment logs
.remote_logs/
```

If you want to version the database schema but not real participant data, export schema separately instead of committing `experiment.db`.

---

## 17. Quick Command Summary

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

## 18. Author

This project was designed and implemented by:

**林悦揚**
