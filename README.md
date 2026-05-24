# Research_agent

A web-based experiment platform for studying how different long-context handling strategies affect user experience when interacting with an AI travel-planning assistant.

This project is designed and implemented by **林悦揚**.

## Project Overview

Research_agent provides a controlled chat interface for user studies. Participants interact with an AI assistant under different experimental conditions. The current experiment focuses on travel-planning tasks and compares how users experience different context-management strategies.

The system includes:

- A **Next.js frontend** chat interface
- A **FastAPI backend**
- Integration with **Groq LLM API**
- Voice input and speech-to-text support
- Participant ID input for separating experimental logs
- Scenario-based experimental conditions
- Experiment logging
- Optional Cloudflare Tunnel script for remote participant testing

## Experimental Conditions

The system currently supports three scenarios:

| Scenario | Description |
|---|---|
| A | Rolling context / implicit truncation |
| B | User-facing warning / explicit context awareness |
| C | AI-generated summary migration |

## Main Features

- Text chat with AI assistant
- Expandable textarea input
- `Enter` to send, `Shift + Enter` to insert a new line
- Send button and microphone button
- Loading bubble while AI is responding
- Scenario C summary migration card
- Participant ID modal before starting the experiment
- Per-participant logging through `participant_id`
- Voice input with VAD-based silence detection
- Backend logging of interaction metadata

## Project Structure

```text
Research_agent/
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── core/
│   │   ├── scenario_a.py
│   │   ├── scenario_b.py
│   │   └── scenario_c.py
│   └── utils/
│       ├── counter.py
│       └── logger.py
│
├── frontend/
│   ├── app/
│   │   └── page.tsx
│   ├── services/
│   │   └── api.ts
│   ├── package.json
│   └── package-lock.json
│
├── start_remote.ps1
├── README.md
└── AUTHORS.md
```

## Requirements

### Backend

- Python 3.10+
- FastAPI
- Uvicorn
- python-dotenv
- Groq Python SDK

### Frontend

- Node.js
- npm
- Next.js
- React
- Tailwind CSS
- Axios
- lucide-react

### Remote Testing

- Cloudflare Tunnel CLI: `cloudflared`

Install Cloudflare Tunnel on Windows:

```powershell
winget install --id Cloudflare.cloudflared
```

## Environment Variables

Create a `.env` file for the backend.

Example:

```env
GROQ_API_KEY=your_groq_api_key_here
```

Do not commit real API keys to GitHub.

For frontend remote testing, `NEXT_PUBLIC_API_BASE` is injected by the remote startup script.

Example:

```powershell
$env:NEXT_PUBLIC_API_BASE="https://your-backend-tunnel.trycloudflare.com"
```

## Local Development

### 1. Start Backend

```powershell
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

Backend should be available at:

```text
http://localhost:8000
```

Check config:

```text
http://localhost:8000/config
```

### 2. Start Frontend

Open another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Frontend should be available at:

```text
http://localhost:3000
```

## Production-like Local Start

For a more stable local test:

```powershell
cd frontend
npm run build
npx next start -H 0.0.0.0 -p 3000
```

## Remote Participant Testing

This project includes a PowerShell script:

```text
start_remote.ps1
```

The script is intended to:

1. Start the FastAPI backend
2. Start a Cloudflare Tunnel for the backend
3. Build the frontend with the backend tunnel URL
4. Start the Next.js frontend in production mode
5. Start a Cloudflare Tunnel for the frontend
6. Print the frontend URL for participants

Run:

```powershell
cd C:\Users\USER\Desktop\Research_agent
.\start_remote.ps1
```

When the script succeeds, it will print:

```text
Frontend URL for participants:
https://xxxx.trycloudflare.com
```

Give only this frontend URL to participants.

Keep the script window open. Pressing Enter in that window will stop all services.

## If Remote Start Fails

Before restarting the script, clean old processes and build cache:

```powershell
cd C:\Users\USER\Desktop\Research_agent

taskkill /F /IM node.exe 2>$null
taskkill /F /IM cloudflared.exe 2>$null

Start-Sleep -Seconds 3

if (Test-Path .\frontend\.next) {
    Remove-Item -Recurse -Force .\frontend\.next
}

if (Test-Path .\.remote_logs) {
    Remove-Item -Recurse -Force .\.remote_logs
}

New-Item -ItemType Directory -Path .\.remote_logs | Out-Null

.\start_remote.ps1
```

If the backend is also stuck, additionally run:

```powershell
taskkill /F /IM python.exe 2>$null
```

Use this carefully because it will kill all Python processes.

## Participant Workflow

1. Open the provided frontend URL.
2. Enter the participant ID, such as:

```text
P001
P002
P003
```

3. Select or follow the assigned experimental scenario.
4. Complete the chat tasks.
5. The system records interaction logs with participant ID and chat ID.

## Logging

Experiment logs are saved to:

```text
backend/database/experiment_logs.csv
```

Logged fields include:

- Timestamp
- Subject ID
- Chat ID
- Scenario
- Trigger type
- Recovery time
- Migration time
- Token count
- Round count
- Input length

## Important Notes

- Do not commit `.env` files or API keys.
- The frontend URL and backend URL generated by Cloudflare Quick Tunnel may change every time the script is restarted.
- Cloudflare Quick Tunnel is suitable for testing and small-scale experiments, but not intended as a long-term production deployment.
- For formal studies, use paid Groq usage or sufficient rate limits to avoid API throttling.
- Keep all terminal windows or the script process open during the experiment.

## Author

This project was designed and implemented by:

**林悦揚**
