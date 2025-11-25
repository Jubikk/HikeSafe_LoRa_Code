<#
Archive unneeded directories into ./archive

Run from repository root (PowerShell):
  .\scripts\archive-unneeded.ps1

This script will move directories listed in `$toMove` into `archive/` if they exist.
#>

param(
  [switch]$WhatIf
)

$root = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent | Split-Path -Parent
$archiveDir = Join-Path $root 'archive'
if (!(Test-Path $archiveDir)) {
  New-Item -Path $archiveDir -ItemType Directory | Out-Null
}

$toMove = @(
  'arch/rp2040',
  'arch/nrf52',
  'arch/stm32',
  'device_firmware',
  'variants',
  'boards',
  'docs',
  'examples/simple_repeater',
  'examples/simple_room_server',
  'examples/simple_sensor',
  'examples/simple_secure_chat/old',
  'lib/README'
)

foreach ($rel in $toMove) {
  $src = Join-Path $root $rel
  if (Test-Path $src) {
    $dest = Join-Path $archiveDir (Split-Path $rel -Leaf)
    Write-Host "Moving: $rel -> archive/" -ForegroundColor Yellow
    if ($WhatIf) {
      Write-Host "WhatIf: would move $src -> $dest"
    }
    else {
      try {
        Move-Item -Path $src -Destination $dest -Force
      }
      catch {
        Write-Warning "Failed to move $($src): $($_)"
      }
    }
  }
  else {
    Write-Host "Not found: $rel" -ForegroundColor DarkGray
  }
}

Write-Host "Archive step completed. Please review the archive/ directory." -ForegroundColor Green
