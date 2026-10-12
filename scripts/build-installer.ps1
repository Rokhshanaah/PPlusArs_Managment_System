#Requires -Version 5.1
<#
  Builds PPlusArz-Setup-x.x.x.exe (password-protected Inno Setup installer).
  Password is passed only to the compiler and is NOT written into customer docs.
#>
param(
  [string]$InstallPassword = 'hamedi360',
  [switch]$SkipPortableRebuild
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

$Iscc = @(
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 7\ISCC.exe",
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
  "C:\Program Files\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $Iscc) {
  Write-Host "Inno Setup not found. Installing via winget..."
  winget install --id JRSoftware.InnoSetup --accept-package-agreements --accept-source-agreements --disable-interactivity
  $Iscc = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 7\ISCC.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Iscc) { throw "ISCC.exe not found. Install Inno Setup 6+." }

$PortableDir = Join-Path $Root 'release\PPlusArz-Portable'
if (-not $SkipPortableRebuild -or -not (Test-Path (Join-Path $PortableDir 'runtime'))) {
  Write-Step "Building portable package first ..."
  & (Join-Path $Root 'scripts\build-portable.ps1')
}

Write-Step "Compiling PPlus.Arz.exe launcher ..."
& (Join-Path $Root 'scripts\build-launcher.ps1')

# Ensure launchers/icons are present even if portable was skipped
Copy-Item -Force (Join-Path $Root 'installer\files\Start-PPlusArz.bat') (Join-Path $PortableDir 'Start-PPlusArz.bat')
Copy-Item -Force (Join-Path $Root 'installer\files\Start-PPlusArz.bat') (Join-Path $PortableDir 'RUN.bat')
Copy-Item -Force (Join-Path $Root 'installer\files\Setup-Database.bat') (Join-Path $PortableDir 'Setup-Database.bat')
Copy-Item -Force (Join-Path $Root 'installer\files\Setup-Database.bat') (Join-Path $PortableDir 'INSTALL.bat')
Copy-Item -Force (Join-Path $Root 'installer\zarin-logo.ico') (Join-Path $PortableDir 'zarin-logo.ico')
Copy-Item -Force (Join-Path $Root 'installer\zarin-logo.png') (Join-Path $PortableDir 'zarin-logo.png')
Copy-Item -Force (Join-Path $Root 'installer\launcher\PPlus.Arz.exe') (Join-Path $PortableDir 'PPlus.Arz.exe')

# Strip local secrets / setup flags before packaging
$envFile = Join-Path $PortableDir 'app\server\.env'
$flagFile = Join-Path $PortableDir 'app\server\.setup-done'
if (Test-Path $envFile) { Remove-Item -Force $envFile }
if (Test-Path $flagFile) { Remove-Item -Force $flagFile }

Write-Step "Compiling Setup.exe with encryption ..."
$Iss = Join-Path $Root 'installer\pplus-arz.iss'
& $Iscc /DInstallPassword=$InstallPassword $Iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compile failed." }

$Setup = Get-ChildItem (Join-Path $Root 'release') -Filter 'PPlus.Arz-Setup-*.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

Write-Host ""
Write-Host "DONE" -ForegroundColor Green
Write-Host ("Installer: " + $Setup.FullName)
Write-Host ("Size: {0:N1} MB" -f ($Setup.Length / 1MB))
Write-Host "Desktop name after install: PPlus.Arz"
Write-Host "Customer needs the install password to run Setup.exe"
