<#
Windows-only launcher for Research_agent public experiment.
Starts local FastAPI backend, exposes it through Cloudflare Quick Tunnel,
updates Vercel production NEXT_PUBLIC_API_BASE, redeploys frontend, and keeps
backend + tunnel alive until you press ENTER.
#>

param(
  [int]$BackendPort = 8000,
  [string]$HostAddress = "127.0.0.1",
  [string]$VercelEnvName = "NEXT_PUBLIC_API_BASE",
  [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"

function Resolve-ProjectRoot {
  $scriptDir = Split-Path -Parent $MyInvocation.ScriptName
  return (Resolve-Path (Join-Path $scriptDir "..")).Path
}

$ProjectRoot = Resolve-ProjectRoot
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"
$LogDir = Join-Path $ProjectRoot ".remote_logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$PythonExe = (Get-Command python).Source
$BackendUrl = "http://${HostAddress}:$BackendPort"
$ConfigUrl = "$BackendUrl/config"
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$StartedProcesses = @()

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host "==== $Title ====" -ForegroundColor Cyan
}

function Start-LoggedProcess {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$FilePath,
    [Parameter(Mandatory=$true)][string[]]$Arguments,
    [Parameter(Mandatory=$true)][string]$WorkingDirectory
  )
  $stdout = Join-Path $LogDir "$Name.$Stamp.out.log"
  $stderr = Join-Path $LogDir "$Name.$Stamp.err.log"
  Write-Host "[START] $Name" -ForegroundColor Green
  Write-Host "        $FilePath $($Arguments -join ' ')"
  Write-Host "        cwd: $WorkingDirectory"
  $p = Start-Process -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru `
    -WindowStyle Hidden
  $script:StartedProcesses += [pscustomobject]@{ Name=$Name; Process=$p; Stdout=$stdout; Stderr=$stderr }
  return $p
}

function Stop-StartedProcesses {
  Write-Host ""
  Write-Host "[STOP] Stopping services started by this script..." -ForegroundColor Yellow
  foreach ($entry in [array]::Reverse($script:StartedProcesses)) {
    try {
      $p = $entry.Process
      if ($null -ne $p -and -not $p.HasExited) {
        Write-Host "Stopping $($entry.Name) pid=$($p.Id)"
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
  Write-Host "[OK] Stopped."
}

function Wait-ForLocalService {
  param([string]$Url, [int]$TimeoutSec = 45)
  Write-Host "[WAIT] Local service: $Url"
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 | Out-Null
      Write-Host "[OK] Local service ready: $Url" -ForegroundColor Green
      return
    } catch {
      Start-Sleep -Milliseconds 800
    }
  }
  throw "Local service not ready after $TimeoutSec seconds: $Url"
}

function Wait-ForTunnelUrl {
  param([object]$TunnelEntry, [int]$TimeoutSec = 60)
  Write-Host "[WAIT] Cloudflare Quick Tunnel URL"
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $pattern = 'https://[-a-zA-Z0-9]+\.trycloudflare\.com'
  while ((Get-Date) -lt $deadline) {
    foreach ($path in @($TunnelEntry.Stdout, $TunnelEntry.Stderr)) {
      if (Test-Path $path) {
        $text = Get-Content $path -Raw -ErrorAction SilentlyContinue
        if ([string]::IsNullOrWhiteSpace($text)) {
          continue
        }
        $m = [regex]::Match([string]$text, $pattern)
        if ($m.Success) {
          Write-Host "[OK] Tunnel URL: $($m.Value)" -ForegroundColor Green
          return $m.Value
        }
      }
    }
    Start-Sleep -Milliseconds 800
  }
  Write-Host "--- cloudflared stdout ---"
  if (Test-Path $TunnelEntry.Stdout) { Get-Content $TunnelEntry.Stdout -Tail 80 }
  Write-Host "--- cloudflared stderr ---"
  if (Test-Path $TunnelEntry.Stderr) { Get-Content $TunnelEntry.Stderr -Tail 80 }
  throw "Could not detect trycloudflare URL."
}

function Invoke-CmdCommand {
  param(
    [Parameter(Mandatory=$true)][string]$Command,
    [Parameter(Mandatory=$true)][string]$WorkingDirectory,
    [Parameter(Mandatory=$true)][string]$Name,
    [string[]]$SuccessPatterns = @(),
    [switch]$AllowFailureIfSuccessPatternMatches
  )
  $out = Join-Path $LogDir "$Name.$Stamp.out.log"
  $err = Join-Path $LogDir "$Name.$Stamp.err.log"
  Write-Host "[RUN] $Command"
  Write-Host "      cwd: $WorkingDirectory"
  $p = Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/d", "/c", $Command) `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $out `
    -RedirectStandardError $err `
    -PassThru `
    -WindowStyle Hidden
  $p.WaitForExit()

  $combined = ""
  if (Test-Path $out) { $combined += (Get-Content $out -Raw -ErrorAction SilentlyContinue) }
  if (Test-Path $err) { $combined += "`n" + (Get-Content $err -Raw -ErrorAction SilentlyContinue) }

  $matched = $false
  foreach ($pat in $SuccessPatterns) {
    if ($combined -match $pat) { $matched = $true; break }
  }

  if ($p.ExitCode -ne 0) {
    if ($AllowFailureIfSuccessPatternMatches -and $matched) {
      Write-Host "[WARN] Command returned exit code $($p.ExitCode), but success text was detected. Continuing." -ForegroundColor Yellow
      return @{ ExitCode=$p.ExitCode; Stdout=$out; Stderr=$err; Output=$combined }
    }
    Write-Host "---- stdout: $out ----" -ForegroundColor DarkGray
    if (Test-Path $out) { Get-Content $out -Tail 80 }
    Write-Host "---- stderr: $err ----" -ForegroundColor DarkGray
    if (Test-Path $err) { Get-Content $err -Tail 80 }
    throw "Command failed with exit code $($p.ExitCode): $Command"
  }
  return @{ ExitCode=$p.ExitCode; Stdout=$out; Stderr=$err; Output=$combined }
}


function Update-VercelApiBase {
  param([string]$ApiBase)
  Write-Section "Update Vercel $VercelEnvName"
  Write-Host "Removing existing production env if it exists..."
  Invoke-CmdCommand `
    -Command "vercel env rm $VercelEnvName production --yes" `
    -WorkingDirectory $FrontendDir `
    -Name "vercel_env_rm" `
    -SuccessPatterns @("Removed", "Environment Variable", "not found", "does not exist") `
    -AllowFailureIfSuccessPatternMatches | Out-Null

  $cleanApiBase = ([string]$ApiBase).Trim().TrimEnd("/")
  $cleanApiBase = $cleanApiBase -replace "^([char]0xFEFF)", ""
  if (-not ($cleanApiBase -match "^https://")) {
    throw "Invalid API base. Expected it to start with https:// but got: $cleanApiBase"
  }
  Write-Host "Adding production env $VercelEnvName=$cleanApiBase"
  # Avoid PowerShell UTF-8 BOM issues by not writing the env value through a file.
  # cmd.exe echo outputs plain text and Vercel CLI reads it from stdin.
  Invoke-CmdCommand `
    -Command "echo $cleanApiBase| vercel env add $VercelEnvName production" `
    -WorkingDirectory $FrontendDir `
    -Name "vercel_env_add" `
    -SuccessPatterns @("Added Environment Variable", "Added", "Saving") `
    -AllowFailureIfSuccessPatternMatches | Out-Null
}

function Deploy-VercelProduction {
  Write-Section "Deploy Vercel production"
  if ($SkipDeploy) {
    Write-Host "[SKIP] Deployment skipped by -SkipDeploy."
    return $null
  }
  $result = Invoke-CmdCommand `
    -Command "vercel --prod --yes" `
    -WorkingDirectory $FrontendDir `
    -Name "vercel_deploy" `
    -SuccessPatterns @("Production", "https://", "Queued", "Inspect") `
    -AllowFailureIfSuccessPatternMatches
  $m = [regex]::Matches($result.Output, 'https://[^\s]+') | Select-Object -Last 1
  if ($m) { return $m.Value }
  return $null
}

try {
  Write-Host "==========================================" -ForegroundColor Cyan
  Write-Host " Research_agent Vercel + Quick Tunnel" -ForegroundColor Cyan
  Write-Host "==========================================" -ForegroundColor Cyan
  Write-Host "Project root: $ProjectRoot"
  Write-Host "Backend dir:  $BackendDir"
  Write-Host "Frontend dir: $FrontendDir"
  Write-Host "Python:       $PythonExe"
  Write-Host "Backend URL:  $BackendUrl"
  Write-Host "Logs:         $LogDir"

  Write-Section "Start local backend"
  Start-LoggedProcess -Name "backend" -FilePath $PythonExe -Arguments @("-m", "uvicorn", "main:app", "--host", $HostAddress, "--port", "$BackendPort") -WorkingDirectory $BackendDir | Out-Null
  Wait-ForLocalService -Url $ConfigUrl -TimeoutSec 45

  Write-Section "Start Cloudflare Quick Tunnel for backend"
  $tunnelProc = Start-LoggedProcess -Name "backend_tunnel" -FilePath "cloudflared" -Arguments @("tunnel", "--url", $BackendUrl) -WorkingDirectory $ProjectRoot
  $tunnelEntry = $script:StartedProcesses | Where-Object { $_.Name -eq "backend_tunnel" } | Select-Object -Last 1
  $TunnelUrl = Wait-ForTunnelUrl -TunnelEntry $tunnelEntry -TimeoutSec 60

  Update-VercelApiBase -ApiBase $TunnelUrl
  $DeployUrl = Deploy-VercelProduction

  Write-Host ""
  Write-Host "[READY] Public experiment is ready" -ForegroundColor Green
  Write-Host "Temporary public backend URL:"
  Write-Host "  $TunnelUrl" -ForegroundColor Yellow
  if ($DeployUrl) {
    Write-Host "Vercel deployment URL:"
    Write-Host "  $DeployUrl" -ForegroundColor Yellow
  } else {
    Write-Host "Open your fixed Vercel frontend URL."
  }
  Write-Host ""
  Write-Host "Keep this window open during the experiment. Press ENTER to stop backend + tunnel."
  [void][System.Console]::ReadLine()
}
catch {
  Write-Host ""
  Write-Host "[ERROR]" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "Check logs in: $LogDir" -ForegroundColor Yellow
}
finally {
  Stop-StartedProcesses
}
