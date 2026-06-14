# Windows deployment: Vercel fixed frontend + Cloudflare Quick Tunnel backend

This setup gives participants a fixed Vercel frontend URL while your FastAPI backend runs on your Windows machine.

The backend public URL is temporary because Cloudflare Quick Tunnel changes every time. The script detects the new backend URL, writes it to Vercel as `NEXT_PUBLIC_API_BASE`, and redeploys the frontend.

## Files to place

Put these files in your project:

```text
Research_agent/
  scripts/
    Start-VercelQuickTunnel.ps1
    Start-VercelQuickTunnel.bat
    Set-VercelBackendUrl.ps1
  deployment/
    VERCEL_QUICK_TUNNEL_WINDOWS_README.md
```

## One-time setup

Run these once:

```powershell
npm i -g vercel
vercel login
winget install --id Cloudflare.cloudflared
```

Link your frontend folder to your Vercel project:

```powershell
cd C:\Users\USER\Desktop\Research_agent\frontend
vercel link
```

Make sure your app reads the backend URL from:

```text
NEXT_PUBLIC_API_BASE
```

## Start public experiment

Run this from the project root:

```powershell
cd C:\Users\USER\Desktop\Research_agent
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\Start-VercelQuickTunnel.ps1
```

Or double-click/run:

```bat
scripts\Start-VercelQuickTunnel.bat
```

The script will:

1. Start FastAPI backend on `127.0.0.1:8000`.
2. Start Cloudflare Quick Tunnel for the backend.
3. Detect the `https://*.trycloudflare.com` URL.
4. Update Vercel production env `NEXT_PUBLIC_API_BASE`.
5. Redeploy Vercel production.
6. Keep backend and tunnel alive until you press Enter.

## Important

Keep the PowerShell window open during the experiment. If you close it, the backend tunnel stops.

If the tunnel stops, run the script again. The frontend URL stays fixed, but Vercel must be redeployed with the new backend tunnel URL.

## Qualtrics URL example

Use your fixed Vercel frontend URL:

```text
https://YOUR_PROJECT.vercel.app/?sid=${e://Field/sid}&qid=${e://Field/ResponseID}&consent=yes&study=main&token=YOUR_TOKEN&redirect_url=https%3A%2F%2FYOUR_QUALTRICS_POST_SURVEY_URL
```

Condition parameters are optional if backend random assignment is enabled:

```text
text=A/B/C
voice=A/B
order=text_first/voice_first
```

## Update only backend URL manually

If you already have a tunnel URL:

```powershell
.\scripts\Set-VercelBackendUrl.ps1 -ApiBase https://abc.trycloudflare.com
```

## Logs

Logs are written to:

```text
.remote_logs/
```

Useful files:

```text
backend.*.out.log
backend.*.err.log
backend_tunnel.*.out.log
backend_tunnel.*.err.log
vercel_env_add.*.out.log
vercel_deploy_prod.*.out.log
```
