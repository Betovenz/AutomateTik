# Runs server.py and keeps it alive: checks /api/health every $CheckIntervalSec
# seconds, restarts the process if it stops responding or exits.
# Usage:  powershell -ExecutionPolicy Bypass -File watchdog.ps1

$ErrorActionPreference = "SilentlyContinue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$Port = if ($env:AUTOPOST_PORT) { $env:AUTOPOST_PORT } else { "3300" }
$HealthUrl = "http://127.0.0.1:$Port/api/health"
$CheckIntervalSec = 15
$HealthTimeoutSec = 5

$PythonExe = $null
$PythonPrefixArgs = @()
$LocalPythonCandidates = @(
    (Join-Path $ScriptDir ".venv\Scripts\python.exe"),
    (Join-Path $ScriptDir "venv\Scripts\python.exe")
)

foreach ($candidate in $LocalPythonCandidates) {
    if (Test-Path -LiteralPath $candidate) {
        $PythonExe = $candidate
        break
    }
}

if (-not $PythonExe) {
    $pythonCommand = Get-Command "python.exe" -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $PythonExe = $pythonCommand.Source
    } else {
        $pyCommand = Get-Command "py.exe" -ErrorAction SilentlyContinue
        if ($pyCommand) {
            $PythonExe = $pyCommand.Source
            $PythonPrefixArgs = @("-3")
        }
    }
}

if (-not $PythonExe) {
    throw "Python 3 was not found. Install Python or create .venv in the project folder."
}

function Start-App {
    Write-Host "[watchdog] $(Get-Date -Format 'HH:mm:ss') starting server.py with $PythonExe ..."
    $serverArgs = @($PythonPrefixArgs) + @("server.py")
    $p = Start-Process -FilePath $PythonExe -ArgumentList $serverArgs -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput "watchdog-out.log" -RedirectStandardError "watchdog-err.log"
    if (-not $p) {
        throw "Unable to start server.py"
    }
    return $p
}

function Test-Healthy {
    try {
        $resp = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec $HealthTimeoutSec -UseBasicParsing
        return $resp.StatusCode -eq 200
    } catch {
        return $false
    }
}

$proc = $null

try {
    if (Test-Healthy) {
        Write-Host "[watchdog] A healthy server is already running at $HealthUrl"
        Start-Process $HealthUrl.Replace("/api/health", "/")
        exit 0
    }

    $proc = Start-App
    Start-Sleep -Seconds 3
    Start-Process $HealthUrl.Replace("/api/health", "/")
    Write-Host "[watchdog] watching $HealthUrl every ${CheckIntervalSec}s (Ctrl+C to stop)"

    while ($true) {
        Start-Sleep -Seconds $CheckIntervalSec
        $alive = -not $proc.HasExited
        $healthy = if ($alive) { Test-Healthy } else { $false }

        if (-not $alive -or -not $healthy) {
            Write-Host "[watchdog] $(Get-Date -Format 'HH:mm:ss') unhealthy (alive=$alive healthy=$healthy) -- restarting"
            if ($alive) {
                Stop-Process -Id $proc.Id -Force
                Start-Sleep -Seconds 2
            }
            $proc = Start-App
        }
    }
} finally {
    if ($proc -and -not $proc.HasExited) {
        Write-Host "[watchdog] stopping server.py (PID $($proc.Id)) ..."
        Stop-Process -Id $proc.Id -Force
    }
}
