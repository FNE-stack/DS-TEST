@echo off
cd /d "%~dp0"
git add launchpad.js
git diff --cached --quiet && (echo No changes to commit. && exit /b 1)
git commit -m "release"
git push
echo.
echo Live at: https://fne-stack.github.io/DS-TEST/launchpad.js
