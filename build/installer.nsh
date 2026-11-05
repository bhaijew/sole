!macro customInit
  ; Forcefully terminate any lingering instances of Sole What before checking or installing
  DetailPrint "Ensuring previous Sole What processes are closed..."
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  nsExec::Exec 'taskkill /F /IM "Sole What.exe" /T'
  nsExec::Exec 'taskkill /F /IM "sole-what-pos.exe" /T'
  Sleep 1000
!macroend

!macro customUnInstall
  DetailPrint "Ensuring Sole What is closed before uninstall..."
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  nsExec::Exec 'taskkill /F /IM "Sole What.exe" /T'
  Sleep 1000
!macroend

