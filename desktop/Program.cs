using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Reflection.AssemblyTitle("截图脱敏助手")]
[assembly: System.Reflection.AssemblyProduct("截图脱敏助手")]

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var window = new RedactorWindow()) Application.Run(window);
    }
}

internal sealed class RedactorWindow : Form
{
    private const string Host = "screenshot-redactor.local";
    private const string Home = "https://" + Host + "/index.html";
    private readonly string profile = Path.Combine(Path.GetTempPath(), "ScreenshotRedactor-" + Guid.NewGuid().ToString("N"));
    private readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill };
    private CoreWebView2Environment environment;
    private static readonly Dictionary<string, string> Assets = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        { "index.html", "text/html; charset=utf-8" }, { "styles.css", "text/css; charset=utf-8" },
        { "app.mjs", "text/javascript; charset=utf-8" }, { "geometry.mjs", "text/javascript; charset=utf-8" },
        { "icons.mjs", "text/javascript; charset=utf-8" }, { "images.mjs", "text/javascript; charset=utf-8" },
        { "vendor/fflate.js", "text/javascript; charset=utf-8" }, { "favicon.svg", "image/svg+xml" },
        { "samples/account.png", "image/png" }, { "samples/account-team.png", "image/png" },
        { "samples/account-studio.png", "image/png" }, { "samples/checkout.jpg", "image/jpeg" },
        { "samples/receipt.png", "image/png" },
    };

    internal RedactorWindow()
    {
        Text = "截图脱敏助手";
        ClientSize = new Size(1260, 830);
        MinimumSize = new Size(560, 520);
        StartPosition = FormStartPosition.CenterScreen;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        Controls.Add(view);
        Shown += Start;
    }

    private async void Start(object sender, EventArgs args)
    {
        try
        {
            environment = await CoreWebView2Environment.CreateAsync(null, profile);
            if (IsDisposed) return;
            await view.EnsureCoreWebView2Async(environment);
            if (IsDisposed) return;
            var browser = view.CoreWebView2;
            browser.Settings.AreDevToolsEnabled = false;
            browser.Settings.AreDefaultContextMenusEnabled = false;
            browser.Settings.IsZoomControlEnabled = false;
            browser.Settings.AreHostObjectsAllowed = false;
            browser.Settings.IsWebMessageEnabled = false;
            browser.NewWindowRequested += (s, e) => { e.Handled = true; };
            browser.PermissionRequested += (s, e) => { e.State = CoreWebView2PermissionState.Deny; };
            browser.NavigationStarting += (s, e) => { e.Cancel = e.Uri != Home; };
            browser.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            browser.WebResourceRequested += ServeLocalAsset;
            browser.Navigate(Home);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (IsDisposed) return;
            if (MessageBox.Show(this, "此电脑缺少 Microsoft Edge WebView2 运行时。打开微软下载页？", Text,
                MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
            {
                Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/#download-section") { UseShellExecute = true });
            }
            Close();
        }
        catch (Exception error)
        {
            if (IsDisposed) return;
            MessageBox.Show(this, "无法启动截图脱敏助手。\n" + error.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private void ServeLocalAsset(object sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
        Uri url;
        string type;
        if (!Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out url) || url.Scheme != "https" || url.Host != Host ||
            !url.IsDefaultPort || args.Request.Method != "GET" || !Assets.TryGetValue(url.AbsolutePath.TrimStart('/'), out type))
        {
            args.Response = environment.CreateWebResourceResponse(null, 404, "Not Found", "");
            return;
        }
        var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "docs", url.AbsolutePath.TrimStart('/'));
        if (!File.Exists(path))
        {
            args.Response = environment.CreateWebResourceResponse(null, 404, "Not Found", "");
            return;
        }
        args.Response = environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(path)), 200, "OK",
            "Content-Type: " + type + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        var processId = view.CoreWebView2 == null ? 0 : (int)view.CoreWebView2.BrowserProcessId;
        view.Dispose();
        if (processId != 0)
        {
            try { using (var browser = Process.GetProcessById(processId)) browser.WaitForExit(2500); }
            catch (ArgumentException) { }
        }
        try { if (Directory.Exists(profile)) Directory.Delete(profile, true); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        base.OnFormClosed(e);
    }
}
