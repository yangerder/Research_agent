param(
  [Parameter(Mandatory=$true)][string]$ApiBase,
  [string]$VercelEnvName = "NEXT_PUBLIC_API_BASE"
)
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.ScriptName
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$FrontendDir = Join-Path $ProjectRoot "frontend"
$LogDir = Join-Path $ProjectRoot ".remote_logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"

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
  $p = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/c", $Command) -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
  $p.WaitForExit()
  $combined = ""
  if (Test-Path $out) { $combined += (Get-Content $out -Raw -ErrorAction SilentlyContinue) }
  if (Test-Path $err) { $combined += "`n" + (Get-Content $err -Raw -ErrorAction SilentlyContinue) }
  $matched = $false
  foreach ($pat in $SuccessPatterns) { if ($combined -match $pat) { $matched = $true; break } }
  if ($p.ExitCode -ne 0) {
    if ($AllowFailureIfSuccessPatternMatches -and $matched) {
      Write-Host "[WARN] Command returned exit code $($p.ExitCode), but success text was detected. Continuing." -ForegroundColor Yellow
      return
    }
    if (Test-Path $out) { Get-Content $out -Tail 80 }
    if (Test-Path $err) { Get-Content $err -Tail 80 }
    throw "Command failed with exit code $($p.ExitCode): $Command"
  }
}


Write-Host "Project root: $ProjectRoot"
Write-Host "Frontend dir: $FrontendDir"
Write-Host "API base:     $ApiBase"
Invoke-CmdCommand -Command "vercel env rm $VercelEnvName production --yes" -WorkingDirectory $FrontendDir -Name "manual_env_rm" -SuccessPatterns @("Removed", "not found", "does not exist") -AllowFailureIfSuccessPatternMatches
$cleanApiBase = ([string]$ApiBase).Trim().TrimEnd("/")
$cleanApiBase = $cleanApiBase -replace "^([char]0xFEFF)", ""
if (-not ($cleanApiBase -match "^https://")) {
  throw "Invalid API base. Expected it to start with https:// but got: $cleanApiBase"
}
Invoke-CmdCommand -Command "echo $cleanApiBase| vercel env add $VercelEnvName production" -WorkingDirectory $FrontendDir -Name "manual_env_add" -SuccessPatterns @("Added Environment Variable", "Added", "Saving") -AllowFailureIfSuccessPatternMatches
Invoke-CmdCommand -Command "vercel --prod --yes" -WorkingDirectory $FrontendDir -Name "manual_deploy" -SuccessPatterns @("Production", "https://", "Queued", "Inspect") -AllowFailureIfSuccessPatternMatches
Write-Host "[OK] Vercel production updated." -ForegroundColor Green
