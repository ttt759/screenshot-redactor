$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root 'release/lightweight/win-unpacked'
$package = Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json
$version = $package.version
$buildVersion = $package.build.buildVersion
$sdkVersion = '1.0.4314.35'
$sdkHash = '90778DEB1B77E36292828B4B5833C9255C27533F40E0DDD55891AE718944EDC4'
$sdkCache = Join-Path ([IO.Path]::GetTempPath()) "screenshot-redactor-webview2-$sdkVersion"
$archive = Join-Path $sdkCache 'sdk.zip'
if (Test-Path -LiteralPath $output) {
    $expected = Join-Path (Resolve-Path -LiteralPath $root).Path 'release/lightweight/win-unpacked'
    $target = Get-Item -LiteralPath $output
    if ($target.FullName -ne [IO.Path]::GetFullPath($expected) -or
        ($target.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        ($target.Parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        ($target.Parent.Parent.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected desktop build directory' }
    Remove-Item -LiteralPath $target.FullName -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $sdkCache, $output | Out-Null
if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $sdkHash) {
    $uri = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg"
    curl.exe --fail --location --silent --show-error --retry 2 --max-time 150 $uri -o $archive
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $sdkHash) { throw 'WebView2 SDK checksum mismatch' }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    foreach ($file in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll')) {
        [IO.Compression.ZipFileExtensions]::ExtractToFile($zip.GetEntry("lib/net462/$file"), (Join-Path $output $file), $true)
    }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($zip.GetEntry('build/native/x64/WebView2Loader.dll'), (Join-Path $output 'WebView2Loader.dll'), $true)
    [IO.Compression.ZipFileExtensions]::ExtractToFile($zip.GetEntry('LICENSE.txt'), (Join-Path $output 'WebView2.LICENSE.txt'), $true)
} finally {
    $zip.Dispose()
}

$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$metadata = Join-Path $sdkCache "version-$buildVersion.cs"
@"
[assembly: System.Reflection.AssemblyVersion("$buildVersion.0")]
[assembly: System.Reflection.AssemblyFileVersion("$buildVersion.0")]
"@ | Set-Content -LiteralPath $metadata -Encoding UTF8
$icon = Join-Path $root 'desktop/icon.ico'
$manifest = Join-Path $root 'desktop/app.manifest'
$exe = Join-Path $output 'ScreenshotRedactor.exe'
& $compiler /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ "/out:$exe" "/win32icon:$icon" "/win32manifest:$manifest" `
    /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
    "/reference:$(Join-Path $output 'Microsoft.Web.WebView2.Core.dll')" "/reference:$(Join-Path $output 'Microsoft.Web.WebView2.WinForms.dll')" `
    (Join-Path $root 'desktop/Program.cs') (Join-Path $root 'desktop/RegionCapture.cs') (Join-Path $root 'desktop/CaptureHotkeys.cs') $metadata
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Copy-Item -LiteralPath (Join-Path $root 'docs') -Destination $output -Recurse -Force
$portable = Join-Path (Split-Path $output -Parent) "screenshot-redactor-portable-$version-windows-x64.zip"
if (Test-Path -LiteralPath $portable) { Remove-Item -LiteralPath $portable -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($output, $portable, [IO.Compression.CompressionLevel]::Optimal, $false)
Write-Output $exe
Write-Output $portable
