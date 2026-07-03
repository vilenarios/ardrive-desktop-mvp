@echo off
echo 🚀 ArDrive Desktop - Quick Test Build
echo.

echo 📦 Building for Windows...
echo.

echo 🧹 Cleaning previous builds...
call npm run clean 2>nul

echo.
echo 📥 Installing dependencies...
call npm install

echo.
echo 🔨 Building application...
call npm run build

echo.
echo 📦 Creating installer packages...
call npm run dist

echo.
echo ✅ Build complete!
echo.

if exist release (
    echo 📁 Distribution files created:
    dir /b release\*.exe release\*.zip 2>nul
    echo.
    echo 📍 Location: %cd%\release
    echo.
    echo 🚀 Share these files with your testers!
) else (
    echo ⚠️  Release directory not found
)

pause