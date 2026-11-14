using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
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
    private readonly Rectangle desktop;
    private readonly Rectangle[] windows;
    private readonly List<Mark> marks = new List<Mark>();
    private readonly FlowLayoutPanel toolbar;
    private readonly Button black, white, gray, arrow, undo;
    private Point? anchor;
    private bool editing, dragging, drawingArrow;
    private Color maskColor = Color.Black;
    private Rectangle hover;
    private Rectangle selection;
    private Rectangle toolbarArea;
    private bool toolbarAbove;
    private Mark draft;
    internal Bitmap Result { get; private set; }

    internal RegionCapture(Bitmap screen, Rectangle bounds, Rectangle[] windows)
    {
        this.screen = screen;
        this.windows = windows;
        desktop = bounds;
        Text = "区域截屏";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = bounds;
        ShowInTaskbar = false;
        TopMost = true;
        Cursor = Cursors.Cross;
        KeyPreview = true;
        DoubleBuffered = true;
        toolbar = new FlowLayoutPanel {
            AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false,
            BackColor = Color.FromArgb(34, 33, 40), Padding = new Padding(5), Cursor = Cursors.Default, Visible = false
        };
        black = AddButton("黑色", () => ChooseTool(Color.Black, false));
        white = AddButton("白色", () => ChooseTool(Color.White, false));
        gray = AddButton("深灰", () => ChooseTool(Color.FromArgb(72, 75, 82), false));
        arrow = AddButton("箭头", () => ChooseTool(maskColor, true));
        undo = AddButton("撤销", () => TryUndo());
        AddButton("重选", ResetSelection);
        AddButton("移位", MoveToolbar);
        AddButton("取消", () => DialogResult = DialogResult.Cancel);
        AddButton("复制 ↵", Finish);
        Controls.Add(toolbar);
        ChooseTool(Color.Black, false);
        Shown += (s, e) => { Bounds = desktop; UpdateHover(PointToClient(MousePosition)); Activate(); };
    }

    private Button AddButton(string label, Action action)
    {
        var button = new Button {
            Text = label, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
            FlatStyle = FlatStyle.Flat, Padding = new Padding(6, 3, 6, 3), Margin = new Padding(2),
            ForeColor = Color.White, BackColor = toolbar.BackColor, UseVisualStyleBackColor = false
        };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(70, 66, 79);
        button.Click += (s, e) => action();
        toolbar.Controls.Add(button);
        return button;
    }

    private void ChooseTool(Color color, bool useArrow)
    {
        maskColor = color;
        drawingArrow = useArrow;
        foreach (var button in new[] { black, white, gray, arrow }) button.BackColor = toolbar.BackColor;
        var selected = useArrow ? arrow : color == Color.Black ? black : color == Color.White ? white : gray;
        selected.BackColor = Color.FromArgb(99, 56, 77);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.DrawImageUnscaled(screen, 0, 0);
        using (var shade = new SolidBrush(Color.FromArgb(120, 19, 17, 24))) e.Graphics.FillRectangle(shade, ClientRectangle);
        var visible = editing || dragging ? selection : hover;
        if (visible.Width > 0 && visible.Height > 0)
        {
            e.Graphics.DrawImage(screen, visible, visible, GraphicsUnit.Pixel);
            if (editing) DrawMarks(e.Graphics);
            using (var border = new Pen(Color.FromArgb(255, 141, 168), 2))
                e.Graphics.DrawRectangle(border, visible.X, visible.Y, visible.Width - 1, visible.Height - 1);
        }
        if (editing || dragging) return;
        var monitor = Screen.FromPoint(Control.MousePosition).WorkingArea;
        var local = PointToClient(monitor.Location);
        const int hintWidth = 340;
        var banner = new Rectangle(local.X + Math.Max(6, (monitor.Width - hintWidth) / 2), local.Y + 24, hintWidth, 38);
        using (var background = new SolidBrush(Color.FromArgb(34, 33, 40))) e.Graphics.FillRectangle(background, banner);
        TextRenderer.DrawText(e.Graphics, "单击选窗口 · 拖动选区域 · Esc 取消", Font, banner, Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Right)
        {
            if (editing) ResetSelection();
            else DialogResult = DialogResult.Cancel;
            return;
        }
        if (e.Button != MouseButtons.Left) return;
        if (editing && !selection.Contains(e.Location)) return;
        anchor = e.Location;
        Capture = true;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        if (!anchor.HasValue)
        {
            if (!editing) UpdateHover(e.Location);
            return;
        }
        var start = anchor.Value;
        if (editing)
        {
            var end = new Point(Math.Max(selection.Left, Math.Min(e.X, selection.Right)),
                Math.Max(selection.Top, Math.Min(e.Y, selection.Bottom)));
            draft = new Mark(start, end, maskColor, drawingArrow);
        }
        else
        {
            var threshold = SystemInformation.DragSize;
            dragging = dragging || Math.Abs(e.X - start.X) >= Math.Max(2, threshold.Width / 2) ||
                Math.Abs(e.Y - start.Y) >= Math.Max(2, threshold.Height / 2);
            if (dragging) selection = Rectangle.Intersect(ClientRectangle, Between(start, e.Location));
        }
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        if (!anchor.HasValue || e.Button != MouseButtons.Left) return;
        var start = anchor.Value;
        OnMouseMove(e);
        anchor = null;
        Capture = false;
        if (editing)
        {
            if (draft.IsVisible) marks.Add(draft);
            draft = null;
            undo.Enabled = marks.Count > 0;
            Invalidate();
            return;
        }
        if (!dragging) selection = CaptureWindows.At(windows, desktop, start);
        dragging = false;
        if (selection.Width < 3 || selection.Height < 3) { ResetSelection(); return; }
        editing = true;
        ShowToolbar(e.Location);
        Invalidate();
    }

    protected override void OnMouseCaptureChanged(EventArgs e)
    {
        base.OnMouseCaptureChanged(e);
        if (!anchor.HasValue || Capture) return;
        anchor = null;
        dragging = false;
        draft = null;
        Invalidate();
    }

    private void UpdateHover(Point location)
    {
        var hit = CaptureWindows.At(windows, desktop, location);
        if (hit == hover) return;
        hover = hit;
        Invalidate();
    }

    private void ShowToolbar(Point location)
    {
        var screenArea = Screen.FromPoint(PointToScreen(location)).WorkingArea;
        toolbarArea = new Rectangle(PointToClient(screenArea.Location), screenArea.Size);
        toolbarAbove = selection.Bottom + 6 + toolbar.GetPreferredSize(Size.Empty).Height > toolbarArea.Bottom;
        PositionToolbar();
        undo.Enabled = false;
        toolbar.Visible = true;
    }

    private void MoveToolbar()
    {
        toolbarAbove = !toolbarAbove;
        PositionToolbar();
    }

    private void PositionToolbar()
    {
        var area = toolbarArea;
        var size = toolbar.GetPreferredSize(Size.Empty);
        const int gap = 6;
        var x = toolbarAbove ? selection.Left : selection.Right - size.Width;
        x = Math.Max(area.Left, Math.Min(x, area.Right - size.Width));
        var y = toolbarAbove ? selection.Top - size.Height - gap : selection.Bottom + gap;
        y = Math.Max(area.Top, Math.Min(y, area.Bottom - size.Height));
        toolbar.Location = new Point(x, y);
    }

    private void ResetSelection()
    {
        anchor = null;
        Capture = false;
        editing = dragging = false;
        draft = null;
        marks.Clear();
        selection = Rectangle.Empty;
        toolbar.Visible = false;
        UpdateHover(PointToClient(MousePosition));
        Invalidate();
    }

    internal bool TryUndo()
    {
        if (marks.Count == 0) return false;
        marks.RemoveAt(marks.Count - 1);
        undo.Enabled = marks.Count > 0;
        Invalidate();
        return true;
    }

    private void DrawMarks(Graphics graphics)
    {
        var state = graphics.Save();
        graphics.SetClip(selection, CombineMode.Intersect);
        foreach (var mark in marks) mark.Draw(graphics);
        if (draft != null && draft.IsVisible) draft.Draw(graphics);
        graphics.Restore(state);
    }

    internal Bitmap RenderSelection()
    {
        var result = screen.Clone(selection, PixelFormat.Format32bppRgb);
        using (var graphics = Graphics.FromImage(result))
        {
            graphics.TranslateTransform(-selection.X, -selection.Y);
            DrawMarks(graphics);
        }
        return result;
    }

    private void Finish()
    {
        if (!editing || anchor.HasValue) return;
        var result = RenderSelection();
        try { CaptureClipboard.Copy(result); }
        catch (ExternalException)
        {
            result.Dispose();
            MessageBox.Show(this, "系统剪贴板暂时被占用。关闭提示后可再次复制。", Text,
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        Result = result;
        DialogResult = DialogResult.OK;
    }

    protected override bool ProcessCmdKey(ref Message message, Keys key)
    {
        switch (key)
        {
            case Keys.Escape: DialogResult = DialogResult.Cancel; return true;
            case Keys.Enter: case Keys.Control | Keys.C: Finish(); return true;
            case Keys.Control | Keys.Z: TryUndo(); return true;
            default: return base.ProcessCmdKey(ref message, key);
        }
    }

    private static Rectangle Between(Point first, Point last)
    {
        return Rectangle.FromLTRB(Math.Min(first.X, last.X), Math.Min(first.Y, last.Y),
            Math.Max(first.X, last.X), Math.Max(first.Y, last.Y));
    }

    private sealed class Mark
    {
        private readonly Point start, end;
        private readonly Color color;
        private readonly bool arrow;

        internal Mark(Point start, Point end, Color color, bool arrow)
        {
            this.start = start;
            this.end = end;
            this.color = color;
            this.arrow = arrow;
        }

        internal bool IsVisible { get { return arrow ? Math.Abs(end.X - start.X) + Math.Abs(end.Y - start.Y) >= 6 :
            Math.Abs(end.X - start.X) >= 2 && Math.Abs(end.Y - start.Y) >= 2; } }

        internal void Draw(Graphics graphics)
        {
            if (!arrow)
            {
                using (var brush = new SolidBrush(color)) graphics.FillRectangle(brush, Between(start, end));
                return;
            }
            var state = graphics.Save();
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var cap = new AdjustableArrowCap(4, 5))
            using (var pen = new Pen(Color.FromArgb(225, 32, 75), 4))
            {
                pen.StartCap = LineCap.Round;
                pen.CustomEndCap = cap;
                graphics.DrawLine(pen, start, end);
            }
            graphics.Restore(state);
        }
    }
}
