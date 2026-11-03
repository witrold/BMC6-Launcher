@echo off
title Publier le pack BMC6
cd /d "%~dp0"
echo ============================================
echo   Publication du pack BMC6 pour les amis
echo ============================================
echo.
echo Verification de ce qui va etre publie (rien n'est envoye)...
echo.
node tools\publish.js --dry-run
if errorlevel 1 (
  echo.
  echo Il y a eu une erreur. Rien n'a ete publie.
  pause
  exit /b 1
)
echo.
set /p OK=Publier maintenant pour tes amis ? (o/n) :
if /i not "%OK%"=="o" (
  echo Annule : rien n'a ete publie.
  pause
  exit /b 0
)
echo.
set "GH=C:\Program Files\GitHub CLI\gh.exe"
if not exist "%GH%" set "GH=gh"
"%GH%" auth status >nul 2>&1
if errorlevel 1 (
  echo GitHub n'est pas connecte dans cette session. Connexion necessaire :
  echo suis les instructions ci-dessous ^(un code a saisir sur github.com/login/device^).
  echo.
  "%GH%" auth login --hostname github.com --git-protocol https --web --skip-ssh-key
  "%GH%" auth status >nul 2>&1
  if errorlevel 1 (
    echo.
    echo La connexion a GitHub a echoue. Rien n'a ete publie.
    pause
    exit /b 1
  )
  echo.
)
node tools\publish.js
if errorlevel 1 (
  echo.
  echo La publication a echoue. Relance ce fichier pour reessayer.
  pause
  exit /b 1
)
echo.
echo Termine. Tes amis verront "Mise a jour disponible" dans leur launcher.
pause
