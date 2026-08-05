@echo off
REM Inicia el panel de reportes de balance (Streamlit) del Hotel Andino
cd /d "%~dp0.."
"C:\Users\hipho\AppData\Local\Programs\Python\Python312\python.exe" -m streamlit run reportes\reportes.py --server.port 8501 --server.headless true
