cd C:\Users\USER\Desktop\Research_agent

Write-Host "Stop old node/cloudflared/python processes..."
taskkill /F /IM node.exe 2>$null
taskkill /F /IM cloudflared.exe 2>$null
taskkill /F /IM python.exe 2>$null

Write-Host "Wait for ports to release..."
Start-Sleep -Seconds 3

Write-Host "Clear Next.js build cache..."
if (Test-Path .\frontend\.next) {
    Remove-Item -Recurse -Force .\frontend\.next
}

Write-Host "Clear remote logs..."
if (Test-Path .\.remote_logs) {
    Remove-Item -Recurse -Force .\.remote_logs
}

Write-Host "Recreate remote logs folder..."
New-Item -ItemType Directory -Path .\.remote_logs | Out-Null

Write-Host "Done. Now start remote script."
.\start_remote.ps1