using System;
using System.IO;
using System.IO.Compression;
using System.Text;

internal static class UpdateReleaseTest
{
    private const string Digest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

    private static void Main()
    {
        var current = new Version(0, 1, 4);
        var build = new Version(0, 3, 18);
        var installed = UpdateRelease.Parse(Release("v0.2", "0.2.0", "0.3.19"), current, build, false);
        Check(installed.Version == new Version(0, 2, 0) && installed.Name.EndsWith(".exe"), "installer on newer release");
        var portable = UpdateRelease.Parse(Release("v0.2", "0.2.0", "0.3.19"), current, build, true);
        Check(portable.Name.EndsWith(".zip"), "portable on newer release");
        Check(UpdateRelease.Parse(Release("v0.1.4", "0.1.4", "0.3.19"), current, build, true) != null, "newer build of same release");
        Check(UpdateRelease.Parse(Release("v0.1.4", "0.1.4", "0.3.18"), current, build, true) == null, "same build");
        Check(UpdateRelease.Parse(Release("v0.1.3", "0.1.3", "0.9.0"), current, build, false) == null, "no downgrade");
        Reject(() => UpdateRelease.Parse(Release("v0.2", "0.2.0", "0.3.19").Replace("github.com/ttt759", "example.com/ttt759"), current, build, true), "foreign download host");
        Reject(() => UpdateRelease.Parse(Release("v0.2", "0.2.0", "0.3.19").Replace(Digest, "unknown"), current, build, false), "missing digest");
        using (var data = new MemoryStream(Encoding.UTF8.GetBytes("modified package")))
            Reject(() => UpdatePayload.Verify(data, installed), "payload mismatch");
        var root = Path.Combine(Path.GetTempPath(), "redactor-update-probe-" + Guid.NewGuid().ToString("N"));
        try
        {
            var names = new[] { "ScreenshotRedactor.exe", "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll",
                "WebView2Loader.dll", "docs/index.html", "docs/.nojekyll" };
            using (var zip = Archive(names))
                Check(File.Exists(UpdatePayload.ExtractPortable(zip, root)), "complete portable extraction");
            using (var zip = Archive(new[] { "docs/../bad.txt" }))
                Reject(() => UpdatePayload.ExtractPortable(zip, root), "path traversal");
            Check(!File.Exists(Path.Combine(root, "bad.txt")), "unsafe entry was not written");
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
        Console.WriteLine("Release detection, installer/portable selection, update trust, downgrade and extraction checks passed.");
    }

    private static MemoryStream Archive(string[] names)
    {
        var bytes = new MemoryStream();
        using (var zip = new ZipArchive(bytes, ZipArchiveMode.Create, true))
            foreach (var name in names)
                using (var output = zip.CreateEntry(name).Open()) output.WriteByte(42);
        bytes.Position = 0;
        return bytes;
    }

    private static string Release(string tag, string version, string build)
    {
        return "{\"tag_name\":\"" + tag + "\",\"draft\":false,\"prerelease\":false,\"body\":\"<!-- screenshot-redactor-build: " + build + " -->\",\"assets\":[" +
            Asset(tag, "screenshot-redactor-setup-" + version + "-windows-x64.exe") + "," +
            Asset(tag, "screenshot-redactor-portable-" + version + "-windows-x64.zip") + "]}";
    }

    private static string Asset(string tag, string name)
    {
        return "{\"name\":\"" + name + "\",\"state\":\"uploaded\",\"size\":16,\"digest\":\"" + Digest +
            "\",\"browser_download_url\":\"https://github.com/ttt759/screenshot-redactor/releases/download/" + tag + "/" + name + "\"}";
    }

    private static void Check(bool condition, string title) { if (!condition) throw new Exception(title); }
    private static void Reject(Action action, string title)
    {
        try { action(); }
        catch (InvalidDataException) { return; }
        throw new Exception("Expected rejection: " + title);
    }
}
