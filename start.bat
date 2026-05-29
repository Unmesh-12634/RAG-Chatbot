@echo off
title RAG Creator Studio Launcher
echo ===================================================
echo   🌟 RAG Creator Studio Launcher 🌟
echo ===================================================
echo.

:: 1. Launch FastAPI Backend
echo 🔌 Starting FastAPI Backend Server (Port: 8000)...
start "RAG Backend" /min cmd /c "cd backend && .venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001"

:: 2. Launch React Frontend
echo ⚡ Starting Vite React Frontend Dev Server (Port: 5173)...
start "RAG Frontend" /min cmd /c "cd frontend && npm run dev"

:: 3. Launch Web Browser
echo.
echo 🧭 Waiting for services to bind... Opening browser in 5 seconds...
timeout /t 5 >nul
start http://localhost:5173

echo ===================================================
echo   ✓ Servers launched in background minimized windows!
echo   🤖 Chat Interface URL: http://localhost:5173
echo   🔌 API swagger docs:  http://localhost:8001/docs
echo.
echo   Press any key to close this launcher shell...
echo   (Background servers will remain active. To stop them,
echo   close their respective minimized windows from the taskbar)
echo ===================================================
pause >nul
