@echo off
echo Building ArDrive Desktop for Windows (Simple Mode)
echo.

REM Skip code signing completely
set CSC_IDENTITY_AUTO_DISCOVERY=false
set WIN_CSC_LINK=none
set ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true

echo Cleaning previous builds...
call npm run clean

echo.
echo Building application...
call npm run build

echo.
echo Creating portable executable (no installer)...
call npx electron-builder --win portable --publish never

echo.
if exist release\*.exe (
    echo ✅ Build successful!
    echo.
    echo Files created:
    dir /b release\*.exe
    echo.
    echo Location: %cd%\release
) else (
    echo ⚠️ Build may have issues. Check release folder.
)

pause