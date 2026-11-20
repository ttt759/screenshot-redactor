using System;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
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
        Check(installed.SignatureName == installed.Name + ".sig", "signature asset name");
        var portable = UpdateRelease.Parse(Release("v0.2", "0.2.0", "0.3.19"), current, build, true);
        Check(portable.Name.EndsWith(".zip") && portable.SignatureName == portable.Name + ".sig", "portable on newer release");
        Check(UpdateRelease.Parse(Release("v0.1.4", "0.1.4", "0.3.19"), current, build, true) != null, "newer build of same release");
        Check(UpdateRelease.Parse(Release("v0.1.4", "0.1.4", "0.3.18"), current, build, true) == null, "same build");
        Check(UpdateRelease.Parse(Release("v0.1.3", "0.1.3", "0.9.0"), current, build, false) == null, "no downgrade");
        Reject(() => UpdateRelease.Parse(Release("v0.2", "0.2.0", "0.3.19").Replace("github.com/ttt759", "example.com/ttt759"), current, build, true), "foreign download host");
        Reject(() => UpdateRelease.Parse(Release("v0.2", "0.2.0", "0.3.19").Replace(Digest, "unknown"), current, build, false), "missing digest");
        Reject(() => UpdateRelease.Parse(Release("v0.2", "0.2.0", "0.3.19").Replace(".exe.sig", ".exe.other"), current, build, false), "missing signature asset");

        var payloadBytes = Encoding.UTF8.GetBytes("verified update package");
        using (var rsa = new RSACryptoServiceProvider(2048))
        {
            rsa.PersistKeyInCsp = false;
            var publicKeyXml = rsa.ToXmlString(false);
            string digestHex;
            byte[] sigBytes;
            using (var sha = SHA256.Create())
            {
                var hash = sha.ComputeHash(payloadBytes);
                digestHex = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
                sigBytes = rsa.SignHash(hash, CryptoConfig.MapNameToOID("SHA256"));
            }
            var sigBase64 = Convert.ToBase64String(sigBytes);
            var signedRelease = UpdateRelease.Parse(
                Release("v0.2", "0.2.0", "0.3.19", "sha256:" + digestHex, payloadBytes.Length),
                current, build, false);
            using (var data = new MemoryStream(payloadBytes))
            {
                UpdatePayload.Verify(data, signedRelease, sigBase64, publicKeyXml);
                Check(data.Position == 0, "Verify resets stream position");
            }
            using (var tampered = new MemoryStream(Encoding.UTF8.GetBytes("tampered update package")))
                Reject(() => UpdatePayload.Verify(tampered, signedRelease, sigBase64, publicKeyXml), "payload mismatch");
            using (var data = new MemoryStream(payloadBytes))
                Reject(() => UpdatePayload.Verify(data, signedRelease, Convert.ToBase64String(new byte[256]), publicKeyXml), "signature mismatch");
            using (var data = new MemoryStream(payloadBytes))
                Reject(() => UpdatePayload.Verify(data, signedRelease, "not-valid-base64!", publicKeyXml), "invalid signature format");
            using (var data = new MemoryStream(payloadBytes))
                Reject(() => UpdatePayload.Verify(data, signedRelease, sigBase64, UpdateRelease.PublicKeyXml), "wrong public key");
        }

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
        Console.WriteLine("Release detection, RSA-2048 signature verification, installer/portable selection, update trust, downgrade and extraction checks passed.");
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

    private static string Release(string tag, string version, string build, string digest = Digest, long size = 16)
    {
        var setup = "screenshot-redactor-setup-" + version + "-windows-x64.exe";
        var portable = "screenshot-redactor-portable-" + version + "-windows-x64.zip";
        return "{\"tag_name\":\"" + tag + "\",\"draft\":false,\"prerelease\":false,\"body\":\"<!-- screenshot-redactor-build: " + build + " -->\",\"assets\":[" +
            Asset(tag, setup, digest, size) + "," +
            Asset(tag, setup + ".sig", Digest, 344) + "," +
            Asset(tag, portable, digest, size) + "," +
            Asset(tag, portable + ".sig", Digest, 344) + "]}";
    }

    private static string Asset(string tag, string name, string digest, long size)
    {
        return "{\"name\":\"" + name + "\",\"state\":\"uploaded\",\"size\":" + size + ",\"digest\":\"" + digest +
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
