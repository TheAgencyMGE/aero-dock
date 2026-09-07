# Package the built exe as a portable zip.
#
# Run `pnpm tauri build` first, then this. The zip holds the executable, a
# portable.txt marker that tells Aero Dock to keep its files beside itself,
# and a short readme. Output lands in src-tauri/target/release/bundle/portable.

$ErrorActionPreference = "Stop"

$root    = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root "src-tauri\target\release"
$exe     = Join-Path $release "aero-dock.exe"

if (-not (Test-Path $exe)) {
    throw "aero-dock.exe not found. Run `pnpm tauri build` first."
}

$conf    = Get-Content (Join-Path $root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$version = $conf.version

$outDir  = Join-Path $release "bundle\portable"
$stage   = Join-Path $outDir "Aero Dock $version"
$zip     = Join-Path $outDir "Aero.Dock_${version}_x64-portable.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $zip)   { Remove-Item $zip -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Copy-Item $exe (Join-Path $stage "Aero Dock.exe")

# The marker is what switches portable mode on. Delete it and this copy
# behaves like an installed one, writing to %APPDATA% instead.
@'
Aero Dock keeps its settings and icon cache in the "data" folder next to
this file for as long as this file exists.

Delete it and Aero Dock will use %APPDATA%\com.aerodock.desktop instead,
the same as an installed copy.
'@ | Out-File (Join-Path $stage "portable.txt") -Encoding utf8

@"
Aero Dock $version, portable
============================

Run "Aero Dock.exe". Nothing to install.

Everything it writes goes in the "data" folder beside the exe: your
settings, your pinned apps, and the extracted icon cache. Copy the whole
folder to a USB stick and it moves with you.

Requirements
------------
Windows 10 1809 or later, or Windows 11, x64.

The WebView2 runtime has to be present. Windows 11 and current Windows 10
already ship it. If the window never appears, install it from
https://developer.microsoft.com/microsoft-edge/webview2/ and try again.

Notes
-----
Aero Dock lives in the system tray. Left click the tray icon to show or
hide the dock, right click for settings and quit.

"Start Aero Dock when I sign in" is the one setting that writes outside
this folder. It adds a registry entry pointing at wherever the exe is at
the time, so turn it off before you move the folder.

Uninstalling is deleting the folder.

Source and issues: https://github.com/TheAgencyMGE/aero-dock
"@ | Out-File (Join-Path $stage "README.txt") -Encoding utf8

Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force

$size = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Output "Built $zip ($size MB)"
