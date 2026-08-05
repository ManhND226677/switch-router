' Switch-Router tray launcher (silent).
' Starts scripts\windows\tray.ps1 with no console window, so the only visible
' UI is the system-tray icon. Used by the per-user Startup shortcut.
Option Explicit

Dim shell, fso, scriptDir, trayScript, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
trayScript = fso.BuildPath(scriptDir, "tray.ps1")

If Not fso.FileExists(trayScript) Then
  WScript.Echo "Switch-Router tray script not found: " & trayScript
  WScript.Quit 1
End If

shell.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
command = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & trayScript & """"

' 0 = hidden window, False = do not wait for the tray to exit.
shell.Run command, 0, False
