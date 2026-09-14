<#
.SYNOPSIS
    Installs or removes the Switch-Router auto-start entry for the CURRENT Windows user.

.DESCRIPTION
    Creates a shortcut in the per-user Startup folder that launches the tray
    launcher silently at logon. Nothing machine-wide is touched: no Windows
    service, no HKLM registry key, no Scheduled Task, no changes for other users.

    Startup folder used:
        %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Switch-Router.lnk

.PARAMETER Remove
    Delete the shortcut instead of creating it.

.PARAMETER Status
    Only report whether auto-start is currently enabled.

.EXAMPLE
    npm run tray:autostart
    npm run tray:autostart:remove
#>
[CmdletBinding()]
param(
    [switch]$Remove,
    [switch]$Status
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'Auto-start installation is Windows-only.'
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$launcher = Join-Path $repoRoot 'scripts\windows\switch-router-tray.vbs'
$iconPath = Join-Path $repoRoot 'public\icons\switch-router.ico'
$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'Switch-Router.lnk'

if ($Status) {
    if (Test-Path -LiteralPath $shortcutPath) {
        Write-Output "enabled: $shortcutPath"
    } else {
        Write-Output 'disabled'
    }
    return
}

if ($Remove) {
    if (Test-Path -LiteralPath $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
        Write-Output "Removed auto-start shortcut: $shortcutPath"
    } else {
        Write-Output 'Auto-start shortcut was not present; nothing to remove.'
    }
    return
}

if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Tray launcher not found: $launcher"
}

if (-not (Test-Path -LiteralPath $iconPath)) {
    $generator = Join-Path $repoRoot 'scripts\windows\generate-icon.mjs'
    if (Test-Path -LiteralPath $generator) { & node $generator | Out-Null }
}

New-Item -ItemType Directory -Path $startupDir -Force | Out-Null

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = "//nologo `"$launcher`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = 'Switch-Router local AI gateway (tray launcher)'
$shortcut.WindowStyle = 7
if (Test-Path -LiteralPath $iconPath) { $shortcut.IconLocation = $iconPath }
$shortcut.Save()

Write-Output "Installed auto-start shortcut: $shortcutPath"
Write-Output "Target: wscript.exe //nologo `"$launcher`""
Write-Output 'Scope: current user only (no service, no scheduled task, no HKLM change).'
