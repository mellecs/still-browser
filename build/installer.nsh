!macro customInstall
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\StillBrowser" "" "Still Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\StillBrowser\Capabilities" "ApplicationName" "Still Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\StillBrowser\Capabilities" "ApplicationDescription" "Still Browser, navegador minimalista"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\StillBrowser\Capabilities\URLAssociations" "http" "StillBrowserURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\StillBrowser\Capabilities\URLAssociations" "https" "StillBrowserURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\StillBrowser\Capabilities\FileAssociations" ".htm" "StillBrowserHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\StillBrowser\Capabilities\FileAssociations" ".html" "StillBrowserHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\StillBrowser\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\StillBrowser\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegStr HKCU "Software\RegisteredApplications" "Still Browser" "Software\Clients\StartMenuInternet\StillBrowser\Capabilities"

  WriteRegStr HKCU "Software\Classes\StillBrowserURL" "" "Still Browser URL"
  WriteRegStr HKCU "Software\Classes\StillBrowserURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\StillBrowserURL\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\StillBrowserURL\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr HKCU "Software\Classes\StillBrowserHTML" "" "Still Browser HTML"
  WriteRegStr HKCU "Software\Classes\StillBrowserHTML\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\StillBrowserHTML\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\StillBrowser"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Still Browser"
  DeleteRegKey HKCU "Software\Classes\StillBrowserURL"
  DeleteRegKey HKCU "Software\Classes\StillBrowserHTML"
!macroend