# ==============================================================================
# EconQuest — Sovereign Council Orchestrator
# Turnkey Windows 10/11 Self-Host Launcher (PowerShell / WSL2 / NVIDIA GPU / CPU)
# ==============================================================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

$QuickModel = if ($env:OLLAMA_QUICK_MODEL) { $env:OLLAMA_QUICK_MODEL } else { "qwen2.5:7b" }
$DeepModel  = if ($env:OLLAMA_DEEP_MODEL)  { $env:OLLAMA_DEEP_MODEL }  else { "qwen2.5:32b" }
$Port       = if ($env:PORT)               { $env:PORT }               else { "3737" }

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "  EconQuest — Sovereign Council Orchestrator (Windows Self-Host Launcher)" -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "  Phase 1-2 Sub-Agents Model : $QuickModel"
Write-Host "  Phase 3 Supreme Council    : $DeepModel"
Write-Host "==============================================================================" -ForegroundColor Cyan

# 1. Verify Docker Desktop is running
try {
    docker info | Out-Null
} catch {
    Write-Host "[ERROR] Docker Desktop is not running. Please start Docker Desktop for Windows (WSL2 backend) and try again." -ForegroundColor Red
    exit 1
}

# 2. Check if Native Windows Ollama is running on localhost:11434
$HostOllamaActive = $false
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -eq 200) {
        $HostOllamaActive = $true
    }
} catch {
    $HostOllamaActive = $false
}

# The app runs as an ordinary user (uid 1000), not root. Data saved by an older version that ran as
# root is handed to that user once, so the app can keep writing it.
Write-Host "[INFO] Building the app image and checking the data folder owner..." -ForegroundColor Yellow
docker compose build econquest
docker compose run --rm --no-deps --user root --entrypoint chown econquest -R 1000:1000 /app/data *> $null

if ($HostOllamaActive) {
    Write-Host "[OK] Detected native Windows Ollama on http://localhost:11434." -ForegroundColor Green
    $env:OLLAMA_BASE_URL = "http://host.docker.internal:11434"
    if (Get-Command ollama -ErrorAction SilentlyContinue) {
        Write-Host "[INFO] Ensuring local models ($QuickModel & $DeepModel) are pulled..." -ForegroundColor Yellow
        ollama pull $QuickModel
        ollama pull $DeepModel
    }
    Write-Host "[INFO] Starting EconQuest container connected to Windows Host Ollama..." -ForegroundColor Cyan
    docker compose up -d --build
} else {
    # Check if NVIDIA GPU is available for bundled container passthrough
    $HasNvidiaGpu = $false
    if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
        $HasNvidiaGpu = $true
    }

    if ($HasNvidiaGpu) {
        Write-Host "[INFO] Native Ollama not running; NVIDIA GPU detected. Launching bundled-ollama-gpu profile..." -ForegroundColor Green
        $env:OLLAMA_BASE_URL = "http://ollama-gpu:11434"
        docker compose --profile bundled-ollama-gpu up -d --build
    } else {
        Write-Host "[INFO] Launching EconQuest with bundled-ollama container profile..." -ForegroundColor Yellow
        $env:OLLAMA_BASE_URL = "http://ollama:11434"
        docker compose --profile bundled-ollama up -d --build
    }
}

Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "  EconQuest is live at : http://localhost:$Port" -ForegroundColor Green
Write-Host "  Ollama Endpoint      : $($env:OLLAMA_BASE_URL)" -ForegroundColor Green
Write-Host "==============================================================================" -ForegroundColor Green

Start-Process "http://localhost:$Port"
