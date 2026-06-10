# Research Agent Fix Patch: Condition A Progress, VAD, CSV Encoding

This patch fixes four issues:

1. Text Condition A no longer loses progress when old context is forgotten.
   - Old messages are marked as hidden in frontend state instead of being deleted.
   - Hidden messages are not sent back to the AI and are not shown to the participant.
   - Hidden messages still count toward phase progress and are preserved after refresh.

2. Voice Condition A no longer auto-submits before the participant starts speaking.
   - Initial silence is ignored until actual speech is detected.
   - Auto VAD has a minimum recording duration and a minimum silence timeout.

3. `vad_silence_hint` is logged only once per recording.

4. CSV files are written with `utf-8-sig` for better Chinese display in Windows/Excel/PowerShell.
   - Affected files in this patch: `interaction_events.csv`, `reset_logs.csv`, `experiment_logs.csv`, `phase_logs.csv`.

Extra hardening:

5. Participant state saving now uses per-participant locks, unique temp files, and retrying `os.replace` to reduce Windows `PermissionError` during frequent state saves.

After applying this patch, delete old CSV files if they were already created without BOM and still display garbled Chinese:

```powershell
Remove-Item backend\database\interaction_events.csv -Force -ErrorAction SilentlyContinue
Remove-Item backend\database\reset_logs.csv -Force -ErrorAction SilentlyContinue
Remove-Item backend\database\phase_logs.csv -Force -ErrorAction SilentlyContinue
Remove-Item backend\database\experiment_logs.csv -Force -ErrorAction SilentlyContinue
```

Or read existing files with explicit UTF-8:

```powershell
Get-Content backend\database\interaction_events.csv -Encoding UTF8
```
