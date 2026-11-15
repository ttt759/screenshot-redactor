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
    internal readonly Version Version;
    internal readonly string Name, Digest;
    internal readonly Uri Url;
    internal readonly long Size;

    private UpdateRelease(Version version, string name, string digest, Uri url, long size)
    {
        Version = version;
        Name = name;
        Digest = digest;
        Url = url;
        Size = size;
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
        var matching = (release.assets ?? new Asset[0]).Where(asset => asset != null && asset.name == name).ToArray();
        if (matching.Length != 1) throw new InvalidDataException("Missing or ambiguous update package.");
        var file = matching[0];
        if (file.state != "uploaded" || file.size <= 0 || file.size > Limit || file.browser_download_url != url ||
            !Regex.IsMatch(file.digest ?? "", @"\Asha256:[0-9a-fA-F]{64}\z"))
            throw new InvalidDataException("Invalid update package metadata.");
        return new UpdateRelease(version, name, file.digest.Substring(7), new Uri(url), file.size);
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
    internal static void Verify(Stream file, UpdateRelease release)
    {
        if (file.Length != release.Size) throw new InvalidDataException("Incomplete update package.");
        if (!string.Equals(Hash(file), release.Digest, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Update checksum mismatch.");
        file.Position = 0;
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
