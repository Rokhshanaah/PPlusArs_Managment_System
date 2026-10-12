#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$InstallerDir = Join-Path $Root 'installer'
$LauncherDir = Join-Path $InstallerDir 'launcher'
$Src = Join-Path $LauncherDir 'PPlus.Arz.cs'
$Out = Join-Path $LauncherDir 'PPlus.Arz.exe'
$Ico = Join-Path $InstallerDir 'zarin-logo.ico'

$csc = @(
  'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe',
  'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $csc) { throw 'csc.exe not found' }
if (-not (Test-Path $Ico)) { throw "Missing icon: $Ico" }

& $csc /nologo /target:winexe /optimize+ /win32icon:"$Ico" /out:"$Out" /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Net.dll "$Src"
if ($LASTEXITCODE -ne 0) { throw 'Launcher compile failed' }

Write-Host "Built: $Out"
Get-Item $Out | Format-List FullName, Length, LastWriteTime
