$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$target = Join-Path ([IO.Path]::GetTempPath()) ('redactor-update-test-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
    & $compiler /nologo /codepage:65001 /target:exe /platform:x64 "/out:$target" `
        /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll `
        (Join-Path $root 'desktop/UpdateRelease.cs') (Join-Path $root 'tests/update-release.cs')
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    & $target
    exit $LASTEXITCODE
} finally {
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
}
