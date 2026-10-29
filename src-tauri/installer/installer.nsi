Unicode true
ManifestDPIAware true
; 为 Windows 10 1607 及以上版本声明 PerMonitorV2 DPI 感知；低版本忽略该字段并沿用 ManifestDPIAware true
; 该选项在 NSIS 源码的 Docs 中说明，来源见下方链接
; https://github.com/kichik/nsis/blob/5fc0b87b819a9eec006df4967d08e522ddd651c9/Docs/src/attributes.but#L286-L300
; https://github.com/tauri-apps/tauri/pull/10106
ManifestDPIAwareness PerMonitorV2

!if "{{compression}}" == "none"
  SetCompress off
!else
  ; 配置压缩算法，默认使用 LZMA
  SetCompressor /SOLID "{{compression}}"
!endif

; 在 !include 前注册插件目录，确保早于任何插件命令
; 来源：https://github.com/tauri-apps/tauri/pull/15422#discussion_r3289239624
{{#if signed_plugins_path}}
!addplugindir "{{signed_plugins_path}}"
{{/if}}

!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
!include "utils.nsh"
!include "FileAssociation.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!include "Win\RestartManager.nsh"
!include "StrFunc.nsh"
${StrCase}
${StrLoc}

{{#if installer_hooks}}
!include "{{installer_hooks}}"
{{/if}}

!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define HOMEPAGE "{{homepage}}"
!define INSTALLMODE "{{install_mode}}"
!define LICENSE "{{license}}"
!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define UNINSTALLERICON "{{uninstaller_icon}}"
!define UNINSTALLERHEADERIMAGE "{{uninstaller_header_image}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ADDITIONALPLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define MINIMUMWEBVIEW2VERSION "{{minimum_webview2_version}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_cmd}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define STARTMENUFOLDER "{{start_menu_folder}}"

Var PassiveMode
Var UpdateMode
Var NoShortcutMode
Var WixMode
Var OldMainBinaryName
Var StarterHeaderBitmap

Name "${PRODUCTNAME}"
BrandingText "${COPYRIGHT}"
; 品牌定制开始
; 与 resources/branding 的薄荷猫咪图标和纸叶插画共用轻盈绿色。
; 保留原生向导、DPI 缩放、键盘导航与系统按钮，只定制视觉和排版。
!define MUI_BGCOLOR "0xFFFFFF"
!define MUI_TEXTCOLOR "0x243D35"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADER_TRANSPARENT_TEXT
!define MUI_INSTFILESPAGE_COLORS "36544A F4FBF7"
!define MUI_CUSTOMFUNCTION_GUIINIT StarterGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.StarterGuiInit
; 品牌定制结束
OutFile "${OUTFILE}"

; 此值仅用于目录选择器自动追加产品名称，
; 不作为实际的默认安装路径
; https://nsis.sourceforge.io/Reference/InstallDir
!define PLACEHOLDER_INSTALL_DIR "placeholder\${PRODUCTNAME}"
InstallDir "${PLACEHOLDER_INSTALL_DIR}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${PRODUCTNAME}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

# 附加插件目录
!addplugindir "${ADDITIONALPLUGINSPATH}"

; 卸载程序的签名命令
!if "${UNINSTALLERSIGNCOMMAND}" != ""
  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}'
!endif

; 按当前用户、所有用户或可选安装范围配置权限
!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

!if "${INSTALLMODE}" == "both"
  !define MULTIUSER_MUI
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"
  !define MULTIUSER_INSTALLMODE_COMMANDLINE
  !if "${ARCH}" == "x64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !else if "${ARCH}" == "arm64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !endif
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINSTKEY}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "CurrentUser"
  !define MULTIUSER_INSTALLMODEPAGE_SHOWUSERNAME
  !define MULTIUSER_INSTALLMODE_FUNCTION RestorePreviousInstallLocation
  !define MULTIUSER_EXECUTIONLEVEL Highest
  !include MultiUser.nsh
!endif

; 安装器图标
!if "${INSTALLERICON}" != ""
  !define MUI_ICON "${INSTALLERICON}"
!endif

; 安装器侧边插画
!if "${SIDEBARIMAGE}" != ""
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"
!endif

; 配置任一页眉图片时，启用安装与卸载页面的页眉图片支持
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!else if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!endif

; 安装器页眉图片
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_BITMAP "${HEADERIMAGE}"
!endif

; 卸载器页眉图片
!if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_UNBITMAP "${UNINSTALLERHEADERIMAGE}"
!endif

; 卸载器图标
!if "${UNINSTALLERICON}" != ""
  !define MUI_UNICON "${UNINSTALLERICON}"
!endif

; 定义保存安装器语言的注册表键
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

; 安装器页面按显示顺序声明
; 页眉完整显示，侧栏铺满控件；字体与 DPI 改变字段比例时仍保持等比。
; 输出为绘制宽、高、居中坐标；MulDiv 避免先除法造成的精度损失。
!macro StarterFitBitmap WIDTH HEIGHT SOURCEWIDTH SOURCEHEIGHT MODE
  StrCpy $R7 ${WIDTH}
  System::Call 'KERNEL32::MulDiv(i ${WIDTH},i ${SOURCEHEIGHT},i ${SOURCEWIDTH})i.R8'
  !if "${MODE}" == "cover"
    ${If} $R8 < ${HEIGHT}
  !else if "${MODE}" == "contain"
    ${If} $R8 > ${HEIGHT}
  !else
    !error "Unsupported bitmap fit mode: ${MODE}"
  !endif
    StrCpy $R8 ${HEIGHT}
    System::Call 'KERNEL32::MulDiv(i ${HEIGHT},i ${SOURCEWIDTH},i ${SOURCEHEIGHT})i.R7'
  ${EndIf}
  ${If} $R7 < 1
    StrCpy $R7 1
  ${EndIf}
  ${If} $R8 < 1
    StrCpy $R8 1
  ${EndIf}
  IntOp $R9 ${WIDTH} - $R7
  IntOp $R9 $R9 / 2
  IntOp $4 ${HEIGHT} - $R8
  IntOp $4 $4 / 2
!macroend

; 使用 GDI HALFTONE 等比缩放原图，侧栏居中裁切装饰边缘以消除上下白边。
; 目标明确使用 24 位 DIB，避免主题控件把 32 位 DDB 的未定义 alpha 当作透明图片。
; 保持 MUI 的布局和图片生命周期；加载失败时保留 MUI 已设置的图片。
!macro StarterSetSharpBitmap CONTROL PATH RESULT MODE
  System::Store "S"
  StrCpy $0 ${CONTROL}
  System::Call 'USER32::LoadImage(p0,t "${PATH}",i0,i0,i0,i0x2010)p.r1'
  ${If} $1 P<> 0
    StrCpy $R5 0
    StrCpy $R6 0
    System::Call '*(i0,i0,i0,i0,i0,p0)p.r4'
    ${If} $4 P<> 0
      System::Call 'GDI32::GetObject(pr1,i24,pr4)i.R5'
      System::Call '*$4(i,i.r5,i.r6)'
      System::Free $4
    ${EndIf}
    System::Call '*(i0,i0,i0,i0)p.r4'
    ${If} $4 P<> 0
      System::Call 'USER32::GetClientRect(pr0,pr4)i.R6'
      System::Call '*$4(i,i,i.r2,i.r3)'
      System::Free $4
    ${EndIf}
    ${If} $R5 <> 0
    ${AndIf} $R6 <> 0
    ${AndIf} $5 > 0
    ${AndIf} $6 > 0
    ${AndIf} $2 > 0
    ${AndIf} $3 > 0
      System::Call 'USER32::GetDC(pr0)p.R3'
      System::Call 'GDI32::CreateCompatibleDC(pR3)p.r7'
      System::Call 'GDI32::CreateCompatibleDC(pR3)p.r8'
      StrCpy $9 0
      System::Call '*(i40,ir2,ir3,&i2 1,&i2 24,i0,i0,i0,i0,i0,i0)p.r4'
      ${If} $4 P<> 0
        System::Call 'GDI32::CreateDIBSection(pR3,pr4,i0,*p.R2,p0,i0)p.r9'
        System::Free $4
      ${EndIf}
      ${If} $R3 P<> 0
      ${AndIf} $7 P<> 0
      ${AndIf} $8 P<> 0
      ${AndIf} $9 P<> 0
        System::Call 'GDI32::SelectObject(pr7,pr1)p.R0'
        System::Call 'GDI32::SelectObject(pr8,pr9)p.R1'
        StrCpy $R4 0
        ${If} $R0 P<> 0
        ${AndIf} $R0 P<> -1
        ${AndIf} $R1 P<> 0
        ${AndIf} $R1 P<> -1
          !insertmacro StarterFitBitmap $2 $3 $5 $6 ${MODE}
          System::Call 'GDI32::PatBlt(pr8,i0,i0,ir2,ir3,i0x00FF0062)i.R5'
          System::Call 'GDI32::SetStretchBltMode(pr8,i4)i.R6'
          ${If} $R5 <> 0
          ${AndIf} $R6 <> 0
            System::Call 'GDI32::SetBrushOrgEx(pr8,i0,i0,p0)i.R5'
            ${If} $R5 <> 0
              System::Call 'GDI32::StretchBlt(pr8,iR9,ir4,iR7,iR8,pr7,i0,i0,ir5,ir6,i0x00CC0020)i.R4'
            ${EndIf}
          ${EndIf}
        ${EndIf}
        System::Call 'GDI32::SelectObject(pr7,pR0)'
        System::Call 'GDI32::SelectObject(pr8,pR1)'
        ${If} $R4 <> 0
          SendMessage $0 ${STM_SETIMAGE} ${IMAGE_BITMAP} $9 $R2
          System::Call 'GDI32::DeleteObject(pR2)'
          StrCpy ${RESULT} $9
          StrCpy $9 0
        ${EndIf}
      ${EndIf}
      System::Call 'GDI32::DeleteObject(pr9)'
      System::Call 'GDI32::DeleteDC(pr7)'
      System::Call 'GDI32::DeleteDC(pr8)'
      System::Call 'USER32::ReleaseDC(pr0,pR3)'
    ${EndIf}
    System::Call 'GDI32::DeleteObject(pr1)'
  ${EndIf}
  System::Store "L"
!macroend

; 以当前语言字体和 DPI 的对话框单位收紧页脚，保留各内容页的原生布局。
; 标准 MUI 页脚为 29du；按钮上移 5du、窗口缩短 9du，得到 20du 页脚。
; 14du 按钮上下各保留 3du，内容页与分隔线的位置不变。
!macro StarterCompactFooter
  System::Store "S"
  System::Call '*(i0,i5,i0,i9)p.r0'
  System::Call 'USER32::MapDialogRect(p $HWNDPARENT,pr0)i.r1'
  ${If} $1 <> 0
    System::Call '*$0(i,i.r8,i,i.r9)'
    !insertmacro StarterMoveFooterButton 1
    !insertmacro StarterMoveFooterButton 2
    !insertmacro StarterMoveFooterButton 3
    System::Call 'USER32::GetWindowRect(p $HWNDPARENT,pr0)i.r1'
    ${If} $1 <> 0
      System::Call '*$0(i.r2,i.r3,i.r4,i.r5)'
      IntOp $4 $4 - $2
      IntOp $5 $5 - $3
      IntOp $5 $5 - $9
      System::Call 'USER32::SetWindowPos(p $HWNDPARENT,p0,i0,i0,ir4,ir5,i0x16)'
    ${EndIf}
  ${EndIf}
  System::Free $0
  System::Store "L"
!macroend

!macro StarterMoveFooterButton ID
  GetDlgItem $6 $HWNDPARENT ${ID}
  System::Call 'USER32::GetWindowRect(pr6,pr0)i.r1'
  ${If} $1 <> 0
    System::Call 'USER32::MapWindowPoints(p0,p $HWNDPARENT,pr0,i2)'
    System::Call '*$0(i.r2,i.r3)'
    IntOp $3 $3 - $8
    System::Call 'USER32::SetWindowPos(pr6,p0,ir2,ir3,i0,i0,i0x15)'
  ${EndIf}
!macroend

Function StarterGuiInit
  !insertmacro StarterCompactFooter
  !ifdef MUI_HEADERIMAGE
    !insertmacro StarterSetSharpBitmap $mui.Header.Image "$PLUGINSDIR\modern-header.bmp" $StarterHeaderBitmap contain
  !endif
FunctionEnd

Function un.StarterGuiInit
  !insertmacro StarterCompactFooter
  !ifdef MUI_HEADERIMAGE
    !insertmacro StarterSetSharpBitmap $mui.Header.Image "$PLUGINSDIR\modern-header.bmp" $StarterHeaderBitmap contain
  !endif
FunctionEnd

; 页眉跨页面复用，在界面销毁时释放；侧栏仍由 MUI 按页面释放。
Function .onGUIEnd
  SendMessage $mui.Header.Image ${STM_SETIMAGE} ${IMAGE_BITMAP} 0
  System::Call 'GDI32::DeleteObject(p $StarterHeaderBitmap)'
  StrCpy $StarterHeaderBitmap 0
FunctionEnd

Function un.onGUIEnd
  SendMessage $mui.Header.Image ${STM_SETIMAGE} ${IMAGE_BITMAP} 0
  System::Call 'GDI32::DeleteObject(p $StarterHeaderBitmap)'
  StrCpy $StarterHeaderBitmap 0
FunctionEnd

; 1. 欢迎页面
; 品牌定制开始
!define MUI_WELCOMEPAGE_TITLE "$(StarterWelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(StarterWelcomeText)"
!define MUI_PAGE_CUSTOMFUNCTION_SHOW StarterWelcomeShow
; 品牌定制结束
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_WELCOME

; 对话框沿用标准安装器字体的紧凑度量，标题独立使用现代字体。
; 图片在最终控件尺寸内等比铺满，只裁切装饰边缘。
Function StarterWelcomeShow
  !insertmacro StarterSetSharpBitmap $mui.WelcomePage.Image "$PLUGINSDIR\modern-wizard.bmp" $mui.WelcomePage.Image.Bitmap cover
  System::Call 'gdi32::DeleteObject(p $mui.WelcomePage.Title.Font)'
  CreateFont $mui.WelcomePage.Title.Font "$(StarterTitleFont)" "13" "600"
  SendMessage $mui.WelcomePage.Title ${WM_SETFONT} $mui.WelcomePage.Title.Font 1
  ; nsDialogs 标签不会继承主对话框按语言设置的字体
  Push $0
  SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $0
  SendMessage $mui.WelcomePage.Text ${WM_SETFONT} $0 1
  Pop $0
  SetCtlColors $mui.WelcomePage.Text "536B61" "FFFFFF"
FunctionEnd

; 2. 许可证页面（配置许可证时显示）
!if "${LICENSE}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MUI_PAGE_LICENSE "${LICENSE}"
!endif

; 3. 安装范围页面（安装模式为 both 时显示）
!if "${INSTALLMODE}" == "both"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MULTIUSER_PAGE_INSTALLMODE
!endif

; 4. 检测到已有安装时，提供重新安装或卸载页面
;    仅在检测到已有安装时显示
Var ReinstallPageCheck
Page custom PageReinstall PageLeaveReinstall
Function PageReinstall
  ; 检测并卸载已有的 WiX 安装
  ;
  ; WiX 通过 UUID 保存安装信息，需要遍历注册表卸载项
  ; 遍历的注册表位置如下
  ; `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`
  ; 核对 DisplayName、Publisher 是否匹配 ${PRODUCTNAME}、${MANUFACTURER}
  ;
  ; 其他来源的安装也可能使用相同的产品名称和发布者，
  ; 因此匹配结果未必来自本项目的 WiX 安装器
  ; 卸载前仍需用户确认；发现匹配不正确时可取消
  ; 避免直接卸载未经确认的匹配项
  StrCpy $0 0
  wix_loop:
    EnumRegKey $1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" wix_loop_done ; 没有剩余注册表键时退出循环
    IntOp $0 $0 + 1
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "Publisher"
    StrCmp "$R0$R1" "${PRODUCTNAME}${MANUFACTURER}" 0 wix_loop
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
    ${StrCase} $R1 $R0 "L"
    ${StrLoc} $R0 $R1 "msiexec" ">"
    StrCmp $R0 0 0 wix_loop_done
    StrCpy $WixMode 1
    StrCpy $R6 "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1"
    Goto compare_version
  wix_loop_done:

  ; 未检测到已有安装时跳过重新安装页面
  ReadRegStr $R0 SHCTX "${UNINSTKEY}" ""
  ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
  ${IfThen} "$R0$R1" == "" ${|} Abort ${|}

  ; 比较当前安装器与已有安装的版本，
  ; 并据此设置页面提示
  compare_version:
  StrCpy $R4 "$(older)"
  ${If} $WixMode = 1
    ReadRegStr $R0 HKLM "$R6" "DisplayVersion"
  ${Else}
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${EndIf}
  ${IfThen} $R0 == "" ${|} StrCpy $R4 "$(unknown)" ${|}

  nsis_tauri_utils::SemverCompare "${VERSION}" $R0
  Pop $R0
  ; 重新安装相同版本
  ${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(chooseMaintenanceOption)"
  ; 升级
  ${ElseIf} $R0 = 1
    StrCpy $R1 "$(olderOrUnknownVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    StrCpy $R3 "$(dontUninstall)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
  ; 降级
  ${ElseIf} $R0 = -1
    StrCpy $R1 "$(newerVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    !if "${ALLOWDOWNGRADES}" == "true"
      StrCpy $R3 "$(dontUninstall)"
    !else
      StrCpy $R3 "$(dontUninstallDowngrade)"
    !endif
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
  ${Else}
    Abort
  ${EndIf}

  ; 被动模式下跳过页面显示
  ;
  ; 此判断必须位于版本检测后，
  ; 以确保已初始化当前安装版本
  ; 以及是否降级的相关变量
  ; 供后续安装流程使用
  ${If} $PassiveMode = 1
    Call PageLeaveReinstall
  ${Else}
    nsDialogs::Create 1018
    Pop $R4
    ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}

    ${NSD_CreateLabel} 0 0 100% 24u $R1
    Pop $R1

    ${NSD_CreateRadioButton} 30u 50u -30u 8u $R2
    Pop $R2
    ${NSD_OnClick} $R2 PageReinstallUpdateSelection

    ${NSD_CreateRadioButton} 30u 70u -30u 8u $R3
    Pop $R3
    ; 禁止降级时禁用对应单选项
    !if "${ALLOWDOWNGRADES}" == "false"
      ${IfThen} $R0 = -1 ${|} EnableWindow $R3 0 ${|}
    !endif
    ${NSD_OnClick} $R3 PageReinstallUpdateSelection

    ; 首次进入页面或此前未选择第二项时，
    ; 默认勾选第一项，
    ; 再次进入时保留第二项的选择状态
    ${If} $ReinstallPageCheck <> 2
      SendMessage $R2 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${Else}
      SendMessage $R3 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${EndIf}

    ${NSD_SetFocus} $R2
    nsDialogs::Show
  ${EndIf}
FunctionEnd
Function PageReinstallUpdateSelection
  ${NSD_GetState} $R2 $R1
  ${If} $R1 == ${BST_CHECKED}
    StrCpy $ReinstallPageCheck 1
  ${Else}
    StrCpy $ReinstallPageCheck 2
  ${EndIf}
FunctionEnd
Function PageLeaveReinstall
  ${NSD_GetState} $R2 $R1

  ; 从 WiX 迁移时先卸载旧安装
  ${If} $WixMode = 1
    Goto reinst_uninstall
  ${EndIf}

  ; 更新模式下直接继续，不先卸载
  ${If} $UpdateMode = 1
    Goto reinst_done
  ${EndIf}

  ; $R0 表示相同版本（0）、升级（1）或降级（-1）
  ; $R1 表示单选项状态：
  ;   1 => 已选择第一项
  ;   0 => 已选择第二项
  ${If} $R0 = 0 ; 相同版本，按用户选择继续
    ${If} $R1 = 1              ; 用户选择添加或重新安装
      Goto reinst_done
    ${Else}                    ; 用户选择卸载
      Goto reinst_uninstall
    ${EndIf}
  ${ElseIf} $R0 = 1 ; 升级
    ${If} $R1 = 1              ; 用户选择卸载
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done         ; 用户选择保留已有安装
    ${EndIf}
  ${ElseIf} $R0 = -1 ; 降级
    ${If} $R1 = 1              ; 用户选择卸载
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done         ; 用户选择保留已有安装
    ${EndIf}
  ${EndIf}

  reinst_uninstall:
    HideWindow
    ClearErrors

    ${If} $WixMode = 1
      ReadRegStr $R1 HKLM "$R6" "UninstallString"
      ExecWait '$R1' $0
    ${Else}
      ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
      ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
      ${IfThen} $UpdateMode = 1 ${|} StrCpy $R1 "$R1 /UPDATE" ${|} ; 追加 /UPDATE 参数
      ${IfThen} $PassiveMode = 1 ${|} StrCpy $R1 "$R1 /P" ${|} ; 追加 /P 参数
      StrCpy $R1 "$R1 _?=$4" ; 追加卸载目录
      ExecWait '$R1' $0
    ${EndIf}

    BringToFront

    ${IfThen} ${Errors} ${|} StrCpy $0 2 ${|} ; ExecWait 失败时设置失败退出码

    ${If} $0 <> 0
    ${OrIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
      ; 用户取消 WiX 卸载时返回安装方式选择页面
      ${If} $WixMode = 1
      ${AndIf} $0 = 1602
        Abort
      ${EndIf}

      ; 用户取消 NSIS 卸载时返回安装方式选择页面
      ${If} $0 = 1
        Abort
      ${EndIf}

      ; 其他错误显示通用提示并返回安装方式选择页面
      MessageBox MB_ICONEXCLAMATION "$(unableToUninstall)"
      Abort
    ${EndIf}

    ; NSIS 卸载器通过 _?= 原地执行，无法删除自身及安装目录，
    ; 因此在卸载成功后由当前安装器完成清理
    ; https://nsis.sourceforge.io/Docs/Chapter3.html#:~:text=path%20contains%20spaces.-,3.2.3%20Examples,-installer.exe%20/NCRC
    ${If} $WixMode = 0
    ${AndIf} $4 != ""
      Delete "$4\uninstall.exe"
      RMDir "$4"
    ${EndIf}
  reinst_done:
FunctionEnd

; 5. 安装目录页面
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_DIRECTORY

; 6. 开始菜单快捷方式页面
Var AppStartMenuFolder
!if "${STARTMENUFOLDER}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !define MUI_STARTMENUPAGE_DEFAULTFOLDER "${STARTMENUFOLDER}"
!else
  !define MUI_PAGE_CUSTOMFUNCTION_PRE Skip
!endif
!insertmacro MUI_PAGE_STARTMENU Application $AppStartMenuFolder

; 7. 安装进度页面
!insertmacro MUI_PAGE_INSTFILES

; 8. 完成页面
;
; 品牌定制开始
!define MUI_FINISHPAGE_TITLE "$(StarterFinishTitle)"
!define MUI_FINISHPAGE_TEXT "$(StarterFinishText)"
!define MUI_PAGE_CUSTOMFUNCTION_SHOW StarterFinishShow
; 品牌定制结束
; 安装完成后不自动跳转到完成页面，
; 保留安装进度页中的记录以便定位安装问题
!define MUI_FINISHPAGE_NOAUTOCLOSE
; 复用完成页的说明文档选项，提供创建桌面快捷方式的操作
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(createDesktop)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut
; 安装完成后提供运行应用的选项
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION RunMainBinary
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_FINISH

Function StarterFinishShow
  !insertmacro StarterSetSharpBitmap $mui.FinishPage.Image "$PLUGINSDIR\modern-wizard.bmp" $mui.FinishPage.Image.Bitmap cover
  System::Call 'gdi32::DeleteObject(p $mui.FinishPage.Title.Font)'
  CreateFont $mui.FinishPage.Title.Font "$(StarterTitleFont)" "13" "600"
  SendMessage $mui.FinishPage.Title ${WM_SETFONT} $mui.FinishPage.Title.Font 1
  Push $0
  SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $0
  SendMessage $mui.FinishPage.Text ${WM_SETFONT} $0 1
  SendMessage $mui.FinishPage.Run ${WM_SETFONT} $0 1
  SendMessage $mui.FinishPage.ShowReadme ${WM_SETFONT} $0 1
  Pop $0
  SetCtlColors $mui.FinishPage.Text "536B61" "FFFFFF"
FunctionEnd

Function RunMainBinary
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
FunctionEnd

; 卸载器页面
; 1. 卸载确认页面
Var DeleteAppDataCheckbox
Var DeleteAppDataCheckboxState
!define /ifndef WS_EX_LAYOUTRTL         0x00400000
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.ConfirmShow
Function un.ConfirmShow ; 增加删除应用数据的复选框
  ; $1 为内部对话框句柄
  ; $2 为窗口 DPI
  ; $3 为控件样式
  ; $4 为横坐标
  ; $5 为纵坐标
  ; $6 为宽度
  ; $7 为高度
  FindWindow $1 "#32770" "" $HWNDPARENT ; 查找内部对话框
  System::Call "user32::GetDpiForWindow(p r1) i .r2"
  ${If} $(^RTL) = 1
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE} | ${WS_EX_LAYOUTRTL}"
    IntOp $4 50 * $2
  ${Else}
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE}"
    IntOp $4 0 * $2
  ${EndIf}
  IntOp $5 100 * $2
  IntOp $6 400 * $2
  IntOp $7 25 * $2
  IntOp $4 $4 / 96
  IntOp $5 $5 / 96
  IntOp $6 $6 / 96
  IntOp $7 $7 / 96
  System::Call 'user32::CreateWindowEx(i r3, w "${__NSD_CheckBox_CLASS}", w "$(deleteAppData)", i ${__NSD_CheckBox_STYLE}, i r4, i r5, i r6, i r7, p r1, i0, i0, i0) i .s'
  Pop $DeleteAppDataCheckbox
  SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $1
  SendMessage $DeleteAppDataCheckbox ${WM_SETFONT} $1 1
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.ConfirmLeave
Function un.ConfirmLeave
  SendMessage $DeleteAppDataCheckbox ${BM_GETCHECK} 0 0 $DeleteAppDataCheckboxState
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_PRE un.SkipIfPassive
!insertmacro MUI_UNPAGE_CONFIRM

; 2. 卸载进度页面
!insertmacro MUI_UNPAGE_INSTFILES

; 安装语言
{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}

; 品牌定制开始
; 页面宏引用独立的 LangString，避免覆盖 NSIS 内置翻译及重复定义警告。
; 新增安装语言时，同时补齐标题字体与四个文案字符串。
; SetFont 决定整套对话框的尺寸；采用 NSIS 标准字体，避免微软雅黑行高拉高窗口。
!ifdef LANG_SIMPCHINESE
  SetFont /LANG=${LANG_SIMPCHINESE} "SimSun" 9
  LangString StarterTitleFont ${LANG_SIMPCHINESE} "Microsoft YaHei UI"
  LangString StarterWelcomeTitle ${LANG_SIMPCHINESE} "开始安装"
  LangString StarterWelcomeText ${LANG_SIMPCHINESE} "${PRODUCTNAME}$\r$\n版本 ${VERSION}$\r$\n$\r$\n接下来选择安装位置，即可将应用添加到这台电脑。$\r$\n$\r$\n$_CLICK"
  LangString StarterFinishTitle ${LANG_SIMPCHINESE} "安装完成"
  LangString StarterFinishText ${LANG_SIMPCHINESE} "${PRODUCTNAME} 已准备就绪。$\r$\n$\r$\n你可以立即运行，也可以稍后再启动。选择下方选项后，点击 [完成] 关闭向导。"
!endif

!ifdef LANG_ENGLISH
  SetFont /LANG=${LANG_ENGLISH} "MS Shell Dlg" 8
  LangString StarterTitleFont ${LANG_ENGLISH} "Segoe UI"
  LangString StarterWelcomeTitle ${LANG_ENGLISH} "Ready to install"
  LangString StarterWelcomeText ${LANG_ENGLISH} "${PRODUCTNAME}$\r$\nVersion ${VERSION}$\r$\n$\r$\nChoose where to install the app on this computer.$\r$\n$\r$\n$_CLICK"
  LangString StarterFinishTitle ${LANG_ENGLISH} "Installation complete"
  LangString StarterFinishText ${LANG_ENGLISH} "${PRODUCTNAME} is ready.$\r$\n$\r$\nLaunch it now or come back later. Choose the options below, then click Finish to close this wizard."
!endif
; 品牌定制结束

Function .onInit
  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  !if "${DISPLAYLANGUAGESELECTOR}" == "true"
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !insertmacro SetContext

  ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"
    ; 设置默认安装位置
    !if "${INSTALLMODE}" == "perMachine"
      ${If} ${RunningX64}
        !if "${ARCH}" == "x64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else if "${ARCH}" == "arm64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else
          StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
        !endif
      ${Else}
        StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
      ${EndIf}
    !else if "${INSTALLMODE}" == "currentUser"
      StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"
    !endif

    Call RestorePreviousInstallLocation
  ${EndIf}


  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_INIT
  !endif

  ; 禁止降级时，在跳过重新安装选择页面的模式中直接终止：
  ; 静默、被动及更新模式
  !if "${ALLOWDOWNGRADES}" == "false"
  ${If} ${Silent}
  ${OrIf} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
    nsis_tauri_utils::SemverCompare "${VERSION}" $R0
    Pop $R0
    ; 检测到降级时
    ${If} $R0 = -1
      ${If} ${Silent}
        System::Call 'kernel32::AttachConsole(i -1)i.r0'
        ${If} $0 <> 0
          System::Call 'kernel32::GetStdHandle(i -11)i.r0'
          System::call 'kernel32::SetConsoleTextAttribute(i r0, i 0x0004)' ; 设置红色控制台提示
          FileWrite $0 "$(silentDowngrades)"
        ${EndIf}
      ${Else}
        MessageBox MB_ICONSTOP "$(silentDowngrades)"
      ${EndIf}
      Abort
    ${EndIf}
  ${EndIf}
  !endif
FunctionEnd

Section WebView2
  ; 已安装 WebView2 时跳过本节
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}

  ${If} $4 == ""
    ; 安装 WebView2
    ;
    ; 更新模式下跳过
    ${If} $UpdateMode <> 1
      !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
        ; 将运行时安装程序保存在本安装器独立的临时目录中
        InitPluginsDir
        DetailPrint "$(webview2Downloading)"
        NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"
        Pop $0
        ${If} $0 == "success"
          DetailPrint "$(webview2DownloadSuccess)"
        ${Else}
          DetailPrint "$(webview2DownloadError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
        StrCpy $6 "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "embedBootstrapper"
        InitPluginsDir
        File "/oname=$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2BOOTSTRAPPERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "offlineInstaller"
        InitPluginsDir
        File "/oname=$PLUGINSDIR\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$PLUGINSDIR\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        Goto install_webview2
      !endif

      Goto webview2_done

      install_webview2:
        DetailPrint "$(installingWebview2)"
        ; $6 保存 WebView2 安装程序路径
        ClearErrors
        ExecWait '"$6" ${WEBVIEW2INSTALLERARGS} /install' $1
        ${IfNot} ${Errors}
        ${AndIf} $1 = 0
          DetailPrint "$(webview2InstallSuccess)"
        ${Else}
          DetailPrint "$(webview2InstallError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
      webview2_done:
    ${EndIf}
  ${Else}
    !if "${MINIMUMWEBVIEW2VERSION}" != ""
      ${VersionCompare} "${MINIMUMWEBVIEW2VERSION}" "$4" $R0
      ${If} $R0 = 1
        update_webview:
          DetailPrint "$(installingWebview2)"
          ${If} ${RunningX64}
            ReadRegStr $R1 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate" "path"
          ${Else}
            ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 == ""
            ReadRegStr $R1 HKCU "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 != ""
            ; Chromium 更新器文档： https://source.chromium.org/chromium/chromium/src/+/main:docs/updater/user_manual.md
            ; 依据注册表卸载项的 Microsoft EdgeWebView\ModifyPath 命令调整
            ExecWait `"$R1" /install appguid=${WEBVIEW2APPGUID}&needsadmin=true` $1
            ${If} $1 = 0
              DetailPrint "$(webview2InstallSuccess)"
            ${Else}
              MessageBox MB_ICONEXCLAMATION|MB_ABORTRETRYIGNORE "$(webview2InstallError)" IDIGNORE ignore IDRETRY update_webview
              Quit
              ignore:
            ${EndIf}
          ${EndIf}
      ${EndIf}
    !endif
  ${EndIf}
SectionEnd

Section Install
  SetOutPath $INSTDIR

  !ifmacrodef NSIS_HOOK_PREINSTALL
    !insertmacro NSIS_HOOK_PREINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  ; 复制主可执行文件
  File "${MAINBINARYSRCPATH}"

  ; 复制资源文件
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}

  ; 复制外部可执行文件
  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}

  ; 创建文件关联
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
       !insertmacro APP_ASSOCIATE "{{ext}}" "{{or association.name ext}}" "{{association-description association.description ext}}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0" "Open with ${PRODUCTNAME}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    {{/each}}
  {{/each}}

  ; 注册深层链接协议
  {{#each deep_link_protocols as |protocol| ~}}
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "" "URL:${BUNDLEID} protocol"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  {{/each}}

  ; 创建卸载程序
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; 将 $INSTDIR 保存到注册表供后续安装使用
  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR

  !if "${INSTALLMODE}" == "both"
    ; 保存安装范围，供后续更新或卸载时使用，
    ; 并作为下次安装的默认选择
    WriteRegStr SHCTX "${UNINSTKEY}" $MultiUser.InstallMode 1
  !endif

  ; 主程序名称变化时删除旧可执行文件
  ReadRegStr $OldMainBinaryName SHCTX "${UNINSTKEY}" "MainBinaryName"
  ${If} $OldMainBinaryName != ""
  ${AndIf} $OldMainBinaryName != "${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\$OldMainBinaryName"
  ${EndIf}

  ; 保存当前 MAINBINARYNAME 供后续更新使用
  WriteRegStr SHCTX "${UNINSTKEY}" "MainBinaryName" "${MAINBINARYNAME}.exe"

  ; 写入系统应用列表所需的注册表信息
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" "1"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" "1"

  ${GetSize} "$INSTDIR" "/M=uninstall.exe /S=0K /G=0" $0 $1 $2
  IntOp $0 $0 + ${ESTIMATEDSIZE}
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$0"

  !if "${HOMEPAGE}" != ""
    WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}"
  !endif

  ; 创建开始菜单快捷方式
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    Call CreateOrUpdateStartMenuShortcut
  !insertmacro MUI_STARTMENU_WRITE_END

  ; 静默和被动模式不显示完成页面，
  ; 因此直接创建桌面快捷方式
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_POSTINSTALL
  !endif

  ; 原路径替换主程序后，通知系统刷新快捷方式和应用列表的图标
  ${RefreshShellIcons}

  ; 被动模式下自动关闭当前页面
  ${If} $PassiveMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function .onInstSuccess
  ; 仅在静默和被动模式中读取 /R 参数；
  ; 图形安装器通过页面选项控制是否启动应用
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    ${GetOptions} $CMDLINE "/R" $R0
    ${IfNot} ${Errors}
      ${GetOptions} $CMDLINE "/ARGS" $R0
      nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" "$R0"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro SetContext

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_UNINIT
  !endif

  !insertmacro MUI_UNGETLANGUAGE

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}
FunctionEnd

Section Uninstall

  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  ; 从磁盘删除应用目录及内容
  ; 复制主可执行文件
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"

  ; 删除资源文件
  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}

  ; 删除外部可执行文件
  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}

  ; 删除应用文件关联
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
      !insertmacro APP_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
    {{/each}}
  {{/each}}

  ; 删除深层链接协议
  {{#each deep_link_protocols as |protocol| ~}}
    ReadRegStr $R7 SHCTX "Software\Classes\\{{protocol}}\shell\open\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey SHCTX "Software\Classes\\{{protocol}}"
    ${EndIf}
  {{/each}}


  ; 删除卸载程序
  Delete "$INSTDIR\uninstall.exe"

  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir "$INSTDIR"

  ; 非更新模式下删除快捷方式
  ${If} $UpdateMode <> 1
    !insertmacro DeleteAppUserModelId

    ; 删除开始菜单快捷方式
    !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
    !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      RMDir "$SMPROGRAMS\$AppStartMenuFolder"
    ${EndIf}
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}

    ; 删除桌面快捷方式
    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}

  ; 删除系统应用列表的注册表信息
  !if "${INSTALLMODE}" == "both"
    DeleteRegKey SHCTX "${UNINSTKEY}"
  !else if "${INSTALLMODE}" == "perMachine"
    DeleteRegKey HKLM "${UNINSTKEY}"
  !else
    DeleteRegKey HKCU "${UNINSTKEY}"
  !endif

  ; 删除 HKCU Run 中属于 ${PRODUCTNAME} 的开机启动项
  ; 避免卸载后仍尝试自动启动应用
  ; 不存在对应项时不执行删除
  ; 仅在非更新模式下处理，更新时保留原有设置
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${BUNDLEID}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${BUNDLEID}"
  ${EndIf}

  ; 用户勾选删除数据且不处于更新模式时，
  ; 清理应用数据
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ; 清理注册表中的安装位置 $INSTDIR
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"

    ; 清理注册表中的安装语言
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"

    SetShellVarContext current
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif

  ; 被动或更新模式下自动关闭
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function RestorePreviousInstallLocation
  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
  StrCmp $4 "" +2 0
    StrCpy $INSTDIR $4
FunctionEnd

Function Skip
  Abort
FunctionEnd

Function SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd
Function un.SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd

Function CreateOrUpdateStartMenuShortcut
  ; 兼容此前以产品名称作为 MAINBINARYNAME 的版本，
  ; 将旧快捷方式迁移到新的主程序名称
  StrCpy $R0 0

  !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  ${If} $R0 = 1
    Return
  ${EndIf}

  ; 更新模式或禁用快捷方式时跳过创建，
  ; 从 WiX 迁移时仍创建快捷方式
  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  !if "${STARTMENUFOLDER}" != ""
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
FunctionEnd

Function CreateOrUpdateDesktopShortcut
  ; 兼容此前以产品名称作为 MAINBINARYNAME 的版本，
  ; 将旧快捷方式迁移到新的主程序名称
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Return
  ${EndIf}

  ; 更新模式或禁用快捷方式时跳过创建，
  ; 从 WiX 迁移时仍创建快捷方式
  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
FunctionEnd
