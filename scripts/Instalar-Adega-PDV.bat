@echo off
REM ==================================================================
REM  Instalador do atalho "Adega PDV" (modo offline)
REM  - Cria o atalho na Area de Trabalho, abrindo o sistema em modo app
REM    (sem barra do navegador), no Chrome ou no Edge.
REM  - Abre o sistema uma vez: COM INTERNET, para o computador guardar o
REM    sistema e a lista de produtos (depois funciona sem internet).
REM  Nao precisa de administrador. Nao instala nada alem do atalho.
REM ==================================================================
setlocal
set "URL=https://adegaapi-production-4fcb.up.railway.app/"
set "NAV="

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "NAV=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "NAV=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "NAV=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if not defined NAV (
  echo.
  echo  Nao encontrei o Chrome nem o Edge neste computador.
  echo  Instale o Google Chrome e rode este instalador de novo.
  echo.
  pause
  exit /b 1
)

echo.
echo  Navegador encontrado: %NAV%
echo  Criando o atalho "Adega PDV" na Area de Trabalho...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$desk=[Environment]::GetFolderPath('Desktop');" ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk 'Adega PDV.lnk'));" ^
  "$s.TargetPath=$env:NAV;" ^
  "$s.Arguments='--app=' + $env:URL + ' --start-maximized';" ^
  "$s.IconLocation=$env:NAV + ',0';" ^
  "$s.Description='Caixa da Adega Dois Irmaos (funciona sem internet)';" ^
  "$s.Save()"

if errorlevel 1 (
  echo.
  echo  Nao consegui criar o atalho. Tire uma foto desta tela e mande pro suporte.
  pause
  exit /b 1
)

echo  Atalho criado.
echo.
echo  Abrindo o sistema agora (precisa estar COM INTERNET nesta primeira vez).
echo  Faca login e deixe a tela do caixa aberta por 1 minuto: e o tempo de
echo  o computador guardar o sistema e a lista de produtos.
echo.
start "" "%NAV%" --app=%URL% --start-maximized
echo  Pronto. Daqui pra frente use o atalho "Adega PDV" da Area de Trabalho.
echo.
pause
endlocal
