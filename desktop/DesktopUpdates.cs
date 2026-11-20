using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

internal sealed class DesktopUpdates
{
    private static readonly Uri Latest = new Uri("https://api.github.com/repos/" + UpdateRelease.Repository + "/releases/latest");
    private static readonly HttpClient Client = new HttpClient(new HttpClientHandler {
        AllowAutoRedirect = false, UseCookies = false, SslProtocols = System.Security.Authentication.SslProtocols.Tls12
    });
    private static readonly string DataFolder = Path.Combine(Environment.GetEnvironmentVariable("SCREENSHOT_REDACTOR_TEST_PROFILE") ??
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScreenshotRedactor");
    private static ProcessStartInfo pendingLaunch;
    private static string pendingPortable;
    private readonly Form window;
    private readonly CoreWebView2 browser;
    private readonly string home;
    private readonly bool portable;
    private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    private bool ready, busy, launched;
    private UpdateRelease offered;
    private string stagedFolder, executable, expectedExecutableHash;

    internal static void Attach(Form window, CoreWebView2 browser, string home)
    {
        var update = new DesktopUpdates(window, browser, home);
        browser.WebMessageReceived += update.Receive;
        window.FormClosed += (sender, args) => update.Close();
    }

    internal static void StartPendingUpdate()
    {
        if (pendingLaunch == null) return;
        try
        {
            using (var process = Process.Start(pendingLaunch))
                if (process == null) throw new InvalidOperationException();
            if (pendingPortable != null) SavePortableLink(pendingPortable);
        }
        catch (Exception)
        {
            MessageBox.Show("无法启动更新。请重新打开截图脱敏助手后再试。", "安装更新", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    internal static bool TryStartUpdatedPortable()
    {
        if (IsInstalled(Application.StartupPath)) return false;
        try
        {
            var record = File.ReadAllLines(PortableLink());
            if (record.Length != 2 || !Regex.IsMatch(record[0], @"\Av[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{32}\z")) return false;
            var next = Path.Combine(DataFolder, "Portable", record[0], "ScreenshotRedactor.exe");
            if (string.Equals(next, Application.ExecutablePath, StringComparison.OrdinalIgnoreCase)) return false;
            using (var app = File.OpenRead(next))
                if (!string.Equals(UpdatePayload.Hash(app), record[1], StringComparison.Ordinal)) return false;
            var details = FileVersionInfo.GetVersionInfo(next);
            Version product, build;
            if (!Version.TryParse(details.ProductVersion, out product) || !Version.TryParse(details.FileVersion, out build)) return false;
            var current = new Version(DesktopBuild.Version);
            if (product < current || (product == current && build <= new Version(DesktopBuild.Build + ".0"))) return false;
            using (var process = Process.Start(new ProcessStartInfo(next) {
                WorkingDirectory = Path.GetDirectoryName(next), UseShellExecute = true
            })) return process != null;
        }
        catch (Exception) { return false; }
    }

    private static string PortableLink()
    {
        using (var path = new MemoryStream(Encoding.UTF8.GetBytes(Application.ExecutablePath.ToUpperInvariant())))
            return Path.Combine(DataFolder, "Portable", UpdatePayload.Hash(path) + ".link");
    }

    private static void SavePortableLink(string file)
    {
        var link = PortableLink();
        var temporary = link + "." + Guid.NewGuid().ToString("N");
        try
        {
            string digest;
            using (var app = File.OpenRead(file)) digest = UpdatePayload.Hash(app);
            File.WriteAllLines(temporary, new[] { Path.GetFileName(Path.GetDirectoryName(file)), digest });
            if (File.Exists(link)) File.Replace(temporary, link, null);
            else File.Move(temporary, link);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        finally { try { File.Delete(temporary); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
    }

    private DesktopUpdates(Form window, CoreWebView2 browser, string home)
    {
        this.window = window;
        this.browser = browser;
        this.home = home;
        portable = !IsInstalled(Application.StartupPath);
    }

    private static bool IsInstalled(string folder)
    {
        const string installKey = @"Software\23211e6a-7ded-5407-9a11-dda71d8a48b1";
        try
        {
            using (var key = Registry.CurrentUser.OpenSubKey(installKey))
            {
                var path = key == null ? null : key.GetValue("InstallLocation") as string;
                return !string.IsNullOrWhiteSpace(path) && string.Equals(Path.GetFullPath(path).TrimEnd('\\'),
                    Path.GetFullPath(folder).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
            }
        }
        catch (System.Security.SecurityException) { return false; }
        catch (ArgumentException) { return false; }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }

    private async void Receive(object sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (args.Source != home || lifetime.IsCancellationRequested) return;
        string message;
        try { message = args.TryGetWebMessageAsString(); }
        catch (ArgumentException) { return; }
        if (message == "updates-ready" && !ready)
        {
            ready = true;
            await Check(false);
        }
        else if (message == "updates-check") await Check(true);
        else if (message == "updates-download") await Download();
        else if (message == "updates-retry" && !busy)
        {
            await Check(true);
            if (offered != null) await Download();
        }
        else if (message == "updates-launch") Launch();
    }

    private void Send(string state, string detail = "")
    {
        if (!lifetime.IsCancellationRequested && !window.IsDisposed && browser.Source == home)
            browser.PostWebMessageAsString("updates|" + state + "|" + detail);
    }

    private async Task Check(bool manual)
    {
        if (busy || executable != null) return;
        busy = true;
        Send("checking");
        try
        {
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token))
            {
                timeout.CancelAfter(TimeSpan.FromSeconds(12));
                using (var response = await Get(Latest, false, timeout.Token))
                using (var data = new MemoryStream())
                {
                    await Copy(response, data, 524288, timeout.Token);
                    offered = UpdateRelease.Parse(Encoding.UTF8.GetString(data.ToArray()), new Version(DesktopBuild.Version),
                        new Version(DesktopBuild.Build), portable);
                }
            }
            Send(offered != null ? "available" : manual ? "current" : "idle",
                offered == null ? DesktopBuild.Version : offered.Version.ToString(3));
        }
        catch (Exception)
        {
            offered = null;
            Send(manual ? "check-failed" : "idle", DesktopBuild.Version);
        }
        finally { busy = false; }
    }

    private async Task Download()
    {
        if (busy || offered == null || executable != null) return;
        busy = true;
        Send("downloading");
        var id = Guid.NewGuid().ToString("N");
        var downloadFolder = Path.Combine(DataFolder, "Updates", id);
        var portableFolder = portable ? Path.Combine(DataFolder, "Portable", "v" + offered.Version.ToString(3) + "-" + id) : null;
        try
        {
            Directory.CreateDirectory(downloadFolder);
            var downloaded = Path.Combine(downloadFolder, offered.Name);
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token))
            {
                timeout.CancelAfter(TimeSpan.FromMinutes(2));
                string signatureText;
                using (var sigResponse = await Get(offered.SignatureUrl, true, timeout.Token))
                using (var sigData = new MemoryStream())
                {
                    await Copy(sigResponse, sigData, offered.SignatureSize, timeout.Token);
                    signatureText = Encoding.UTF8.GetString(sigData.ToArray());
                }
                using (var response = await Get(offered.Url, true, timeout.Token))
                using (var target = new FileStream(downloaded, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 65536, true))
                {
                    await Copy(response, target, offered.Size, timeout.Token);
                    target.Position = 0;
                    UpdatePayload.Verify(target, offered, signatureText);
                    timeout.Token.ThrowIfCancellationRequested();
                    executable = portable ? await Task.Run(() => UpdatePayload.ExtractPortable(target, portableFolder), timeout.Token) : downloaded;
                }
            }
            stagedFolder = portable ? portableFolder : downloadFolder;
            if (lifetime.IsCancellationRequested)
            {
                DeleteStaging(stagedFolder);
                executable = null;
                return;
            }
            using (var app = File.OpenRead(executable)) expectedExecutableHash = UpdatePayload.Hash(app);
            Send(portable ? "portable-ready" : "installer-ready", offered.Version.ToString(3));
        }
        catch (Exception)
        {
            executable = null;
            DeleteStaging(portableFolder);
            Send("download-failed", offered.Version.ToString(3));
        }
        finally
        {
            if (portable || executable == null) DeleteStaging(downloadFolder);
            busy = false;
        }
    }

    private void Launch()
    {
        if (busy || executable == null || launched) return;
        if (!portable && OtherInstancesRunning())
        {
            MessageBox.Show(window, "请先关闭其他截图脱敏助手窗口，再启动更新。", "安装更新",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        var message = portable ? "即将打开更新后的便携版。" : "即将关闭当前程序并覆盖安装，然后重新打开。";
        if (MessageBox.Show(window, message + "\n\n当前编辑会话将结束。请先导出需要保留的截图。", "安装更新",
            MessageBoxButtons.OKCancel, MessageBoxIcon.Information, MessageBoxDefaultButton.Button2) != DialogResult.OK) return;
        try
        {
            using (var app = File.OpenRead(executable))
                if (UpdatePayload.Hash(app) != expectedExecutableHash) throw new InvalidDataException();
        }
        catch (Exception)
        {
            DeleteStaging(stagedFolder);
            executable = stagedFolder = null;
            Send("download-failed");
            return;
        }
        pendingLaunch = new ProcessStartInfo(executable, portable ? "" : "/S /currentuser --updated --force-run") {
            WorkingDirectory = Path.GetDirectoryName(executable), UseShellExecute = true
        };
        if (portable) pendingPortable = executable;
        launched = true;
        window.Close();
    }

    private static bool OtherInstancesRunning()
    {
        using (var current = Process.GetCurrentProcess())
        {
            var processes = Process.GetProcessesByName(current.ProcessName);
            try
            {
                foreach (var process in processes)
                {
                    try { if (process.Id != current.Id && process.SessionId == current.SessionId) return true; }
                    catch (InvalidOperationException) { }
                    catch (System.ComponentModel.Win32Exception) { return true; }
                }
                return false;
            }
            finally { foreach (var process in processes) process.Dispose(); }
        }
    }

    private void Close()
    {
        lifetime.Cancel();
        if (!launched) DeleteStaging(stagedFolder);
    }

    private static void DeleteStaging(string folder)
    {
        if (folder == null) return;
        try { Directory.Delete(folder, true); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static async Task<HttpResponseMessage> Get(Uri uri, bool package, CancellationToken token)
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            if (uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort || uri.UserInfo.Length != 0 ||
                (package ? !IsAssetHost(uri.Host) : uri != Latest)) throw new InvalidDataException("Unexpected update URL.");
            using (var request = new HttpRequestMessage(HttpMethod.Get, uri))
            {
                request.Headers.UserAgent.ParseAdd("ScreenshotRedactor/" + DesktopBuild.Version);
                request.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };
                if (!package) request.Headers.Accept.ParseAdd("application/vnd.github+json");
                var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
                if (response.StatusCode == HttpStatusCode.OK) return response;
                using (response)
                {
                    var code = (int)response.StatusCode;
                    var location = response.Headers.Location;
                    if (!package || code < 300 || code > 399 || location == null)
                        throw new HttpRequestException("Update server returned HTTP " + code);
                    uri = new Uri(uri, location);
                }
            }
        }
        throw new HttpRequestException("Too many update redirects.");
    }

    private static bool IsAssetHost(string host)
    {
        return host == "github.com" || host == "release-assets.githubusercontent.com" || host == "objects.githubusercontent.com";
    }

    private static async Task Copy(HttpResponseMessage response, Stream target, long limit, CancellationToken token)
    {
        if (response.Content.Headers.ContentLength > limit) throw new InvalidDataException("Update payload is too large.");
        using (var stream = await response.Content.ReadAsStreamAsync())
        {
            var buffer = new byte[65536];
            int count;
            while ((count = await stream.ReadAsync(buffer, 0, buffer.Length, token)) != 0)
            {
                if (target.Length + count > limit) throw new InvalidDataException("Update payload is too large.");
                await target.WriteAsync(buffer, 0, count, token);
            }
        }
    }
}
