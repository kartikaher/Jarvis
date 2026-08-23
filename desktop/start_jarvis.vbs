Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
strPath = FSO.GetParentFolderName(WScript.ScriptFullName)
projectRoot = FSO.GetParentFolderName(strPath)
backendDir = projectRoot & "\backend"

nodeExe = "node.exe"
If FSO.FileExists("C:\Program Files\nodejs\node.exe") Then
    nodeExe = "C:\Program Files\nodejs\node.exe"
End If

pythonwExe = "C:\Python314\pythonw.exe"
If Not FSO.FileExists(pythonwExe) Then
    pythonwExe = "pythonw.exe"
End If

WshShell.CurrentDirectory = backendDir
WshShell.Run """" & nodeExe & """ server.js", 0, False

WScript.Sleep 1200

WshShell.CurrentDirectory = projectRoot
WshShell.Run """" & pythonwExe & """ -m desktop.main", 0, False

Set WshShell = Nothing
Set FSO = Nothing


















