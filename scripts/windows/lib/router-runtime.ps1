<#
.SYNOPSIS
    Shared Switch-Router process/runtime helpers for the Windows tray launcher.

.DESCRIPTION
    Dot-sourced by scripts/windows/tray.ps1. Kept separate so the detection and
    start/stop logic can be exercised without opening the tray UI:

        . scripts\windows\lib\router-runtime.ps1
        Initialize-RouterRuntime -RepoRoot <path>
        Get-RouterStatus

    Nothing here writes to .env / .env.local, registers a service, or changes
    HOSTNAME/PORT - it only reads config and drives the repo's own `npm start`.
#>

Set-StrictMode -Version Latest

function Get-RouterSetting {
    <# Reads PORT/HOSTNAME the way custom-server.js resolves them: .env.local, then .env, then the default. #>
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Default
    )

    foreach ($file in @('.env.local', '.env')) {
        $path = Join-Path $script:RepoRoot $file
        if (-not (Test-Path -LiteralPath $path)) { continue }
        foreach ($line in Get-Content -LiteralPath $path -ErrorAction SilentlyContinue) {
            $trimmed = $line.Trim()
            if ($trimmed.StartsWith('#')) { continue }
            if ($trimmed -match "^$([regex]::Escape($Name))\s*=\s*(.*)$") {
                $value = $Matches[1].Trim().Trim('"').Trim("'")
                if ($value) { return $value }
            }
        }
    }

    return $Default
}

function Initialize-RouterRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot
    )

    $script:RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
    $script:LogDir = Join-Path $script:RepoRoot 'logs'
    $script:StdOutLog = Join-Path $script:LogDir 'switch-router-production.out.log'
    $script:StdErrLog = Join-Path $script:LogDir 'switch-router-production.err.log'
    $script:IconPath = Join-Path $script:RepoRoot 'public\icons\switch-router.ico'
    $script:IconGenerator = Join-Path $script:RepoRoot 'scripts\windows\generate-icon.mjs'
    $script:AutostartScript = Join-Path $script:RepoRoot 'scripts\windows\install-autostart.ps1'
    $script:StartupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Switch-Router.lnk'
    $script:ServerProcess = $null

    $script:Port = Get-RouterSetting -Name 'PORT' -Default '28701'
    # Local-first: custom-server.js always binds 127.0.0.1 regardless of HOSTNAME,
    # so the tray's displayed/opened URL must match the real bind — ignore any
    # non-loopback HOSTNAME left over from an older config.
    $script:Hostname = '127.0.0.1'
    $script:BaseUrl = "http://$($script:Hostname):$($script:Port)"
    $script:DashboardUrl = "$($script:BaseUrl)/dashboard"
    $script:HealthUrl = "$($script:BaseUrl)/api/health"

    return [pscustomobject]@{
        RepoRoot     = $script:RepoRoot
        Port         = $script:Port
        Hostname     = $script:Hostname
        BaseUrl      = $script:BaseUrl
        DashboardUrl = $script:DashboardUrl
        HealthUrl    = $script:HealthUrl
        LogDir       = $script:LogDir
        IconPath     = $script:IconPath
    }
}

function Get-RouterListeningProcessId {
    try {
        $connection = Get-NetTCPConnection -State Listen -LocalPort ([int]$script:Port) -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($connection) { return [int]$connection.OwningProcess }
    } catch { }
    return 0
}

function Test-RouterProcessOwnedByRepo {
    <#
        True only for a node process that runs THIS checkout's server. `npm start`
        spawns a bare `node custom-server.js`, so when the command line carries no
        path we additionally require that the process owns our configured port.
    #>
    param([Parameter(Mandatory = $true)]$Process)

    if (-not $Process.CommandLine) { return $false }
    if ($Process.CommandLine -notmatch '(?i)custom-server\.js|standalone.server\.js') { return $false }

    $rootPattern = [regex]::Escape($script:RepoRoot)
    if ($Process.CommandLine -match "(?i)$rootPattern") { return $true }

    $listenerPid = Get-RouterListeningProcessId
    return ($listenerPid -ne 0 -and $listenerPid -eq [int]$Process.ProcessId)
}

function Get-RouterProcesses {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { Test-RouterProcessOwnedByRepo -Process $_ }
}

function Test-RouterRunning {
    if (@(Get-RouterProcesses).Count) { return $true }
    return [bool](Get-RouterListeningProcessId)
}

function Test-RouterHealthy {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $script:HealthUrl -TimeoutSec 3
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Get-RouterStatus {
    $processes = @(Get-RouterProcesses)
    $listenerPid = Get-RouterListeningProcessId
    $running = ($processes.Count -gt 0) -or ($listenerPid -ne 0)
    $healthy = if ($running) { Test-RouterHealthy } else { $false }
    $state = if ($healthy) { 'running' } elseif ($running) { 'starting' } else { 'stopped' }

    return [pscustomobject]@{
        State       = $state
        Running     = $running
        Healthy     = $healthy
        ListenerPid = $listenerPid
        OwnedPids   = @($processes | ForEach-Object { [int]$_.ProcessId })
        BaseUrl     = $script:BaseUrl
    }
}

function Test-RouterBuildPresent {
    return (Test-Path -LiteralPath (Join-Path $script:RepoRoot '.next\standalone\server.js')) -or
           (Test-Path -LiteralPath (Join-Path $script:RepoRoot 'server.js'))
}

function Rotate-RouterLog {
    <#
        Archives the previous stdout/stderr logs before Start-Router overwrites them.

        Windows PowerShell 5.1's Start-Process has no -Append switch, so every tray
        restart truncated the logs — wiping exactly the history the heartbeat line
        exists to preserve (a gap between two heartbeats is only meaningful if the
        lines before it survive the restart). Moving the old file aside first
        keeps it; the newest boot always lands in the canonical filename so
        nothing that still reads switch-router-production.out.log breaks.
        A failure to archive never blocks startup.
    #>
    param([int]$Keep = 10)

    foreach ($logPath in @($script:StdOutLog, $script:StdErrLog)) {
        if (-not (Test-Path -LiteralPath $logPath)) { continue }

        try {
            $dir = Split-Path -Parent $logPath
            $base = Split-Path -Leaf $logPath
            $stem = $base -replace '\.log$', ''
            $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
            $archive = Join-Path $dir ("{0}.{1}.log" -f $stem, $stamp)

            # Two boots inside the same second would otherwise collide.
            $attempt = 1
            while (Test-Path -LiteralPath $archive) {
                if ($attempt -gt 99) { break }
                $archive = Join-Path $dir ("{0}.{1}.{2}.log" -f $stem, $stamp, $attempt)
                $attempt++
            }
            Move-Item -LiteralPath $logPath -Destination $archive -Force -ErrorAction Stop
        } catch {
            Write-Warning ("[router] could not archive {0}: {1}" -f $logPath, $_.Exception.Message)
        }

        # Prune: keep the $Keep most recent archives for this stream.
        try {
            $dir = Split-Path -Parent $logPath
            $base = Split-Path -Leaf $logPath
            $stem = $base -replace '\.log$', ''
            $pattern = Join-Path $dir ("{0}.*.log" -f $stem)
            # -Path (not -LiteralPath) so the wildcard is expanded; the canonical
            # name has nothing between ".out." and ".log" so it never matches.
            $stale = @(Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending |
                Select-Object -Skip $Keep)
            # Remove-Item errors on an empty pipeline ("missing path operand"), which
            # is the normal case right after the first boot, so only delete when
            # something actually exceeds the retention limit.
            if ($stale.Count) {
                $stale | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
            }
        } catch {
            Write-Warning ("[router] could not prune archives for {0}: {1}" -f $logPath, $_.Exception.Message)
        }
    }
}

function Start-Router {
    <# Starts the server exactly as `npm start` would, with stdout/stderr captured under logs\. #>
    if (Test-RouterRunning) { return [pscustomobject]@{ Started = $false; Reason = 'already-running' } }
    if (-not (Test-RouterBuildPresent)) { return [pscustomobject]@{ Started = $false; Reason = 'build-missing' } }

    New-Item -ItemType Directory -Path $script:LogDir -Force | Out-Null
    # Start-Process overwrites its redirect targets, so move the previous boot's
    # logs aside first — otherwise restart loses every heartbeat line.
    Rotate-RouterLog
    $script:ServerProcess = Start-Process -FilePath 'npm.cmd' -ArgumentList @('start') `
        -WorkingDirectory $script:RepoRoot `
        -RedirectStandardOutput $script:StdOutLog `
        -RedirectStandardError $script:StdErrLog `
        -WindowStyle Hidden -PassThru

    return [pscustomobject]@{ Started = $true; Reason = 'started'; LauncherPid = $script:ServerProcess.Id }
}

function Stop-Router {
    <#
        Stops only node processes owned by this checkout (plus their cmd.exe wrapper
        from npm). A listener on the port that is NOT ours is reported, never killed.
    #>
    $ourProcesses = @(Get-RouterProcesses)
    $ourIds = @($ourProcesses | ForEach-Object { [int]$_.ProcessId })
    $listenerPid = Get-RouterListeningProcessId
    $foreignListener = ($listenerPid -ne 0 -and $ourIds -notcontains $listenerPid)
    $stopped = @()

    foreach ($process in $ourProcesses) {
        $wrapper = $null
        $parent = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $process.ParentProcessId) -ErrorAction SilentlyContinue
        if ($parent -and $parent.Name -eq 'cmd.exe' -and $parent.CommandLine -match '(?i)custom-server\.js|standalone.server\.js') {
            $wrapper = [int]$parent.ProcessId
        }

        try {
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
            $stopped += [int]$process.ProcessId
        } catch { }

        if ($wrapper) { try { Stop-Process -Id $wrapper -Force -ErrorAction SilentlyContinue } catch { } }
    }

    if ($script:ServerProcess -and -not $script:ServerProcess.HasExited) {
        try { Stop-Process -Id $script:ServerProcess.Id -Force -ErrorAction SilentlyContinue } catch { }
    }
    $script:ServerProcess = $null

    return [pscustomobject]@{
        StoppedPids     = $stopped
        ForeignListener = if ($foreignListener) { $listenerPid } else { 0 }
    }
}

function Restart-Router {
    Stop-Router | Out-Null
    Start-Sleep -Milliseconds 1500
    return Start-Router
}

function Test-RouterAutostartEnabled {
    return Test-Path -LiteralPath $script:StartupShortcut
}

function Set-RouterAutostart {
    param([Parameter(Mandatory = $true)][bool]$Enabled)

    $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $script:AutostartScript)
    if (-not $Enabled) { $arguments += '-Remove' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -Wait
    return Test-RouterAutostartEnabled
}

function Resolve-RouterIcon {
    if (-not (Test-Path -LiteralPath $script:IconPath) -and (Test-Path -LiteralPath $script:IconGenerator)) {
        try { & node $script:IconGenerator | Out-Null } catch { }
    }
    if (Test-Path -LiteralPath $script:IconPath) {
        try { return New-Object System.Drawing.Icon($script:IconPath) } catch { }
    }
    return [System.Drawing.SystemIcons]::Application
}
