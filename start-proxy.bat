@echo off
echo Starting Pipecat Proxy Middleware...
cd /d "%~dp0"
node proxy-server.js
pause
