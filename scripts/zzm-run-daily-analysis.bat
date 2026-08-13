@echo off
REM 2026-08-14: Daily match-rules-analysis report (local cron, Windows Task Scheduler)
REM Register: schtasks /create /tn "zzmm-match-rules-analysis" /tr "C:\temp_zzmm\zzmm-search\scripts\zzm-run-daily-analysis.bat" /sc daily /st 09:00
REM Remove:   schtasks /delete /tn "zzmm-match-rules-analysis" /f
REM List:     schtasks /query /tn "zzmm-match-rules-analysis"

cd /d C:\temp_zzmm\zzmm-search

REM Output to logs/ directory
if not exist logs mkdir logs

REM Filename: match-rules-YYYY-MM-DD.txt
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set "dt=%%I"
set "today=%dt:~0,4%-%dt:~4,2%-%dt:~6,2%"

echo ============================================== > logs\match-rules-%today%.txt
echo Daily match-rules-analysis report - %dt:~0,4%-%dt:~4,2%-%dt:~6,2% %dt:~8,2%:%dt:~10,2% >> logs\match-rules-%today%.txt
echo ============================================== >> logs\match-rules-%today%.txt

node scripts\zzm-match-rules-analysis.mjs >> logs\match-rules-%today%.txt 2>&1

echo. >> logs\match-rules-%today%.txt
echo === Done === >> logs\match-rules-%today%.txt
