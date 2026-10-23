@echo off
cd /d "%~dp0"
set CSC="C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist %CSC% set CSC="C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"

echo =========================================================
echo Compiling FloDesktop.exe (Native C# POS Shell)
echo =========================================================
%CSC% /target:winexe /optimize+ /nowarn:0169 /platform:anycpu /win32icon:assets\icon.ico /out:FloDesktop.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.dll /r:System.Core.dll FloDesktopApp.cs

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] FloDesktop.exe compiled successfully!
    echo Output: %~dp0FloDesktop.exe
) else (
    echo.
    echo [ERROR] C# compilation failed with error code %ERRORLEVEL%.
)
