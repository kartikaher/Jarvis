@echo off
echo Starting JARVIS AI...
cd /d "%~dp0"
start "" http://localhost:8000
node server.js
pause
