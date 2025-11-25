param(
  [string]$EnvName = "LilyGo_TLora_V2_1_1_6_companion_radio_usb",
  [switch]$Upload,
  [switch]$Monitor,
  [switch]$Verbose
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvActivate = Join-Path $scriptRoot "..\..\.venv\Scripts\Activate.ps1"

if (Test-Path $venvActivate) {
  Write-Host "Activating virtual environment: $venvActivate"
  & $venvActivate
}
else {
  Write-Host ".venv Activate script not found at $venvActivate. Continuing without venv activation." -ForegroundColor Yellow
}

$pioExe = "pio"
if ($Verbose) { $vopt = "-v" } else { $vopt = "" }

# Ensure we run PlatformIO from the project root (one level up from tools)
# tools is expected to live in the project (e.g. <repo>/HikeSafe_LoRa_Code/tools)
$projectRoot = Resolve-Path (Join-Path $scriptRoot "..")
Write-Host "Changing directory to project root: $projectRoot"

Push-Location $projectRoot
try {

  if ($Upload) {
    Write-Host "Running: pio run -e $EnvName $vopt -t upload"
    & $pioExe run -e $EnvName $vopt -t upload
    exit $LASTEXITCODE
  }

  if ($Monitor) {
    # Default COM port and baud — change as needed when invoking the script
    $port = $env:SERIAL_PORT
    if (-not $port) { $port = 'COM6' }
    Write-Host "Opening device monitor on $port (115200)"
    & $pioExe device monitor -p $port -b 115200
    exit $LASTEXITCODE
  }

  Write-Host "Running: pio run -e $EnvName $vopt"
  & $pioExe run -e $EnvName $vopt
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
