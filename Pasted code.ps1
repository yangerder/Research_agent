$ErrorActionPreference = "Stop"

$RootDir = "C:\Users\USER\Desktop\Research_agent"
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$LogDir = Join-Path $RootDir ".remote_logs"

$BackendPort = 8000
$FrontendPort = 3000

if (!(Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}

function Start-LoggedProcess {
    param (
        [string]$Name,
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    $RunId = Get-Date -Format "yyyyMMdd_HHmmss"

    $stdout = Join-Path $LogDir "$Name.$RunId.out.log"
    $stderr = Join-Path $LogDir "$Name.$RunId.err.log"

    Write-Host "[START] $Name"

    $process = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru `
        -WindowStyle Hidden

    return @{
        Name = $Name
        Process = $process
        Stdout = $stdout
        Stderr = $stderr
    }
}

function Wait-ForLocalService {
    param (
        [string]$Url,
        [int]$TimeoutSec = 60
    )

    Write-Host "[WAIT] Local service: $Url"

    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSec) {
        try {
            Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 | Out-Null
            Write-Host "[OK] Local service ready: $Url"
            return
        } catch {
            Start-Sleep -Seconds 1
        }
    }

    throw "Timeout waiting for local service: $Url"
}

function Wait-ForTunnelUrl {
    param (
        [string[]]$LogFiles,
        [int]$TimeoutSec = 90
    )

    Write-Host "[WAIT] Cloudflare Tunnel URL"

    $regex = "https://[a-zA-Z0-9-]+\.trycloudflare\.com"
    $start = Get-Date

    while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSec) {
        foreach ($file in $LogFiles) {
            if (Test-Path $file) {
                $content = Get-Content $file -Raw -ErrorAction SilentlyContinue

                if ([string]::IsNullOrWhiteSpace($content)) {
                    continue
                }

                $match = [regex]::Match($content, $regex)

                if ($match.Success) {
                    $url = $match.Value
                    Write-Host "[OK] Tunnel URL: $url"
                    return $url
                }
            }
        }

        Start-Sleep -Seconds 1
    }

    foreach ($file in $LogFiles) {
        if (Test-Path $file) {
            Write-Host "---- $file ----"
            Get-Content $file -Tail 30 -ErrorAction SilentlyContinue
        }
    }

    throw "Timeout waiting for Cloudflare Tunnel URL"
}

function Stop-All {
    param (
        [array]$Items
    )

    Write-Host ""
    Write-Host "[STOP] Stopping all services..."

    foreach ($item in $Items) {
        try {
            if ($item -and $item.Process -and !$item.Process.HasExited) {
                Write-Host "Stopping $($item.Name)"
                Stop-Process -Id $item.Process.Id -Force
            }
        } catch {
            Write-Host "Failed to stop $($item.Name): $_"
        }
    }

    Write-Host "[OK] All stopped."
}

if (!(Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    throw "cloudflared not found. Install it with: winget install --id Cloudflare.cloudflared"
}

$started = @()

try {
    Write-Host "=========================================="
    Write-Host " Research_agent Remote Test Launcher"
    Write-Host "=========================================="
    Write-Host ""

    $backend = Start-LoggedProcess `
        -Name "backend" `
        -FilePath "python" `
        -Arguments @("-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "$BackendPort") `
        -WorkingDirectory $BackendDir

    $started += $backend

    Wait-ForLocalService -Url "http://localhost:$BackendPort/config" -TimeoutSec 60

    $backendTunnel = Start-LoggedProcess `
        -Name "backend_tunnel" `
        -FilePath "cloudflared" `
        -Arguments @("tunnel", "--url", "http://localhost:$BackendPort") `
        -WorkingDirectory $RootDir

    $started += $backendTunnel

    $backendUrl = Wait-ForTunnelUrl -LogFiles @($backendTunnel.Stdout, $backendTunnel.Stderr) -TimeoutSec 90

    Write-Host ""
    Write-Host "[BUILD] Frontend"
    Write-Host "Backend URL: $backendUrl"

    Push-Location $FrontendDir
    $env:NEXT_PUBLIC_API_BASE = $backendUrl
    npm run build
    Pop-Location

    $frontendCommand = "`$env:NEXT_PUBLIC_API_BASE='$backendUrl'; npx next start -H 0.0.0.0 -p $FrontendPort"

    $frontend = Start-LoggedProcess `
        -Name "frontend" `
        -FilePath "powershell" `
        -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $frontendCommand) `
        -WorkingDirectory $FrontendDir

    $started += $frontend

    Wait-ForLocalService -Url "http://localhost:$FrontendPort" -TimeoutSec 60

    $frontendTunnel = Start-LoggedProcess `
        -Name "frontend_tunnel" `
        -FilePath "cloudflared" `
        -Arguments @("tunnel", "--url", "http://localhost:$FrontendPort") `
        -WorkingDirectory $RootDir

    $started += $frontendTunnel

    $frontendUrl = Wait-ForTunnelUrl -LogFiles @($frontendTunnel.Stdout, $frontendTunnel.Stderr) -TimeoutSec 90

    Write-Host ""
    Write-Host "=========================================="
    Write-Host "[READY] Remote Website Ready"
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "Backend URL:"
    Write-Host $backendUrl
    Write-Host ""
    Write-Host "Frontend URL for participants:"
    Write-Host $frontendUrl
    Write-Host ""
    Write-Host "Give this URL to participants:"
    Write-Host $frontendUrl
    Write-Host ""
    Write-Host "Logs:"
    Write-Host $LogDir
    Write-Host ""
    Write-Host "Keep this window open."
    Write-Host "Press ENTER here to stop all services."

    Read-Host
}
catch {
    Write-Host ""
    Write-Host "[ERROR]"
    Write-Host $_
    Write-Host ""
    Write-Host "Check logs in:"
    Write-Host $LogDir
}
finally {
    Stop-All -Items $started
}