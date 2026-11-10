<#
.SYNOPSIS
  Chief 场景配置面板启动器（Windows）。

.DESCRIPTION
  在后台启动 panel/server.mjs 并打开默认浏览器；面板已经在运行时只打开页面。
  一般由 app/build-windows-shortcut.ps1 生成的快捷方式调用，也可以直接运行：

    powershell -NoProfile -File app/start-panel.ps1
    powershell -NoProfile -File app/start-panel.ps1 -Port 4318 -NoBrowser

  日志写到 %USERPROFILE%\.chief-t3\panel.log（错误在 panel.log.err）。
#>
param(
    [int]$Port = 4317,
    [string]$NodePath = '',
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$server = Join-Path $repo 'panel/server.mjs'
$dataDir = Join-Path $env:USERPROFILE '.chief-t3'
$log = Join-Path $dataDir 'panel.log'
$url = "http://127.0.0.1:$Port"

function Show-PanelError([string]$message) {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($message, 'Chief 配置面板')
}

function Test-Panel {
    try {
        (Invoke-WebRequest -Uri "$url/api/state" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200
    } catch {
        $false
    }
}

if (-not (Test-Path -LiteralPath $server)) {
    Show-PanelError "找不到面板服务：$server`n仓库可能被移动了，请重跑 app/build-windows-shortcut.ps1。"
    exit 1
}

if (-not (Test-Panel)) {
    $node = $null
    if ($NodePath -and (Test-Path -LiteralPath $NodePath)) {
        $node = $NodePath
    }
    if (-not $node) {
        $command = Get-Command node -ErrorAction SilentlyContinue
        if ($command) { $node = $command.Source }
    }
    if (-not $node) {
        foreach ($candidate in @(
            (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
            (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
            (Join-Path $env:LOCALAPPDATA 'hermes\node\node.exe')
        )) {
            if (Test-Path -LiteralPath $candidate) { $node = $candidate; break }
        }
    }
    if (-not $node) {
        Show-PanelError '找不到 node，请安装 Node.js（18+）或把它加入 PATH，然后重跑 app/build-windows-shortcut.ps1。'
        exit 1
    }

    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    Start-Process -FilePath $node `
        -ArgumentList 'panel/server.mjs', '--port', "$Port" `
        -WorkingDirectory $repo `
        -WindowStyle Hidden `
        -RedirectStandardOutput $log `
        -RedirectStandardError ($log + '.err')

    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        if (Test-Panel) { break }
    }
    if (-not (Test-Panel)) {
        Show-PanelError "面板没有在 $url 上启动成功。`n日志：$log`n$log.err"
        exit 1
    }
}

if (-not $NoBrowser) { Start-Process $url }
