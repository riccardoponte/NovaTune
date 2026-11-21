; Custom NSIS steps for NovaTune PC Suite
!macro customUnInstall
  ; remove scheduled tasks and Explorer context-menu entries created by the app
  nsExec::Exec 'schtasks.exe /Delete /TN "NovaTune PC Suite - Manutenzione automatica" /F'
  nsExec::Exec 'schtasks.exe /Delete /TN "NovaTune PC Suite - Controllo driver" /F'
  DeleteRegKey HKCU "Software\Classes\*\shell\NovaTuneShred"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\NovaTuneShred"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NovaTune PC Suite"
!macroend
