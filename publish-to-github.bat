@echo off
setlocal enabledelayedexpansion
title Sole What POS - Publish Release to GitHub

echo ====================================================================
echo          SOLE WHAT POS - GITHUB RELEASE ^& AUTO-UPDATE UPLOADER
echo ====================================================================
echo.
echo Is script ke zariye aap naya version GitHub per upload kar sakte hain.
echo Upload hone ke baad:
echo   1. Desktop Clients (EXE): Automatically detect kar ke auto-update kar lenge.
echo   2. Mobile Clients: POS host se connect hone par auto-refresh ho jayenge.
echo.

cd /d "%~dp0"

node scripts/publish-release.js

echo.
echo ====================================================================
echo Done! Check releases: https://github.com/bhaijew/sole/releases
echo ====================================================================
pause
