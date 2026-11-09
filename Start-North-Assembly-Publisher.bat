@echo off
setlocal
title North Assembly Publisher
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
    py -3 "%~dp0publisher\server.py"
) else (
    where python >nul 2>nul
    if not errorlevel 1 (
        python "%~dp0publisher\server.py"
    ) else (
        echo [ERROR] Python 3 no esta instalado o no aparece en PATH.
        echo Instala Python 3.10 o superior y vuelve a ejecutar este archivo.
        pause
        exit /b 1
    )
)

if errorlevel 1 (
    echo.
    echo [ERROR] North Assembly Publisher se ha cerrado con un error.
    pause
)
endlocal
