#Requires -Version 5.1
<#
  Builds a Windows portable install package with embedded Node.js 24.
  System Node/npm versions are NOT used at runtime.
#>
param(
  [string]$NodeVersion = '24.16.0',
  [string]$OutName = 'PPlusArz-Portable'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$ReleaseRoot = Join-Path $Root 'release'
$CacheDir = Join-Path $ReleaseRoot '.cache'
$OutDir = Join-Path $ReleaseRoot $OutName
$NodeZipName = "node-v$NodeVersion-win-x64.zip"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeZipName"
$NodeZip = Join-Path $CacheDir $NodeZipName
$NodeExtractName = "node-v$NodeVersion-win-x64"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Copy-Tree([string]$Source, [string]$Destination) {
  Ensure-Dir (Split-Path -Parent $Destination)
  if (Test-Path $Destination) {
    Remove-Item -Recurse -Force $Destination
  }
  Copy-Item -Recurse -Force $Source $Destination
}

Write-Host "============================================="
Write-Host "  PPlus.Arz - Portable Package Builder"
Write-Host "  Embedded Node.js $NodeVersion"
Write-Host "============================================="

Ensure-Dir $CacheDir
Ensure-Dir $ReleaseRoot

if (Test-Path $OutDir) {
  Write-Step "Removing previous package: $OutDir"
  Remove-Item -Recurse -Force $OutDir
}
Ensure-Dir $OutDir

if (-not (Test-Path $NodeZip)) {
  Write-Step "Downloading portable Node.js $NodeVersion ..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZip -UseBasicParsing
} else {
  Write-Step "Using cached Node.js zip: $NodeZipName"
}

$RuntimeDir = Join-Path $OutDir 'runtime'
Ensure-Dir $RuntimeDir
Write-Step "Extracting Node.js runtime ..."
Expand-Archive -Path $NodeZip -DestinationPath $RuntimeDir -Force
$BundledNodeDir = Join-Path $RuntimeDir $NodeExtractName
if (-not (Test-Path (Join-Path $BundledNodeDir 'node.exe'))) {
  throw "Bundled node.exe not found after extract."
}

$NodeExe = Join-Path $BundledNodeDir 'node.exe'
$NpmCmd = Join-Path $BundledNodeDir 'npm.cmd'
$env:Path = "$BundledNodeDir;$env:Path"
Write-Step "Build Node: $(& $NodeExe -v) / npm $(& $NpmCmd -v)"

Write-Step "Installing project dependencies (workspaces) ..."
& $NpmCmd install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

Write-Step "Building frontend for same-origin production (/api) ..."
$FrontendEnvPath = Join-Path $Root 'frontend\.env.production.local'
@(
  'VITE_API_URL=/api',
  'VITE_SOCKET_URL=',
  'VITE_PUBLIC_APP_URL=',
  'VITE_ZKTECO_BRIDGE_URL=http://127.0.0.1:18181'
) | Set-Content -Path $FrontendEnvPath -Encoding UTF8

& $NpmCmd run build --workspace @pplus-arz/frontend
if ($LASTEXITCODE -ne 0) { throw "frontend build failed." }

Write-Step "Copying application files ..."
$AppDir = Join-Path $OutDir 'app'
Ensure-Dir $AppDir

$ServerPkg = Get-Content (Join-Path $Root 'server\package.json') -Raw | ConvertFrom-Json
$ProdPkg = [ordered]@{
  name = 'pplus-arz'
  version = $ServerPkg.version
  private = $true
  type = 'module'
  description = 'PPlus.Arz portable Windows package'
  scripts = [ordered]@{
    start = 'node server/src/server.js'
    'db:setup' = 'node server/scripts/setup-db.js'
    'db:seed' = 'node server/scripts/seed.js'
    'db:import-legacy' = 'node server/scripts/import-legacy.js'
    'db:import-sql' = 'node server/scripts/import-sql.js'
  }
  dependencies = $ServerPkg.dependencies
}
$ProdJson = ($ProdPkg | ConvertTo-Json -Depth 8)
[System.IO.File]::WriteAllText((Join-Path $AppDir 'package.json'), $ProdJson + "`n")
[System.IO.File]::WriteAllText(
  (Join-Path $AppDir '.npmrc'),
  "registry=https://registry.npmjs.org/`naudit=false`nfund=false`nengine-strict=false`n"
)

Copy-Tree (Join-Path $Root 'server') (Join-Path $AppDir 'server')
$PackEnv = Join-Path $AppDir 'server\.env'
if (Test-Path $PackEnv) { Remove-Item -Force $PackEnv }
# Do not ship customer upload samples inside installer package
$Uploads = Join-Path $AppDir 'server\uploads'
if (Test-Path $Uploads) {
  Get-ChildItem $Uploads -Directory | ForEach-Object {
    Get-ChildItem $_.FullName -File -Recurse | Remove-Item -Force -ErrorAction SilentlyContinue
  }
}

Ensure-Dir (Join-Path $AppDir 'frontend')
Copy-Tree (Join-Path $Root 'frontend\dist') (Join-Path $AppDir 'frontend\dist')

if (Test-Path (Join-Path $Root 'database')) {
  Copy-Tree (Join-Path $Root 'database') (Join-Path $AppDir 'database')
}

$BridgeSrc = Join-Path $Root 'bridge\ZKTecoBridge\bin\Release'
if (Test-Path (Join-Path $BridgeSrc 'ZKTecoBridge.exe')) {
  Write-Step "Including ZKTeco bridge ..."
  $BridgeDst = Join-Path $OutDir 'bridge'
  Ensure-Dir $BridgeDst
  Copy-Item -Force (Join-Path $BridgeSrc '*') $BridgeDst
  $SdkSrc = Join-Path $Root 'bridge\ZKTecoBridge\sdk'
  if (Test-Path $SdkSrc) {
    Copy-Item -Force (Join-Path $SdkSrc '*.dll') $BridgeDst -ErrorAction SilentlyContinue
  }
}

@(
  'NODE_ENV=production',
  'PORT=5001',
  'CLIENT_URL=http://localhost:5001',
  'PUBLIC_APP_URL=http://localhost:5001',
  'JWT_SECRET=change-this-secret-before-production',
  'JWT_EXPIRES_IN=12h',
  'DB_HOST=127.0.0.1',
  'DB_PORT=3306',
  'DB_NAME=zarin_hesab',
  'DB_USER=root',
  'DB_PASSWORD=',
  'DB_LOGGING=false',
  'FRONTEND_DIST=./frontend/dist'
) | Set-Content -Path (Join-Path $AppDir 'server\.env.example') -Encoding ASCII

Write-Step "Installing production dependencies inside package (bundled Node) ..."
Push-Location $AppDir
try {
  & $NpmCmd install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "portable npm install failed." }
} finally {
  Pop-Location
}

Write-Step "Writing launcher scripts ..."
$StartTpl = Join-Path $Root 'installer\files\Start-PPlusArz.bat'
$SetupTpl = Join-Path $Root 'installer\files\Setup-Database.bat'
if (-not (Test-Path $StartTpl)) { throw "Missing $StartTpl" }
Copy-Item -Force $StartTpl (Join-Path $OutDir 'Start-PPlusArz.bat')
Copy-Item -Force $StartTpl (Join-Path $OutDir 'RUN.bat')
Copy-Item -Force $SetupTpl (Join-Path $OutDir 'Setup-Database.bat')
Copy-Item -Force $SetupTpl (Join-Path $OutDir 'INSTALL.bat')

$IconSrc = Join-Path $Root 'installer\zarin-logo.ico'
if (Test-Path $IconSrc) {
  Copy-Item -Force $IconSrc (Join-Path $OutDir 'zarin-logo.ico')
  Copy-Item -Force (Join-Path $Root 'installer\zarin-logo.png') (Join-Path $OutDir 'zarin-logo.png')
}

$ReadmeLines = @(
  'PPlus.Arz portable package',
  "Embedded Node.js $NodeVersion",
  'First run: Start-PPlusArz.bat (MySQL required)',
  'URL: http://localhost:5001',
  'Login: admin / 12345678'
)
[System.IO.File]::WriteAllLines((Join-Path $OutDir 'README-FA.txt'), $ReadmeLines)

Write-Step "Creating ZIP archive ..."
$ZipPath = Join-Path $ReleaseRoot "$OutName.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path $OutDir -DestinationPath $ZipPath -CompressionLevel Optimal

Write-Host ""
Write-Host "DONE" -ForegroundColor Green
Write-Host "Folder: $OutDir"
Write-Host "Zip:    $ZipPath"
