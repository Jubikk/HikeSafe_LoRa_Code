<#
Copies the project's variant-level `pins_arduino.h` shim into the
local PlatformIO framework package variants folder so the Arduino core
can find it during framework/core compilation.

Usage (PowerShell, from repo root):
  .\scripts\install_variant_shim.ps1

This script is safe to run multiple times; it will overwrite the target
file if present. If the destination variant folder doesn't exist, it
prints an error with the expected path.
#>

Set-StrictMode -Version Latest

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $scriptRoot '..\variants\ttgo-lora32-v2\pins_arduino.h'
$destDir = Join-Path $env:USERPROFILE '.platformio\packages\framework-arduinoespressif32\variants\ttgo-lora32-v2'
$dest = Join-Path $destDir 'pins_arduino.h'

if (-not (Test-Path $source)) {
  Write-Error "Source shim not found: $source"
  exit 2
}

try {
  if (-not (Test-Path $destDir)) {
    Write-Host "Destination variant directory not found, creating: $destDir"
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  }

  Copy-Item -Path $source -Destination $dest -Force
  Write-Host "Copied variant shim to: $dest"
  exit 0
}
catch {
  Write-Error "Failed to copy shim: $($_.Exception.Message)"
  exit 4
}
