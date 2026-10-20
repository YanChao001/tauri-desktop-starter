<#
.SYNOPSIS
预览或逐文件清理项目临时产物，保留正式分发与开发依赖。
.DESCRIPTION
默认只统计；指定 -Apply 才删除。逐层枚举普通目录，每次只删除一个普通文件，
最后只删除已空目录。不接受自定义路径，不跟随目录链接。
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Low')]
param([switch]$Apply)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw '此脚本仅支持 Windows PowerShell 或 Windows 上的 PowerShell。'
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$deleteFiles = $Apply -and -not $WhatIfPreference
$failures = [Collections.Generic.List[object]]::new()
$totals = [PSCustomObject]@{
    Files = 0L; Bytes = 0L; Directories = 0L
    DeletedFiles = 0L; DeletedBytes = 0L; DeletedDirectories = 0L
    SkippedLinks = 0L
}

# 仅允许固定生成目录；不扫描 node_modules 中的真实依赖。
$relativeTargets = @(
    'artifacts\branding',
    'artifacts\branding-preview',
    'artifacts\ci-review',
    'artifacts\content-bounce',
    'artifacts\e2e',
    'artifacts\git-history',
    'artifacts\pr',
    'artifacts\scroll-boundaries',
    'artifacts\site-publish',
    'artifacts\startup-diagnostics',
    'artifacts\ui-review',
    'dist',
    'dist-web',
    'dist-ssr',
    'dist-portable',
    'coverage',
    'src-tauri\target',
    'src-tauri\gen\schemas',
    'node_modules\.vite',
    'node_modules\.vite-temp',
    'node_modules\.cache'
)

function Add-CleanupFailure {
    param([string]$Path, [string]$Message)
    $failures.Add([PSCustomObject]@{ Path = $Path; Message = $Message })
    Write-Warning ("保留 {0}：{1}" -f $Path, $Message)
}

function Assert-CleanupPath {
    param([string]$Path, [string]$AllowedRoot)

    $absolute = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $allowed = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\')
    $comparison = [StringComparison]::OrdinalIgnoreCase
    if (-not $allowed.StartsWith($projectRoot + '\', $comparison) -or
        ($absolute -ne $allowed -and -not $absolute.StartsWith($allowed + '\', $comparison))) {
        throw "路径不在预定义的项目清理范围：$absolute"
    }

    # 连同工作区以上的每级祖先一起检查，防止 junction 将路径导向别处。
    $ancestor = $absolute
    while ($ancestor) {
        if (([IO.File]::GetAttributes($ancestor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            $totals.SkippedLinks++
            throw "发现目录或文件链接，未跟随：$ancestor"
        }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
}

function Get-BlockingProcess {
    param([string]$AllowedRoot)

    # 只按可执行文件路径匹配；安装在项目外的应用不会被停止或修改。
    @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith(
            $AllowedRoot + '\', [StringComparison]::OrdinalIgnoreCase
        )
    } | Select-Object ProcessId, ExecutablePath)
}

function Get-PortableBackupTargets {
    $artifactRoot = Join-Path $projectRoot 'artifacts'
    try {
        $artifactInfo = Get-Item -Force -LiteralPath $artifactRoot -ErrorAction Stop
    } catch [System.Management.Automation.ItemNotFoundException] {
        return
    } catch {
        Add-CleanupFailure $artifactRoot $_.Exception.Message
        return
    }

    try {
        Assert-CleanupPath $artifactRoot $artifactRoot
        if (-not $artifactInfo.PSIsContainer) { throw '分发目录不是普通目录。' }
        foreach ($version in @(Get-ChildItem -Force -LiteralPath $artifactRoot -Directory -ErrorAction Stop)) {
            # 只识别版本目录；不进入临时诊断目录或不符合分发布局的内容。
            if ($version.Name -cnotmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') { continue }
            try {
                Assert-CleanupPath $version.FullName $artifactRoot
                foreach ($platform in @(Get-ChildItem -Force -LiteralPath $version.FullName -Directory -ErrorAction Stop)) {
                    # 与 artifact-lib.mjs 的目标平台路径段约束一致。
                    if ($platform.Name -cnotmatch '^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$') { continue }
                    try {
                        Assert-CleanupPath $platform.FullName $artifactRoot
                        foreach ($backup in @(Get-ChildItem -Force -LiteralPath $platform.FullName -Directory -ErrorAction Stop)) {
                            if ($backup.Name -cmatch '^\.portable-previous-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
                                Assert-CleanupPath $backup.FullName $artifactRoot
                                $backup.FullName.Substring($projectRoot.Length + 1)
                            }
                        }
                    } catch {
                        Add-CleanupFailure $platform.FullName $_.Exception.Message
                    }
                }
            } catch {
                Add-CleanupFailure $version.FullName $_.Exception.Message
            }
        }
    } catch {
        Add-CleanupFailure $artifactRoot $_.Exception.Message
    }
}

Write-Output $(if ($deleteFiles) {
    '开始逐文件清理；不会停止进程，不会使用递归删除。'
} else {
    '预览模式：不会删除任何文件。确认范围后使用 -Apply；-WhatIf 始终只预览。'
})
Write-Output "项目目录：$projectRoot"
$relativeTargets += @(Get-PortableBackupTargets)

foreach ($relativeTarget in $relativeTargets) {
    $target = [IO.Path]::GetFullPath((Join-Path $projectRoot $relativeTarget))
    try {
        $targetInfo = Get-Item -Force -LiteralPath $target -ErrorAction Stop
    } catch [System.Management.Automation.ItemNotFoundException] {
        continue
    } catch {
        Add-CleanupFailure $target $_.Exception.Message
        continue
    }

    try {
        Assert-CleanupPath $target $target
        if (-not $targetInfo.PSIsContainer) { throw '预定义清理目标应为目录，已保留。' }
        $blockingProcesses = @(Get-BlockingProcess $target)
        if ($blockingProcesses.Count -gt 0) {
            throw ('存在运行中的项目内程序，未清理此目录：' +
                (($blockingProcesses | ForEach-Object { "PID $($_.ProcessId) $($_.ExecutablePath)" }) -join '；'))
        }
    } catch {
        Add-CleanupFailure $target $_.Exception.Message
        continue
    }

    $startFiles = $totals.Files
    $startBytes = $totals.Bytes
    $pending = [Collections.Generic.Stack[object]]::new()
    $pending.Push([PSCustomObject]@{ Path = $target; Visited = $false })

    # 手动栈保证先处理文件、后处理目录；每次只枚举当前目录这一层。
    while ($pending.Count -gt 0) {
        $entry = $pending.Pop()
        try {
            Assert-CleanupPath $entry.Path $target
            $info = Get-Item -Force -LiteralPath $entry.Path -ErrorAction Stop
            if ($info.PSIsContainer) {
                if (-not $entry.Visited) {
                    $totals.Directories++
                    $pending.Push([PSCustomObject]@{ Path = $entry.Path; Visited = $true })
                    foreach ($child in @(Get-ChildItem -Force -LiteralPath $entry.Path -ErrorAction Stop)) {
                        $pending.Push([PSCustomObject]@{ Path = $child.FullName; Visited = $false })
                    }
                } elseif ($deleteFiles -and $PSCmdlet.ShouldProcess($entry.Path, '删除空目录')) {
                    Assert-CleanupPath $entry.Path $target
                    if (@(Get-ChildItem -Force -LiteralPath $entry.Path -ErrorAction Stop).Count -gt 0) {
                        throw '目录仍有未删除条目，已保留。'
                    }
                    [IO.Directory]::Delete($entry.Path, $false)
                    $totals.DeletedDirectories++
                }
            } else {
                $fileBytes = $info.Length
                $totals.Files++
                $totals.Bytes += $fileBytes
                if ($deleteFiles -and $PSCmdlet.ShouldProcess($entry.Path, '删除普通临时文件')) {
                    Assert-CleanupPath $entry.Path $target
                    Remove-Item -LiteralPath $entry.Path -Force -Confirm:$false -ErrorAction Stop
                    $totals.DeletedFiles++
                    $totals.DeletedBytes += $fileBytes
                }
            }
        } catch {
            Add-CleanupFailure $entry.Path $_.Exception.Message
        }
    }

    Write-Output ("{0}：{1:N0} 个文件，{2:N0} 字节" -f
        $relativeTarget, ($totals.Files - $startFiles), ($totals.Bytes - $startBytes))
}

Write-Output ("扫描合计：{0:N0} 个文件，{1:N0} 个目录，{2:N0} 字节（{3:N2} GiB）。" -f
    $totals.Files, $totals.Directories, $totals.Bytes, ($totals.Bytes / 1GB))
if ($deleteFiles) {
    Write-Output ("已删除：{0:N0} 个文件，{1:N0} 个空目录，{2:N0} 字节。" -f
        $totals.DeletedFiles, $totals.DeletedDirectories, $totals.DeletedBytes)
}
Write-Output ("跳过链接：{0:N0}；失败：{1:N0}。正式版本分发和依赖目录均保留。" -f
    $totals.SkippedLinks, $failures.Count)
if ($failures.Count -gt 0) { exit 1 }
