@echo off
echo [DEV] Iniciando ambiente de desenvolvimento...

echo [DEV] Matando processos antigos...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do (
    echo [OCR] Matando processo %%a na porta 3001
    taskkill /F /PID %%a >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do (
    echo [VITE] Matando processo %%a na porta 3000
    taskkill /F /PID %%a >nul 2>&1
)

echo [DEV] Aguardando liberacao das portas...
timeout /t 2 >nul

echo [OCR] Iniciando servidor OCR na porta 3001...
cd conversor\bank_pdf_extract
start "OCR Server" cmd /c "set ""PYTHONIOENCODING=utf-8"" && set ""PYTHONUTF8=1"" && .venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 3001 --reload"

echo [DEV] Aguardando OCR inicializar...
timeout /t 5 >nul

cd ..\..
echo [VITE] Iniciando Vite na porta 3000...
start "Vite Server" cmd /c "npm run dev"

echo [DEV] Ambiente iniciado!
echo [DEV] Vite: http://localhost:3000
echo [DEV] OCR:  http://localhost:3001
echo.
echo Pressione qualquer tecla para encerrar ambos os servicos...
pause >nul

echo [DEV] Encerrando servicos...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do taskkill /F /PID %%a >nul 2>&1

echo [DEV] Servicos encerrados.
