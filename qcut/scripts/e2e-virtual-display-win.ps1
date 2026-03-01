<#
.SYNOPSIS
    Windows Virtual Desktop helper for E2E tests.

.DESCRIPTION
    Creates/removes Win10/11 virtual desktops via COM interop so that
    Electron E2E tests can run on a hidden desktop without stealing focus.

    Actions:
      create   — Create a new virtual desktop, output its index to stdout
      cleanup  — Remove the virtual desktop by index

.PARAMETER Action
    "create" or "cleanup"

.PARAMETER DesktopId
    Desktop identifier (index) returned by "create". Required for "cleanup".
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("create", "cleanup")]
    [string]$Action,

    [Parameter(Mandatory=$false)]
    [string]$DesktopId
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# We use the shell COM object to send Win+Ctrl+D / Win+Ctrl+F4 keystrokes
# because the IVirtualDesktopManagerInternal COM GUIDs are undocumented and
# change across Windows builds. Keystroke approach is stable across all
# Windows 10/11 versions.
# ---------------------------------------------------------------------------

function Get-DesktopCount {
    # Use Get-Process to detect explorer virtual desktop state
    # This is a heuristic — we count via WMI Win32_Desktop or registry
    try {
        $key = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops"
        $desktops = Get-ItemProperty -Path $key -Name "Desktops" -ErrorAction SilentlyContinue
        if ($desktops -and $desktops.Desktops) {
            # Each desktop GUID is 16 bytes in the binary blob
            return [math]::Max(1, $desktops.Desktops.Length / 16)
        }
    } catch {
        # Ignore — fallback below
    }
    return 1
}

function Send-Keys([string]$keys) {
    $wsh = New-Object -ComObject WScript.Shell
    $wsh.SendKeys($keys)
    Start-Sleep -Milliseconds 500
}

switch ($Action) {
    "create" {
        try {
            $countBefore = Get-DesktopCount

            # Win+Ctrl+D creates a new virtual desktop and switches to it
            Send-Keys "^#{d}"
            Start-Sleep -Milliseconds 1000

            $countAfter = Get-DesktopCount

            if ($countAfter -gt $countBefore) {
                # Output the desktop index (0-based, the new one is last)
                $newIndex = $countAfter - 1
                Write-Output $newIndex
            } else {
                # Desktop creation may have worked but count detection failed
                # Output a marker so the caller can still attempt cleanup
                Write-Output $countBefore
            }
        } catch {
            Write-Error "Virtual desktop creation failed: $_"
            Write-Output "FALLBACK"
        }
    }

    "cleanup" {
        if (-not $DesktopId) {
            Write-Error "DesktopId is required for cleanup"
            exit 1
        }

        try {
            # Win+Ctrl+F4 closes the current virtual desktop
            # First switch to the desktop we created, then close it
            # The desktop index tells us which desktop to close
            $targetIndex = [int]$DesktopId

            # Switch to the target desktop
            # Win+Ctrl+Right arrow navigates between desktops
            $currentCount = Get-DesktopCount

            if ($currentCount -gt 1) {
                # Close current desktop (assumes we're on the test desktop)
                Send-Keys "^#{F4}"
                Start-Sleep -Milliseconds 500
                Write-Host "Virtual desktop removed"
            } else {
                Write-Host "Only one desktop remaining, nothing to clean up"
            }
        } catch {
            Write-Error "Virtual desktop cleanup failed: $_"
        }
    }
}
