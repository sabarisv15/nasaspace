@echo off
title ARCNAVE: make the share zip
rem ARCNAVE v0.57: makes ONE file to share, ..\ARCNAVE-v0.57.zip: the app, the portable Node and the saved data ("cache",
rem about 2.2 GB: the NASA targets, the 18 test fields and every spot opened here), so the other computer needs nothing
rem installed and opens the same places as fast as this one. The git history (.git) and work folders are left out.
rem Without the saved data (small zip, about 400 MB): make-share.bat nocache
set "SRC=%~dp0"
set "OUT=%~dp0..\ARCNAVE-SHARE-v0.57\ARCNAVE"
set "ZIP=%~dp0..\ARCNAVE-v0.57.zip"
echo Copying the app...
robocopy "%SRC%." "%OUT%" /E /XD cache node_modules .git .claude debug-cutouts archive "%SRC%deploy\out" /XF *.tmp HANDOFF-PROMPT.md /NFL /NDL /NJH /NJS /NP >nul
if exist "%SRC%..\node\node-v24.20.0-win-x64\node.exe" (
  echo Copying portable Node...
  robocopy "%SRC%..\node\node-v24.20.0-win-x64" "%OUT%\node" node.exe LICENSE /NFL /NDL /NJH /NJS /NP >nul
)
if /i not "%~1"=="nocache" (
  echo Copying the saved data ^(cache^)...
  if exist "%SRC%cache" robocopy "%SRC%cache" "%OUT%\cache" /E /NFL /NDL /NJH /NJS /NP >nul
  if defined SKYSHIFT_CACHE_DIR if exist "%SKYSHIFT_CACHE_DIR%" robocopy "%SKYSHIFT_CACHE_DIR%" "%OUT%\cache" /E /NFL /NDL /NJH /NJS /NP >nul
)
if exist "%ZIP%" del "%ZIP%"
echo Zipping (several minutes for the full zip)...
pushd "%OUT%\.."
tar -a -c -f "%ZIP%" ARCNAVE
set ERR=%errorlevel%
popd
if not "%ERR%"=="0" ( echo Zip failed. & pause & exit /b 1 )
echo.
echo Done: %ZIP%
echo Share this one file. On the other computer: Extract All, open the ARCNAVE folder, double-click start.bat
pause
