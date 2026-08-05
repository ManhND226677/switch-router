<#
.SYNOPSIS
    Switch-Router system tray launcher (Windows only).

.DESCRIPTION
    Puts a Switch-Router icon in the notification area and manages the local
    gateway through the repository's own `npm start` (custom-server.js), so the
    runtime, host and port stay exactly what they already are.

    Tray menu: open dashboard, copy base URL, start / stop / restart the server,
    open the logs folder, toggle per-user auto-start, exit.

    This launcher never edits .env / .env.local, never registers a Windows
    service or Scheduled Task, and never changes HOSTNAME/PORT or any endpoint.
    Stop/restart only target node processes belonging to THIS checkout.

.PARAMETER NoStart
    Show the tray icon without starting the server (attach to whatever is running).

.PARAMETER SelfTest
    Run a non-interactive check of runtime detection + icon loading, print the
    result and exit. No tray icon, no process is started or stopped.

.EXAMPLE
    npm run tray

.EXAMPLE
    npm run tray:hidden
#>
[CmdletBinding()]
param(
    [switch]$NoStart,
    [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'The Switch-Router tray launcher only runs on Windows.'
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot 'lib\router-runtime.ps1')
$runtime = Initialize-RouterRuntime -RepoRoot $repoRoot

if ($SelfTest) {
    $status = Get-RouterStatus
    $icon = Resolve-RouterIcon
    [pscustomobject]@{
        RepoRoot        = $runtime.RepoRoot
        BaseUrl         = $runtime.BaseUrl
        Dashboard       = $runtime.DashboardUrl
        State           = $status.State
        Healthy         = $status.Healthy
        ListenerPid     = $status.ListenerPid
        OwnedPids       = ($status.OwnedPids -join ',')
        BuildPresent    = Test-RouterBuildPresent
        IconLoaded      = ($icon -is [System.Drawing.Icon])
        AutostartActive = Test-RouterAutostartEnabled
    } | Format-List
    if ($icon -is [System.Drawing.Icon]) { $icon.Dispose() }
    return
}

function Show-Balloon {
    param(
        [string]$Title = 'Switch-Router',
        [Parameter(Mandatory = $true)][string]$Text,
        [ValidateSet('Info', 'Warning', 'Error')][string]$Level = 'Info'
    )
    if (-not $script:TrayIcon) { return }
    $script:TrayIcon.BalloonTipTitle = $Title
    $script:TrayIcon.BalloonTipText = $Text
    $script:TrayIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::$Level
    $script:TrayIcon.ShowBalloonTip(2500)
}

$script:TrayIcon = New-Object System.Windows.Forms.NotifyIcon
$script:TrayIcon.Icon = Resolve-RouterIcon
$script:TrayIcon.Text = 'Switch-Router'
$script:TrayIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$statusItem = $menu.Items.Add('Checking status...')
$statusItem.Enabled = $false
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$openItem = $menu.Items.Add('Open dashboard')
$openItem.add_Click({ Start-Process $runtime.DashboardUrl })

$copyItem = $menu.Items.Add('Copy base URL')
$copyItem.add_Click({
    Set-Clipboard -Value $runtime.BaseUrl
    Show-Balloon -Text ("Copied " + $runtime.BaseUrl)
})

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$startItem = $menu.Items.Add('Start server')
$startItem.add_Click({
    $result = Start-Router
    switch ($result.Reason) {
        'started'         { Show-Balloon -Text ("Starting Switch-Router on " + $runtime.BaseUrl) }
        'already-running' { Show-Balloon -Text 'Server is already running.' }
        'build-missing'   { Show-Balloon -Text 'Standalone build not found. Run `npm run build` first.' -Level Warning }
    }
})

$stopItem = $menu.Items.Add('Stop server')
$stopItem.add_Click({
    $result = Stop-Router
    if ($result.StoppedPids.Count) {
        Show-Balloon -Text ("Stopped PID " + ($result.StoppedPids -join ', '))
    } elseif ($result.ForeignListener) {
        Show-Balloon -Text ("Port " + $runtime.Port + " is held by PID " + $result.ForeignListener + ", which is not this checkout. Left untouched.") -Level Warning
    } else {
        Show-Balloon -Text 'No Switch-Router process from this folder is running.' -Level Warning
    }
})

$restartItem = $menu.Items.Add('Restart server')
$restartItem.add_Click({
    $result = Restart-Router
    if ($result.Started) { Show-Balloon -Text 'Switch-Router restarting...' }
    else { Show-Balloon -Text ("Restart skipped: " + $result.Reason) -Level Warning }
})

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$logsItem = $menu.Items.Add('Open logs folder')
$logsItem.add_Click({
    New-Item -ItemType Directory -Path $runtime.LogDir -Force | Out-Null
    Start-Process explorer.exe $runtime.LogDir
})

$autostartItem = $menu.Items.Add('Start with Windows')
$autostartItem.add_Click({
    $enabled = Set-RouterAutostart -Enabled (-not (Test-RouterAutostartEnabled))
    if ($enabled) { Show-Balloon -Text 'Auto-start enabled for the current Windows user.' }
    else { Show-Balloon -Text 'Auto-start disabled.' }
})

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$hideItem = $menu.Items.Add('Exit tray (keep server running)')
$hideItem.add_Click({
    $script:TrayIcon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

$quitItem = $menu.Items.Add('Quit server and tray')
$quitItem.add_Click({
    Stop-Router | Out-Null
    $script:TrayIcon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

$script:TrayIcon.ContextMenuStrip = $menu
$script:TrayIcon.add_DoubleClick({ Start-Process $runtime.DashboardUrl })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 4000
$timer.add_Tick({
    $status = Get-RouterStatus
    $statusItem.Text = "Status: " + $status.State + "  (" + $runtime.BaseUrl + ")"
    $script:TrayIcon.Text = "Switch-Router - " + $status.State
    $startItem.Enabled = -not $status.Running
    $stopItem.Enabled = $status.Running
    $restartItem.Enabled = $status.Running
    $autostartItem.Checked = Test-RouterAutostartEnabled
})
$timer.Start()

if (-not $NoStart) {
    $initial = Start-Router
    if ($initial.Started) { Show-Balloon -Text ("Starting Switch-Router on " + $runtime.BaseUrl) }
    elseif ($initial.Reason -eq 'build-missing') { Show-Balloon -Text 'Standalone build not found. Run `npm run build` first.' -Level Warning }
}

try {
    [System.Windows.Forms.Application]::Run()
} finally {
    $timer.Stop()
    $timer.Dispose()
    $script:TrayIcon.Visible = $false
    $script:TrayIcon.Dispose()
}
