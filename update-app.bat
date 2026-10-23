@echo off
setlocal enabledelayedexpansion
title Flo POS - Fast App Updater

echo ====================================================================
echo                   FLO POS - FAST APP UPDATER
echo       (Bina Nayi Installer Setup EXE Banaye Instant Update)
echo ====================================================================
echo.

cd /d "%~dp0"

:: Close running instances to prevent file lock
taskkill /F /IM "Sole What.exe" /IM "FloDesktop.exe" >nul 2>&1

echo [1/3] Step 1: Compiling Frontend (Next.js)...
call npm run build:frontend
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Frontend build me error aaya hai. Please check code.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Step 2: Compiling Backend (TypeScript / Express)...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Backend compilation me error aaya hai.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Step 3: Updating Application Executable (win-unpacked)...
call npx electron-builder --dir
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Packaging failed.
    pause
    exit /b %ERRORLEVEL%
)

:: If installed in Program Files or LocalAppData, also patch resources
if exist "%LOCALAPPDATA%\Programs\Sole What\resources" (
    echo Updating installed version in LocalAppData...
    xcopy /Y /S /E /I "%~dp0release\win-unpacked\resources\*" "%LOCALAPPDATA%\Programs\Sole What\resources\" >nul 2>&1
)

:: Recompile native C# launcher if available
call compile-csharp.bat >nul 2>&1

:: Ensure desktop shortcuts are up to date
node scripts/create-desktop-shortcut.js >nul 2>&1
powershell -NoProfile -Command "if (Test-Path 'C:\Users\azwaj\OneDrive\Desktop') { Copy-Item 'C:\Users\azwaj\Desktop\Sole What POS.lnk' 'C:\Users\azwaj\OneDrive\Desktop\Sole What POS.lnk' -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo.
echo ====================================================================
echo [SUCCESS] App successfully update ho chuki hai!
echo.
echo Ab aapko dobara Setup EXE install karne ki bilkul zaroorat nahi!
echo Updated App aap in do tareeqon se chala sakte hain:
echo   1. Desktop par "Sole What POS" shortcut ko double click karein
echo   2. Ya "FloDesktop.exe" ko run karein
echo ====================================================================
echo.

set /p LAUNCH="Kya aap updated app abhi open karna chahte hain? (Y/N): "
if /i "%LAUNCH%"=="Y" (
    start "" "%~dp0release\win-unpacked\Sole What.exe"
)
