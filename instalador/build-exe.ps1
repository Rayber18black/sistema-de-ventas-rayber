# Script de empaquetado del sistema como .exe (Single Executable Application)
# Requisitos: Node.js 24 instalado.
# Uso:  npm run build   (en la carpeta instalador)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root "server"
$client = Join-Path $root "client"
$out = Join-Path $PSScriptRoot "dist"
$build = Join-Path $PSScriptRoot "build"

Write-Host "=== 1/5 Compilando frontend ===" -ForegroundColor Cyan
Push-Location $client
npm run build
Pop-Location

Write-Host "=== 2/5 Empaquetando servidor en un solo archivo ===" -ForegroundColor Cyan
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Path $build -Force | Out-Null
npx esbuild (Join-Path $server "src\index.js") --bundle --platform=node --format=cjs "--outfile=$(Join-Path $build 'bundle.cjs')" --target=node22

Write-Host "=== 3/5 Generando blob binario (SEA) ===" -ForegroundColor Cyan
node --experimental-sea-config .\sea-config.json

Write-Host "=== 4/5 Ensamblando POSVentas.exe ===" -ForegroundColor Cyan
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out -Force | Out-Null

$nodeExe = (node -e "process.stdout.write(process.execPath)")
$exe = Join-Path $out "POSVentas.exe"
Copy-Item $nodeExe $exe -Force

# Nota: la firma digital de node.exe queda invalidada al inyectar (postject lo
# advierte), pero Windows ejecuta el binario sin problemas.
npx postject $exe NODE_SEA_BLOB (Join-Path $build "sea.blob") --sentinel-fuse "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"

Write-Host "=== 5/5 Copiando interfaz web junto al .exe ===" -ForegroundColor Cyan
$www = Join-Path $out "www"
Copy-Item (Join-Path $client "dist") $www -Recurse

Set-Content -LiteralPath (Join-Path $out "INICIAR.bat") -Value '@echo off', 'start "" "%~dp0POSVentas.exe"' -Encoding ASCII

Write-Host ""
Write-Host "LISTO" -ForegroundColor Green
Write-Host "Archivo: $exe"
Write-Host "La base de datos se guarda en %APPDATA%\POSVentas"
Write-Host ""
Write-Host "Para el INSTALADOR (setup.exe) usa Inno Setup 6 con la plantilla:"
Write-Host "  $PSScriptRoot\plantilla-instalador.iss"