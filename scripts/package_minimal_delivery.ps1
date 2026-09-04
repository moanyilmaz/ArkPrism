param(
    [string]$Output = "delivery\ArkPrism-minimal-runtime-PAC-v2.zip",
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$delivery = (Resolve-Path (Join-Path $repo 'delivery')).Path
$outputPath = [IO.Path]::GetFullPath((Join-Path $repo $Output))
if (-not $outputPath.StartsWith($delivery, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Output must remain under $delivery"
}
if ((Test-Path -LiteralPath $outputPath) -and -not $Force) {
    throw "Output already exists: $outputPath"
}

$items = @(
    @{ Source = 'src'; Entry = 'src' },
    @{ Source = 'dist'; Entry = 'dist' },
    @{ Source = 'config'; Entry = 'config' },
    @{ Source = 'package.json'; Entry = 'package.json' },
    @{ Source = 'package-lock.json'; Entry = 'package-lock.json' },
    @{ Source = 'tsconfig.json'; Entry = 'tsconfig.json' },
    @{ Source = 'LICENSE'; Entry = 'LICENSE' },
    @{ Source = 'delivery\minimal-runtime-README.md'; Entry = 'README.md' },
    @{ Source = 'benchmarks\ArkPrismTop120\pac_v2\selection_manifest.json'; Entry = 'benchmark\selection_manifest.json' },
    @{ Source = 'benchmarks\ArkPrismTop120\pac_v2\review_queue.json'; Entry = 'benchmark\review_queue.json' },
    @{ Source = 'benchmarks\ArkPrismTop120\pac_v2\manual_review_decisions.json'; Entry = 'benchmark\manual_review_decisions.json' },
    @{ Source = 'benchmarks\ArkPrismTop120\pac_v2\gold.json'; Entry = 'benchmark\gold.json' },
    @{ Source = 'benchmarks\ArkPrismTop120\pac_v2\evaluation-api26-verified-20260904\source_first_evaluation.json'; Entry = 'benchmark\source_first_evaluation.json' },
    @{ Source = 'benchmarks\ArkPrismTop120\pac_v2\evaluation-api26-verified-20260904\source_first_evaluation.md'; Entry = 'benchmark\source_first_evaluation.md' }
)

$excludedDirectoryNames = @('docs', 'scripts', 'tests', 'node_modules')

function Test-ExcludedPath([string]$RelativePath) {
    $segments = $RelativePath.Replace('/', '\').Split(
        @('\'),
        [StringSplitOptions]::RemoveEmptyEntries
    )
    foreach ($segment in $segments) {
        if ($excludedDirectoryNames -contains $segment) {
            return $true
        }
    }
    return $false
}

function Add-File([IO.Compression.ZipArchive]$Archive, [string]$Source, [string]$EntryName) {
    $file = Get-Item -LiteralPath $Source
    $entry = $Archive.CreateEntry(
        ('ArkPrism/' + $EntryName.Replace('\', '/')),
        [IO.Compression.CompressionLevel]::Optimal
    )
    $entry.LastWriteTime = $file.LastWriteTime
    $input = $file.OpenRead()
    $target = $entry.Open()
    try {
        $input.CopyTo($target)
    } finally {
        $target.Dispose()
        $input.Dispose()
    }
}

$fileMode = if ($Force) { [IO.FileMode]::Create } else { [IO.FileMode]::CreateNew }
$stream = [IO.File]::Open($outputPath, $fileMode)
try {
    $archive = [IO.Compression.ZipArchive]::new(
        $stream,
        [IO.Compression.ZipArchiveMode]::Create,
        $false
    )
    try {
        foreach ($item in $items) {
            $source = Join-Path $repo $item.Source
            if (Test-Path -LiteralPath $source -PathType Container) {
                foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File) {
                    $relative = [IO.Path]::GetRelativePath($source, $file.FullName)
                    if (Test-ExcludedPath $relative) {
                        continue
                    }
                    Add-File $archive $file.FullName (Join-Path $item.Entry $relative)
                }
            } else {
                Add-File $archive $source $item.Entry
            }
        }
    } finally {
        $archive.Dispose()
    }
} finally {
    $stream.Dispose()
}

$result = Get-Item -LiteralPath $outputPath
$hash = Get-FileHash -LiteralPath $outputPath -Algorithm SHA256
[pscustomobject]@{
    Path = $result.FullName
    Bytes = $result.Length
    Sha256 = $hash.Hash
}
