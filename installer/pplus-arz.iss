; PPlus.Arz Windows Installer
; Password is compile-time only. Distributed Setup.exe uses Encryption.

#define MyAppName "PPlus.Arz"
#define MyAppVersion "3.0.0"
#define MyAppPublisher "PPlus.Arz"
#define MyAppURL "http://localhost:5001"
#define MyAppExeName "PPlus.Arz.exe"
#ifndef InstallPassword
  #error Pass install password: ISCC /DInstallPassword=...
#endif

[Setup]
AppId={{B8D4F0A2-5C3E-4F9B-AD22-9E7E3C2B1F56}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\PPlus.Arz.App
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=PPlus.Arz-Setup-{#MyAppVersion}
SetupIconFile=zarin-logo.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Password={#InstallPassword}
Encryption=yes
DisableWelcomePage=no
InfoBeforeFile=info-before.txt
CloseApplications=force
RestartApplications=no
ChangesAssociations=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
english.IncorrectPassword=Incorrect installation password.
english.WelcomeLabel1=Welcome to {#MyAppName} Setup
english.WelcomeLabel2=This will install {#MyAppName} [version {#MyAppVersion}] on your computer.%n%nMySQL (XAMPP) must be running when you open the app.%n%nClick Next to continue.

[Tasks]
Name: "desktopicon"; Description: "Create a Desktop shortcut"; GroupDescription: "Additional icons:"; Flags: checkedonce

[Files]
Source: "..\release\PPlusArz-Portable\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "app\server\.env,app\server\.setup-done,README-FA.txt,INSTALL.bat,RUN.bat,Start-PPlusArz.bat,Setup-Database.bat,app\server\uploads\avatars\*,app\server\uploads\card-reader\*"
Source: "files\Setup-Database.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "launcher\PPlus.Arz.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "zarin-logo.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "zarin-logo.png"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\Setup Database"; Filename: "{app}\Setup-Database.bat"; WorkingDir: "{app}"; IconFilename: "{app}\zarin-logo.ico"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"; IconFilename: "{app}\zarin-logo.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent; WorkingDir: "{app}"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app\server\.setup-done"
Type: files; Name: "{app}\app\server\.env"
Type: files; Name: "{app}\pplus-arz-launch.log"
