; "Open with" registration for .pdf, per user. Does NOT change the default app for .pdf:
; it only adds a ProgID and lists it under OpenWithProgids.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\PdfReader.pdf" "" "PDF Document"
  WriteRegStr HKCU "Software\Classes\PdfReader.pdf\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\PdfReader.pdf\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\.pdf\OpenWithProgids" "PdfReader.pdf" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\PdfReader.pdf"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "PdfReader.pdf"
  DeleteRegKey HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
