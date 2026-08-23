$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$backendDir = Join-Path $projectRoot "backend"
$mainPy = Join-Path $scriptDir "main.py"

# 1. Start Node Server if not already running on port 10000
$serverRunning = $false
try {
    $r = Invoke-RestMethod -Uri "http://localhost:10000/health" -Method Get -TimeoutSec 1 -ErrorAction SilentlyContinue
    if ($r.status -eq "ok") { $serverRunning = $true }
} catch {}

if (-not $serverRunning) {
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $backendDir -WindowStyle Hidden
    Start-Sleep -Milliseconds 1200
}

# 2. Start Desktop Voice & Action Agent with pythonw (silent, no console window)
$pythonwPath = "C:\Python314\pythonw.exe"
if (-not (Test-Path $pythonwPath)) {
    $pythonwPath = "pythonw.exe"
}

Start-Process -FilePath $pythonwPath -ArgumentList "`"$mainPy`"" -WorkingDirectory $projectRoot -WindowStyle Hidden
