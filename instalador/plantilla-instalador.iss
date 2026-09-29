; Plantilla de instalador para Inno Setup 6 (https://jrsoftware.org/isdl.php)
; Compílala con: Compilador de Inno Setup → "instalar" dentro de la carpeta dist/
; Generará: POSVentas-Setup.exe

#define MyAppName "Sistema de Ventas"
#define MyAppVersion "0.1.0"
#define MyAppExeName "POSVentas.exe"

[Setup]
AppId={{7C4B9A11-1D70-4E09-9E12-7C6B21354A90}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher="Mi Negocio"
DefaultDirName={autopf}\POSVentas
DefaultGroupName={#MyAppName}
OutputDir=.\
OutputBaseFilename=POSVentas-Setup
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Languages\English.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; GroupDescription: "Accesos directos:"

[Files]
Source: "POSVentas.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "www\*"; DestDir: "{app}\www"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "INICIAR.bat"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Iniciar {#MyAppName}"; Flags: nowait postinstall skipifsilent