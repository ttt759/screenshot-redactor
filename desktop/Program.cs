using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
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
    private readonly CaptureHistory captureHistory = new CaptureHistory(Path.Combine(
        Environment.GetEnvironmentVariable("SCREENSHOT_REDACTOR_TEST_PROFILE") ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ScreenshotRedactor", "Captures"));
    private CoreWebView2Environment environment;
    private bool captureInProgress;
    private const int CaptureKey = 1, HistoryKey = 2, HotkeyMessage = 0x0312;
    private const uint CtrlShiftNoRepeat = 0x4006;
    [DllImport("user32.dll")] private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr window, int id);
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
            browser.Settings.IsWebMessageEnabled = true;
            browser.WebMessageReceived += ReceiveMessage;
            browser.NavigationCompleted += (s, e) => {
                if (!e.IsSuccess) return;
                var capture = RegisterHotKey(Handle, CaptureKey, CtrlShiftNoRepeat, (uint)Keys.F9);
                var history = RegisterHotKey(Handle, HistoryKey, CtrlShiftNoRepeat, (uint)Keys.F10);
                if (!capture || !history) Notify("截屏快捷键被占用，仍可使用工具栏按钮。");
            };
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

    private void ReceiveMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (args.Source != Home) return;
        string command;
        try { command = args.TryGetWebMessageAsString(); }
        catch (ArgumentException) { return; }
        if (command == "capture") BeginRegionCapture();
        else if (command == "clear-captures" && !captureInProgress)
        {
            try { captureHistory.Clear(); Notify("history-cleared"); }
            catch (IOException) { Notify("无法清空截图历史，请重试。"); }
            catch (UnauthorizedAccessException) { Notify("无法清空截图历史，请检查文件权限。"); }
        }
    }

    private void Notify(string message)
    {
        if (!IsDisposed && view.CoreWebView2 != null && view.CoreWebView2.Source == Home)
            view.CoreWebView2.PostWebMessageAsString(message);
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == HotkeyMessage && !captureInProgress)
        {
            if (message.WParam.ToInt32() == CaptureKey) BeginRegionCapture();
            else if (message.WParam.ToInt32() == HistoryKey)
            {
                if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                Activate();
                Notify("history");
            }
        }
        base.WndProc(ref message);
    }

    private async void BeginRegionCapture()
    {
        if (captureInProgress || IsDisposed) return;
        captureInProgress = true;
        var state = WindowState;
        string feedback = null;
        try
        {
            Hide();
            await Task.Delay(140);
            if (IsDisposed) return;
            var bounds = SystemInformation.VirtualScreen;
            using (var screen = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppRgb))
            {
                using (var graphics = Graphics.FromImage(screen)) graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                using (var picker = new RegionCapture(screen, bounds))
                {
                    if (picker.ShowDialog() == DialogResult.OK)
                    {
                        using (var result = picker.Result) captureHistory.Save(result);
                        feedback = "captured";
                    }
                }
            }
        }
        catch (Exception) { feedback = "无法截屏或保存截图，请重试。"; }
        finally
        {
            captureInProgress = false;
            if (!IsDisposed)
            {
                WindowState = state;
                Show();
                if (state != FormWindowState.Minimized) Activate();
                if (feedback != null) Notify(feedback);
            }
        }
    }

    private void ServeLocalAsset(object sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
        Uri url;
        string type;
        if (!Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out url) || url.Scheme != "https" || url.Host != Host ||
            !url.IsDefaultPort || args.Request.Method != "GET")
        {
            args.Response = environment.CreateWebResourceResponse(null, 404, "Not Found", "");
            return;
        }
        var route = url.AbsolutePath.TrimStart('/');
        if (route == "capture-history" || route.StartsWith("capture/", StringComparison.Ordinal))
        {
            ServeCapture(args, route);
            return;
        }
        if (!Assets.TryGetValue(route, out type))
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

    private void ServeCapture(CoreWebView2WebResourceRequestedEventArgs args, string route)
    {
        try
        {
            if (route == "capture-history")
            {
                // Names contain only digits, ASCII separators and hex, so they are safe JSON strings.
                var names = captureHistory.List().Take(CaptureHistory.Capacity).Select(name => "\"" + name + "\"");
                var json = "[" + string.Join(",", names) + "]";
                args.Response = environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(json)), 200,
                    "OK", "Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store");
                return;
            }
            var namePart = route.Substring("capture/".Length);
            if (CaptureHistory.IsCapture(namePart))
            {
                args.Response = environment.CreateWebResourceResponse(new MemoryStream(captureHistory.Read(namePart)), 200,
                    "OK", "Content-Type: image/png\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
                return;
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        args.Response = environment.CreateWebResourceResponse(null, 404, "Not Found", "");
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        UnregisterHotKey(Handle, CaptureKey);
        UnregisterHotKey(Handle, HistoryKey);
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
