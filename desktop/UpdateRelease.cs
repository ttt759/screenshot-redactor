using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal sealed class UpdateRelease
{
    internal const string Repository = "ttt759/screenshot-redactor";
    internal const long Limit = 30000000;
    internal const long SignatureLimit = 4096;
    // Matches GitHub Actions secret UPDATE_SIGNING_KEY.
    internal const string PublicKeyXml = "<RSAKeyValue><Modulus>i3/i3ZmdYLaJ3uMVHhJQv2ZYEpDTaPlojAX9AkdHYKg+aYLMWdCCmqfRT5jEJjPrpfaXt5T1JpUhMgn0/W/beD3rWnl+FPHWs3wm8zpEWN8ojwbd31Oc1/OXJRxJ6x4xHEQvUszTOmtZijOYvCgpFZ5TX72djtPxEJ99ROhlpJ/YnMdJQK6W6KnZKzIJ3dJx7292dZJ40UYnj0mGX+RDO+29SiLTDNLIaG5An4GdI2ZltDkJ1UV0xuoVbLGfAe2OTLuUseS0X8Y4ePov1Iolbg5kDfA13LGfoBMEBwQdjdhjPil9DLVDfENLvkBkpEA15zLJOlRqq4YHs0BBbYxmQw==</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>";
    internal readonly Version Version;
    internal readonly string Name, Digest, SignatureName;
    internal readonly Uri Url, SignatureUrl;
    internal readonly long Size, SignatureSize;

    private UpdateRelease(Version version, string name, string digest, Uri url, long size, string signatureName, Uri signatureUrl, long signatureSize)
    {
        Version = version;
        Name = name;
        Digest = digest;
        Url = url;
        Size = size;
        SignatureName = signatureName;
        SignatureUrl = signatureUrl;
        SignatureSize = signatureSize;
    }

    internal static UpdateRelease Parse(string json, Version current, Version currentBuild, bool portable)
    {
        var release = new JavaScriptSerializer { MaxJsonLength = 524288, RecursionLimit = 24 }.Deserialize<Release>(json);
        Version version;
        var tag = release == null ? null : release.tag_name;
        if (tag == null || !Regex.IsMatch(tag, @"\Av(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))?\z") ||
            !Version.TryParse(tag.Substring(1), out version) || release.draft || release.prerelease) return null;
        if (version.Build < 0) version = new Version(version.Major, version.Minor, 0);
        if (version < current) return null;
        if (version == current)
        {
            var marker = Regex.Match(release.body ?? "", @"<!-- screenshot-redactor-build: ([0-9]+\.[0-9]+\.[0-9]+) -->");
            Version build;
            if (!marker.Success || !Version.TryParse(marker.Groups[1].Value, out build) || build <= currentBuild) return null;
        }

        var name = "screenshot-redactor-" + (portable ? "portable-" : "setup-") + version.ToString(3) +
            "-windows-x64." + (portable ? "zip" : "exe");
        var url = "https://github.com/" + Repository + "/releases/download/" + tag + "/" + name;
        var assets = release.assets ?? new Asset[0];
        var matching = assets.Where(asset => asset != null && asset.name == name).ToArray();
        if (matching.Length != 1) throw new InvalidDataException("Missing or ambiguous update package.");
        var file = matching[0];
        if (file.state != "uploaded" || file.size <= 0 || file.size > Limit || file.browser_download_url != url ||
            !Regex.IsMatch(file.digest ?? "", @"\Asha256:[0-9a-fA-F]{64}\z"))
            throw new InvalidDataException("Invalid update package metadata.");

        var signatureName = name + ".sig";
        var signatureUrl = url + ".sig";
        var matchingSig = assets.Where(asset => asset != null && asset.name == signatureName).ToArray();
        if (matchingSig.Length != 1) throw new InvalidDataException("Missing or ambiguous update signature.");
        var signatureFile = matchingSig[0];
        if (signatureFile.state != "uploaded" || signatureFile.size <= 0 || signatureFile.size > SignatureLimit ||
            signatureFile.browser_download_url != signatureUrl)
            throw new InvalidDataException("Invalid update signature metadata.");

        return new UpdateRelease(version, name, file.digest.Substring(7), new Uri(url), file.size,
            signatureName, new Uri(signatureUrl), signatureFile.size);
    }

    public sealed class Release
    {
        public string tag_name { get; set; }
        public string body { get; set; }
        public bool draft { get; set; }
        public bool prerelease { get; set; }
        public Asset[] assets { get; set; }
    }

    public sealed class Asset
    {
        public string name { get; set; }
        public string state { get; set; }
        public long size { get; set; }
        public string digest { get; set; }
        public string browser_download_url { get; set; }
    }
}

internal static class UpdatePayload
{
    internal static void Verify(Stream file, UpdateRelease release, string signature, string publicKeyXml = UpdateRelease.PublicKeyXml)
    {
        if (file.Length != release.Size) throw new InvalidDataException("Incomplete update package.");
        file.Position = 0;
        if (!string.Equals(Hash(file), release.Digest, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Update checksum mismatch.");
        file.Position = 0;
        VerifySignature(file, signature, publicKeyXml);
        file.Position = 0;
    }

    internal static void VerifySignature(Stream file, string signature, string publicKeyXml = UpdateRelease.PublicKeyXml)
    {
        if (string.IsNullOrWhiteSpace(signature)) throw new InvalidDataException("Missing update signature.");
        byte[] signatureBytes;
        try { signatureBytes = Convert.FromBase64String(signature.Trim()); }
        catch (FormatException) { throw new InvalidDataException("Invalid update signature format."); }
        if (signatureBytes.Length != 256) throw new InvalidDataException("Invalid update signature length.");

        using (var rsa = new RSACryptoServiceProvider())
        {
            rsa.PersistKeyInCsp = false;
            try { rsa.FromXmlString(publicKeyXml); }
            catch (Exception error) { throw new InvalidDataException("Invalid update signing key.", error); }
            if (rsa.KeySize != 2048) throw new InvalidDataException("Invalid update signing key size.");
            using (var sha = SHA256.Create())
            {
                var hash = sha.ComputeHash(file);
                if (!rsa.VerifyHash(hash, CryptoConfig.MapNameToOID("SHA256"), signatureBytes))
                    throw new InvalidDataException("Update signature mismatch.");
            }
        }
    }

    internal static string Hash(Stream file)
    {
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "");
    }

    internal static string ExtractPortable(Stream file, string directory)
    {
        using (var archive = new ZipArchive(file, ZipArchiveMode.Read, true))
        {
            if (archive.Entries.Count > 128 || archive.Entries.Sum(entry => entry.Length) > 40000000)
                throw new InvalidDataException("Portable package is too large.");
            foreach (var entry in archive.Entries)
            {
                var parts = entry.FullName.Split('/');
                if ((parts.Length > 1 && parts[0] != "docs") || parts.Any(part =>
                    !Regex.IsMatch(part, @"\A[A-Za-z0-9_.-]+\z") || part.EndsWith(".") ||
                    Regex.IsMatch(part, @"\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|\z)", RegexOptions.IgnoreCase)))
                    throw new InvalidDataException("Invalid path in portable package.");
                var path = Path.Combine(directory, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                using (var input = entry.Open())
                using (var target = new FileStream(path, FileMode.CreateNew, FileAccess.Write)) input.CopyTo(target);
            }
        }
        foreach (var required in new[] { "ScreenshotRedactor.exe", "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll", "docs/index.html" })
            if (!File.Exists(Path.Combine(directory, required))) throw new InvalidDataException("Incomplete portable package.");
        return Path.Combine(directory, "ScreenshotRedactor.exe");
    }
}
