!ifndef BUILD_UNINSTALLER
  Var DesktopShortcutOwned
!endif

!macro customInit
  ReadRegDWORD $DesktopShortcutOwned SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" DesktopShortcutOwned
!macroend

!macro customInstall
  # An upgrade can clear the installation registry key while keeping the link.
  ${if} $DesktopShortcutOwned == 1
  ${andIf} ${FileExists} "$newDesktopLink"
    WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" DesktopShortcutOwned 1
  ${endIf}
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endIf}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function CreateChosenDesktopShortcut
    ${if} ${FileExists} "$newDesktopLink"
    ${andIf} $DesktopShortcutOwned != 1
      Return
    ${endIf}
    ClearErrors
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ${ifNot} ${Errors}
      WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" DesktopShortcutOwned 1
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
    ${endIf}
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "创建桌面快捷方式"
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "CreateChosenDesktopShortcut"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
  ${andIfNot} ${isKeepShortcuts}
    ReadRegDWORD $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" DesktopShortcutOwned
    ${if} $0 == 1
      WinShell::UninstShortcut "$oldDesktopLink"
      Delete "$oldDesktopLink"
    ${endIf}
  ${endIf}
!macroend
