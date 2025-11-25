<#
  Build a PlatformIO example with the LilyGo environment and ensure variant shim is installed.

  Usage:
    .\scripts\build_example.ps1 -ExamplePath .\examples\companion_radio -Env lilygo-lora32-v2_1 -Verbose
#>

param(
  [string]$ExamplePath = ".\examples\companion_radio",
  [string]$Env = "lilygo-lora32-v2_1",
  [switch]$Verbose
)

try {
  $repoRoot = Resolve-Path "$PSScriptRoot\.." | Select-Object -ExpandProperty Path
}
catch {
  $repoRoot = Get-Location
}

Write-Host "Repository root: $repoRoot"

# Install variant shim if the helper exists
$installScript = Join-Path $repoRoot 'scripts\install_variant_shim.ps1'
if (Test-Path $installScript) {
  Write-Host "Running variant shim installer..."
  & $installScript
}
else {
  Write-Warning "install_variant_shim.ps1 not found at $installScript — continuing without it."
}

# Activate Python venv if available
$venvActivate = Join-Path $repoRoot '.venv\Scripts\Activate.ps1'
if (Test-Path $venvActivate) {
  Write-Host "Activating Python venv..."
  & $venvActivate
}
else {
  Write-Host "No venv activation script found at $venvActivate — continuing using system Python."
}

# Resolve example path
$projDir = Join-Path $repoRoot $ExamplePath
if (-not (Test-Path $projDir)) {
  Write-Error "Example path not found: $projDir"
  exit 1
}

# If the example folder doesn't contain a platformio.ini, build the repo root instead
$exampleIni = Join-Path $projDir 'platformio.ini'
if (Test-Path $exampleIni) {
  $projectDirToBuild = $projDir
  Write-Host "Found platformio.ini in example — building the example project: $projectDirToBuild"

  # Build command
  $pioCmd = "python -m platformio run -e $Env --project-dir `"$projectDirToBuild`""
  if ($Verbose) { $pioCmd += ' -v' }

  Write-Host "Executing: $pioCmd"
  Invoke-Expression $pioCmd

  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    Write-Error "PlatformIO build failed with exit code $exitCode"
    exit $exitCode
  }

  Write-Host "Build completed successfully for project: $projectDirToBuild (env: $Env)"

} else {
  Write-Warning "No platformio.ini in example path. Creating temporary project to build the example."

  $tempRoot = Join-Path $repoRoot ".pio_temp_builds\$([guid]::NewGuid().ToString())"
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

  Write-Host "Created temp build dir: $tempRoot"

  # Copy root platformio.ini so the same envs/flags are available
  $rootIni = Join-Path $repoRoot 'platformio.ini'
  if (Test-Path $rootIni) {
    Copy-Item -Path $rootIni -Destination (Join-Path $tempRoot 'platformio.ini') -Force
  } else {
    Write-Warning "Root platformio.ini not found; creating minimal platformio.ini with env $Env"
    $iniContent = @"
[env:$Env]
platform = espressif32
board = lilygo-t3-v1
framework = arduino
"@
    $iniContent | Out-File -Encoding utf8 (Join-Path $tempRoot 'platformio.ini')
  }

  # Copy top-level helper scripts that some PlatformIO projects reference
  foreach ($f in @('merge-bin.py','build_as_lib.py','create-uf2.py')) {
    $srcf = Join-Path $repoRoot $f
    if (Test-Path $srcf) {
      Write-Host "Copying top-level script $f to temp project..."
      Copy-Item -Path $srcf -Destination (Join-Path $tempRoot $f) -Force
    }
  }

  # Copy common folders that examples often depend on
  foreach ($d in @('include','lib','variants','boards')) {
    $src = Join-Path $repoRoot $d
    if (Test-Path $src) {
      Write-Host "Copying $d to temp project..."
      Copy-Item -Path $src -Destination (Join-Path $tempRoot $d) -Recurse -Force
    }
  }
 

  # Copy the example into src/
  $tempSrc = Join-Path $tempRoot 'src'
  New-Item -ItemType Directory -Path $tempSrc -Force | Out-Null
  Copy-Item -Path (Join-Path $projDir '*') -Destination $tempSrc -Recurse -Force

  # Copy repo 'src/helpers' and other core src files if they exist (avoid overwriting example files)
  $repoSrc = Join-Path $repoRoot 'src'
  if (Test-Path $repoSrc) {
    # copy helpers directory
    $repoHelpers = Join-Path $repoSrc 'helpers'
    if (Test-Path $repoHelpers) {
      Write-Host "Copying repo src/helpers to temp project src/helpers..."
      Copy-Item -Path $repoHelpers -Destination (Join-Path $tempSrc 'helpers') -Recurse -Force
    }

    # copy top-level src files (.h/.cpp) if they don't exist in the temp src to avoid overwriting example main
    Get-ChildItem -Path $repoSrc -File -Include *.h,*.cpp | ForEach-Object {
      $dest = Join-Path $tempSrc $_.Name
      if (-not (Test-Path $dest)) {
        Write-Host "Copying src file $($_.Name) to temp project src/..."
        Copy-Item -Path $_.FullName -Destination $dest -Force
      } else {
        Write-Host "Skipping copy of $($_.Name) because a file with the same name exists in example src"
      }
    }
  }

  # Ensure repo headers are available via temp project's include/ (angle-bracket includes)
  $tempInclude = Join-Path $tempRoot 'include'
  if (-not (Test-Path $tempInclude)) { New-Item -ItemType Directory -Path $tempInclude -Force | Out-Null }
  Get-ChildItem -Path $repoSrc -Recurse -Include *.h -File | ForEach-Object {
    $relPath = $_.FullName.Substring($repoSrc.Length).TrimStart('\')
    $destPath = Join-Path $tempInclude $relPath
    $destDir = Split-Path $destPath -Parent
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    Write-Host "Copying header $_.Name to temp include/$relPath"
    Copy-Item -Path $_.FullName -Destination $destPath -Force
  }

  # Also copy example-specific lib if present
  $exampleLib = Join-Path $projDir 'lib'
  if (Test-Path $exampleLib) {
    Copy-Item -Path $exampleLib -Destination (Join-Path $tempRoot 'lib') -Recurse -Force
  }

  # Build in the temp project
  $pioCmd = "python -m platformio run -e $Env --project-dir `"$tempRoot`""
  if ($Verbose) { $pioCmd += ' -v' }

  Write-Host "Executing: $pioCmd"
  Invoke-Expression $pioCmd

  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    Write-Error "PlatformIO build failed with exit code $exitCode (temp project: $tempRoot)"
    Write-Host "Temp project preserved at: $tempRoot for inspection"
    exit $exitCode
  }

  Write-Host "Build completed successfully for temporary project: $tempRoot (env: $Env)"

  # Clean up
  if (-not $KeepTemp) {
    Write-Host "Removing temp project: $tempRoot"
    Remove-Item -Recurse -Force $tempRoot
  } else {
    Write-Host "Preserving temp project: $tempRoot (use -KeepTemp to keep it)"
  }
}
# Completed
