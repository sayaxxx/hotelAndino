@echo off
REM Inicia el panel de reportes de balance (Streamlit) del Hotel Andino
cd /d "%~dp0.."
where python >nul 2>nul
if %errorlevel%==0 (
  python -m streamlit run reportes\reportes.py --server.port 8501 --server.headless true
) else (
  py -m streamlit run reportes\reportes.py --server.port 8501 --server.headless true
)
