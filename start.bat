@echo off
title Babylon HotSwap Studio - Blender GLB Viewer
echo ========================================================
echo    Babylon HotSwap Studio (Blender to GLB Sandbox)
echo ========================================================
echo.
echo Avvio del server locale su http://localhost:5173...
echo.
start "" "http://localhost:5173"
npm run dev
pause
