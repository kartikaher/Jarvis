$desktop = [Environment]::GetFolderPath('Desktop')
$path = Join-Path $desktop "JARVIS.lnk"
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($path)
$Shortcut.TargetPath = "C:\Users\KARTIK NARAYAN AHER\.gemini\antigravity\scratch\jarvis-ai\start_jarvis.bat"
$Shortcut.WorkingDirectory = "C:\Users\KARTIK NARAYAN AHER\.gemini\antigravity\scratch\jarvis-ai"
$Shortcut.Save()
Write-Output "Shortcut created at $path"
