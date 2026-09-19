@echo off
REM ============================================================
REM  Sistema da Adega -- inicia o ambiente de diagnostico
REM  Duplo-clique neste arquivo (ou rode pelo terminal).
REM  Ele NAO mexe em nada da loja: so sobe o sistema localmente
REM  pra testar pistola e impressora em http://localhost:5173/diagnostico
REM ============================================================

cd /d "%~dp0.."

echo.
echo === Sistema da Adega - ambiente de diagnostico ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  echo Instale o Node.js 22 ou mais novo em https://nodejs.org/ e rode este arquivo de novo.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [AVISO] pnpm nao encontrado. Tentando instalar via corepack...
  call corepack enable
  call corepack prepare pnpm@9.15.4 --activate
  where pnpm >nul 2>nul
  if errorlevel 1 (
    echo [ERRO] Nao consegui preparar o pnpm automaticamente.
    echo Rode manualmente: npm install -g pnpm@9.15.4
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo [INFO] Nao encontrei o arquivo .env -- copiando de .env.example...
  copy ".env.example" ".env" >nul
  echo [INFO] Arquivo .env criado. Para este teste (pagina de diagnostico) os
  echo         valores de exemplo servem, nao precisa Postgres rodando.
)

if not exist "node_modules" (
  echo [INFO] Primeira vez rodando -- instalando dependencias ^(pnpm install^).
  echo         Isso precisa de internet e pode demorar alguns minutos.
  call pnpm install
  if errorlevel 1 (
    echo [ERRO] pnpm install falhou. Veja a mensagem acima.
    pause
    exit /b 1
  )
)

echo.
echo [INFO] Subindo o sistema ^(API + tela^)...
echo [INFO] Quando aparecer "api ouvindo na porta 3000" e uma linha do Vite
echo         com "Local: http://localhost:5173", abra no Chrome:
echo.
echo         http://localhost:5173/diagnostico
echo.
echo [INFO] Para PARAR: feche esta janela ou aperte Ctrl+C.
echo.

start "" cmd /c "timeout /t 8 >nul && start http://localhost:5173/diagnostico"

call pnpm dev

pause
