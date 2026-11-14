$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$target = Join-Path ([IO.Path]::GetTempPath()) ('redactor-native-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
    & $compiler /nologo /codepage:65001 /target:exe /platform:x64 "/out:$target" `
        /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
        (Join-Path $root 'desktop/RegionCapture.cs') (Join-Path $root 'desktop/CaptureWindows.cs') `
        (Join-Path $root 'desktop/CaptureClipboard.cs') (Join-Path $root 'tests/native-capture.cs')
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    & $target
    exit $LASTEXITCODE
} finally {
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
}
