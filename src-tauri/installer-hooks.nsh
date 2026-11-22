!macro NSIS_HOOK_POSTINSTALL
  StrCpy $0 "en"
  ${If} $LANGUAGE == 1045
    StrCpy $0 "pl"
  ${EndIf}
  WriteRegStr HKCU "Software\me.asmek.asmacro" "Language" "$0"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\me.asmek.asmacro"
!macroend
