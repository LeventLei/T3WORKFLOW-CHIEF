<#
.SYNOPSIS
  为 Chief 场景配置面板创建 Windows 快捷方式。

.DESCRIPTION
  等价于 macOS 的 app/build-mac-app.sh：记录当前仓库路径和 node 路径，双击快捷方式
  会在后台启动 panel/server.mjs 并打开默认浏览器；面板已在运行时只打开页面。
  仓库移动或 node 换了安装位置后重跑本脚本即可；仓库里的代码更新不需要重新构建。

.PARAMETER Port
  面板端口，默认 4317。

.PARAMETER Name
  快捷方式名称，默认「Chief 配置面板」。

.PARAMETER Destination
  快捷方式输出目录，默认桌面；指定后不再看 -StartMenu。

.PARAMETER StartMenu
  生成到开始菜单「程序」而不是桌面。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File app/build-windows-shortcut.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File app/build-windows-shortcut.ps1 -StartMenu -Port 4318
#>
param(
    [int]$Port = 4317,
    [string]$Name = 'Chief 配置面板',
    [string]$Destination = '',
    [switch]$StartMenu
)

$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Windows only'
}

$repo = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $repo 'app/start-panel.ps1'
$server = Join-Path $repo 'panel/server.mjs'
foreach ($file in @($launcher, $server)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "missing file: $file" }
}

# GUI shortcuts do not inherit the shell PATH, so pin node's absolute path now.
$command = Get-Command node -ErrorAction SilentlyContinue
if (-not $command) {
    foreach ($candidate in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'hermes\node\node.exe')
    )) {
        if (Test-Path -LiteralPath $candidate) { $command = Get-Item -LiteralPath $candidate; break }
    }
}
if (-not $command) { throw 'node not found; install Node.js 18+ first' }
$node = if ($command.Source) { $command.Source } else { $command.FullName }
$version = (& $node -p 'process.versions.node').Trim()
$major = [int]($version.Split('.')[0])
if ($major -lt 18) { throw "node $version is too old (need 18+)" }

if (-not $Destination) {
    if ($StartMenu) {
        $Destination = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
    } else {
        $Destination = [Environment]::GetFolderPath('Desktop')
    }
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$shortcutPath = Join-Path $Destination "$Name.lnk"

$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher +
    '" -Port ' + $Port + ' -NodePath "' + $node + '"'
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $repo
$shortcut.IconLocation = "$node,0"
$shortcut.Description = "启动 Chief 场景配置面板 (http://127.0.0.1:$Port)"
$shortcut.Save()

Write-Host "Built: $shortcutPath"
Write-Host "  repo: $repo"
Write-Host "  node: $node ($version)"
