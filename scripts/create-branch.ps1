<#
Create and switch to feature branch locally.

Run this script from the repo root in PowerShell. It will create a branch named `lilygo-slim` and switch to it.
This script DOES NOT push to remote. Run `git push -u origin lilygo-slim` to push.
#>

param(
    [string]$BranchName = 'lilygo-slim'
)

if (-not (Test-Path .git)) {
    Write-Error "This directory does not appear to be a git repository. Run this from the repo root."
    exit 1
}

Write-Host "Creating and switching to branch: $BranchName"
git checkout -b $BranchName
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Failed to create branch. Perhaps it already exists. Attempting to switch to it."
    git checkout $BranchName
}

Write-Host "Branch now: $(git branch --show-current)"
Write-Host "To push: git push -u origin $BranchName"
