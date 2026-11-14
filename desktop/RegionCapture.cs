using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Windows.Forms;

internal sealed class CaptureHistory
{
    internal const int Capacity = 30;
    private static readonly Regex FileName = new Regex(@"\A[0-9]{8}-[0-9]{6}-[0-9]{3}-[a-f0-9]{8}\.png\z", RegexOptions.CultureInvariant);
    private readonly string folder;

    internal CaptureHistory(string folder) { this.folder = folder; }

    internal string[] List()
    {
        if (!Directory.Exists(folder)) return new string[0];
        return new DirectoryInfo(folder).GetFiles("*.png").Where(file => IsCapture(file.Name))
            .OrderByDescending(file => file.CreationTimeUtc).ThenByDescending(file => file.Name, StringComparer.Ordinal)
            .Select(file => file.Name).ToArray();
    }

    internal static bool IsCapture(string name) { return FileName.IsMatch(name); }

    internal byte[] Read(string name) { return File.ReadAllBytes(Path.Combine(folder, name)); }

    internal void Delete(string name)
    {
        if (IsCapture(name)) File.Delete(Path.Combine(folder, name));
    }

    internal void Clear()
    {
        foreach (var name in List()) Delete(name);
    }

    internal void Save(Bitmap bitmap)
    {
        Directory.CreateDirectory(folder);
        var id = Guid.NewGuid().ToString("N").Substring(0, 8);
        var name = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff", CultureInfo.InvariantCulture) + "-" + id + ".png";
        var destination = Path.Combine(folder, name);
        var temporary = destination + ".tmp";
        try
        {
            bitmap.Save(temporary, ImageFormat.Png);
            File.Move(temporary, destination);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
        foreach (var old in List().Where(existing => existing != name).Skip(Capacity - 1)) Delete(old);
    }
}

internal sealed class RegionCapture : Form
{
    private readonly Bitmap screen;
    private Point? start;
    private Rectangle selection;
    internal Bitmap Result { get; private set; }

    internal RegionCapture(Bitmap screen, Rectangle bounds)
    {
        this.screen = screen;
        Text = "区域截屏";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = bounds;
        TopMost = true;
        Cursor = Cursors.Cross;
        KeyPreview = true;
        DoubleBuffered = true;
        Shown += (s, e) => { Bounds = bounds; Activate(); };
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.DrawImageUnscaled(screen, 0, 0);
        using (var shade = new SolidBrush(Color.FromArgb(120, 19, 17, 24))) e.Graphics.FillRectangle(shade, ClientRectangle);
        if (!selection.IsEmpty)
        {
            e.Graphics.DrawImage(screen, selection, selection, GraphicsUnit.Pixel);
            using (var border = new Pen(Color.White, 2)) e.Graphics.DrawRectangle(border, selection);
        }
        var monitor = Screen.FromPoint(Control.MousePosition).WorkingArea;
        var local = PointToClient(monitor.Location);
        var banner = new Rectangle(local.X + Math.Max(6, (monitor.Width - 290) / 2), local.Y + 24, 290, 38);
        using (var background = new SolidBrush(Color.FromArgb(34, 33, 40))) e.Graphics.FillRectangle(background, banner);
        TextRenderer.DrawText(e.Graphics, "拖动框选截屏 · Esc 取消", Font, banner, Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Right) { DialogResult = DialogResult.Cancel; return; }
        if (e.Button != MouseButtons.Left) return;
        start = e.Location;
        Capture = true;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        if (!start.HasValue) return;
        var point = start.Value;
        selection = Rectangle.Intersect(new Rectangle(0, 0, screen.Width, screen.Height), Rectangle.FromLTRB(
            Math.Min(point.X, e.X), Math.Min(point.Y, e.Y), Math.Max(point.X, e.X), Math.Max(point.Y, e.Y)));
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        if (!start.HasValue || e.Button != MouseButtons.Left) return;
        OnMouseMove(e);
        start = null;
        Capture = false;
        if (selection.Width < 3 || selection.Height < 3) { selection = Rectangle.Empty; Invalidate(); return; }
        Result = screen.Clone(selection, PixelFormat.Format32bppRgb);
        DialogResult = DialogResult.OK;
    }

    protected override bool ProcessCmdKey(ref Message message, Keys key)
    {
        if (key != Keys.Escape) return base.ProcessCmdKey(ref message, key);
        DialogResult = DialogResult.Cancel;
        return true;
    }
}
