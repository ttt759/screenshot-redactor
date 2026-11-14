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
    private static readonly Color Surface = Color.FromArgb(34, 33, 40);
    private static readonly Color Accent = Color.FromArgb(255, 141, 168);
    private static readonly Color GrayMask = Color.FromArgb(72, 75, 82);
    private const string SelectHint = "单击选窗口   拖动框选   Esc 取消";
    private const TextFormatFlags CenterText = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix;
    private readonly Bitmap screen;
    private readonly Rectangle desktop;
    private readonly Rectangle[] windows;
    private readonly List<Mark> marks = new List<Mark>();
    private readonly FlowLayoutPanel toolbar;
    private readonly ToolTip tips;
    private readonly Button black, white, gray, arrow, undo;
    private Point? anchor;
    private bool editing, dragging, drawingArrow;
    private Color maskColor = Color.Black;
    private Rectangle hover;
    private Rectangle selection;
    private Rectangle toolbarArea;
    private Rectangle instructions;
    private Rectangle hintMonitor;
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
        tips = new ToolTip { InitialDelay = 350, ReshowDelay = 100 };
        Disposed += (s, e) => tips.Dispose();
        toolbar = new FlowLayoutPanel {
            AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false,
            BackColor = Surface, Padding = new Padding(5), Cursor = Cursors.Default, Visible = false,
            AccessibleName = "截图编辑工具栏"
        };
        black = AddSwatch(Color.Black, "黑色", "1");
        white = AddSwatch(Color.White, "白色", "2");
        gray = AddSwatch(GrayMask, "深灰", "3");
        arrow = AddButton("箭头", "画箭头（4）", () => ChooseTool(maskColor, true));
        undo = AddButton("撤销", "撤销上一步（Ctrl + Z）", () => TryUndo());
        AddButton("重选", "重新框选（R、右键）", ResetSelection);
        AddButton("移位", "移动工具栏（T）", MoveToolbar).AccessibleName = "移动工具栏";
        AddButton("取消", "取消截屏（Esc）", () => DialogResult = DialogResult.Cancel);
        var copy = AddButton("复制", "复制到系统剪贴板（Enter、Ctrl + C）", Finish);
        copy.Width += 12;
        copy.ForeColor = Color.FromArgb(43, 18, 31);
        copy.BackColor = Accent;
        copy.FlatAppearance.MouseOverBackColor = Color.FromArgb(255, 178, 197);
        copy.FlatAppearance.MouseDownBackColor = Color.FromArgb(233, 115, 145);
        Controls.Add(toolbar);
        ChooseTool(Color.Black, false);
        Shown += (s, e) => { Bounds = desktop; UpdatePointer(PointToClient(MousePosition)); Activate(); };
    }

    private Button AddButton(string label, string hint, Action action)
    {
        var measured = TextRenderer.MeasureText(label, Font, Size.Empty, TextFormatFlags.NoPrefix);
        var button = new Button {
            Text = label, Size = new Size(Math.Max(32, measured.Width + 16), Math.Max(32, Font.Height + 12)),
            FlatStyle = FlatStyle.Flat, Margin = new Padding(2), ForeColor = Color.White, BackColor = Surface,
            UseVisualStyleBackColor = false, Cursor = Cursors.Hand, AccessibleName = label, AccessibleDescription = hint
        };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(70, 66, 79);
        button.FlatAppearance.MouseDownBackColor = Color.FromArgb(90, 75, 90);
        button.Paint += (s, e) => {
            if (button.Enabled) return;
            using (var brush = new SolidBrush(Surface)) e.Graphics.FillRectangle(brush, button.ClientRectangle);
            TextRenderer.DrawText(e.Graphics, button.Text, button.Font, button.ClientRectangle, Color.FromArgb(153, 146, 158), CenterText);
        };
        button.Click += (s, e) => action();
        tips.SetToolTip(button, hint);
        toolbar.Controls.Add(button);
        return button;
    }

    private Button AddSwatch(Color color, string name, string key)
    {
        var button = AddButton(string.Empty, name + "遮挡（" + key + "）", () => ChooseTool(color, false));
        button.AccessibleName = name + "遮挡";
        button.Paint += (s, e) => {
            int size = 14;
            var square = new Rectangle((button.Width - size) / 2, (button.Height - size) / 2, size, size);
            using (var brush = new SolidBrush(color)) e.Graphics.FillRectangle(brush, square);
            using (var pen = new Pen(Color.FromArgb(169, 160, 174))) e.Graphics.DrawRectangle(pen, square);
        };
        return button;
    }

    private void ChooseTool(Color color, bool useArrow)
    {
        maskColor = color;
        drawingArrow = useArrow;
        var selected = useArrow ? arrow : color == Color.Black ? black : color == Color.White ? white : gray;
        foreach (var button in new[] { black, white, gray, arrow })
        {
            var active = button == selected;
            button.BackColor = active ? Color.FromArgb(99, 56, 77) : Surface;
            button.FlatAppearance.BorderSize = active ? 1 : 0;
            button.FlatAppearance.BorderColor = Accent;
            var hint = tips.GetToolTip(button);
            button.AccessibleDescription = active ? hint + "，已选中" : hint;
            button.Invalidate();
        }
    }

    protected override void OnPaintBackground(PaintEventArgs e) { }

    protected override void OnPaint(PaintEventArgs e)
    {
        var clip = Rectangle.Intersect(e.ClipRectangle, new Rectangle(Point.Empty, screen.Size));
        if (clip.Width <= 0 || clip.Height <= 0) return;
        e.Graphics.DrawImage(screen, clip, clip, GraphicsUnit.Pixel);
        using (var shade = new SolidBrush(Color.FromArgb(120, 19, 17, 24))) e.Graphics.FillRectangle(shade, clip);
        var visible = editing || dragging ? selection : hover;
        if (visible.Width > 0 && visible.Height > 0)
        {
            var pixels = Rectangle.Intersect(clip, visible);
            if (pixels.Width > 0 && pixels.Height > 0) e.Graphics.DrawImage(screen, pixels, pixels, GraphicsUnit.Pixel);
            if (editing) DrawMarks(e.Graphics);
            using (var border = new Pen(Accent, 2))
                e.Graphics.DrawRectangle(border, visible.X, visible.Y, visible.Width - 1, visible.Height - 1);
            var label = SizeLabel(visible);
            if (!editing || label.Bottom <= visible.Top)
                PaintLabel(e.Graphics, visible.Width + " × " + visible.Height, label);
        }
        if (editing || dragging) return;
        PaintLabel(e.Graphics, SelectHint, instructions);
    }

    private void PaintLabel(Graphics graphics, string text, Rectangle bounds)
    {
        using (var background = new SolidBrush(Surface)) graphics.FillRectangle(background, bounds);
        TextRenderer.DrawText(graphics, text, Font, bounds, Color.White, CenterText);
    }

    private Rectangle SizeLabel(Rectangle rect)
    {
        var dimensions = rect.Width + " × " + rect.Height;
        var size = TextRenderer.MeasureText(dimensions, Font);
        int width = size.Width + 12, height = size.Height + 6;
        var y = rect.Top - height - 5;
        if (y < 0) y = rect.Top + 5;
        return new Rectangle(Math.Max(0, Math.Min(rect.Left + 3, ClientSize.Width - width)), y, width, height);
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
        Cursor = Cursors.Cross;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        if (!anchor.HasValue)
        {
            UpdatePointer(e.Location);
            return;
        }
        var start = anchor.Value;
        if (editing)
        {
            InvalidateMark(draft);
            var end = new Point(Math.Max(selection.Left, Math.Min(e.X, selection.Right)),
                Math.Max(selection.Top, Math.Min(e.Y, selection.Bottom)));
            draft = new Mark(start, end, maskColor, drawingArrow);
            InvalidateMark(draft);
        }
        else
        {
            var previous = dragging ? selection : hover;
            var threshold = SystemInformation.DragSize;
            var wasDragging = dragging;
            dragging = dragging || Math.Abs(e.X - start.X) >= Math.Max(2, threshold.Width / 2) ||
                Math.Abs(e.Y - start.Y) >= Math.Max(2, threshold.Height / 2);
            if (!dragging) return;
            selection = Rectangle.Intersect(ClientRectangle, Between(start, e.Location));
            InvalidateSelection(previous);
            InvalidateSelection(selection);
            if (!wasDragging) Invalidate(instructions);
        }
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
            UpdatePointer(e.Location);
            return;
        }
        if (!dragging) selection = CaptureWindows.At(windows, desktop, start);
        dragging = false;
        if (selection.Width < 3 || selection.Height < 3) { ResetSelection(); return; }
        editing = true;
        ShowToolbar(e.Location);
        UpdatePointer(e.Location);
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

    private void UpdatePointer(Point location)
    {
        if (editing)
        {
            Cursor = selection.Contains(location) ? Cursors.Cross : Cursors.Default;
            return;
        }
        var screenPoint = PointToScreen(location);
        if (!hintMonitor.Contains(screenPoint) || instructions.IsEmpty)
        {
            Invalidate(instructions);
            var monitor = Screen.FromPoint(screenPoint);
            hintMonitor = monitor.Bounds;
            var area = monitor.WorkingArea;
            var origin = PointToClient(area.Location);
            var hintSize = TextRenderer.MeasureText(SelectHint, Font);
            var width = Math.Min(area.Width, hintSize.Width + 24);
            instructions = new Rectangle(origin.X + (area.Width - width) / 2, origin.Y + 20, width, hintSize.Height + 14);
            Invalidate(instructions);
        }
        var hit = CaptureWindows.At(windows, desktop, location);
        Cursor = hit.IsEmpty ? Cursors.Cross : Cursors.Hand;
        if (hit == hover) return;
        InvalidateSelection(hover);
        hover = hit;
        InvalidateSelection(hover);
    }

    private void InvalidateSelection(Rectangle rect)
    {
        if (rect.Width <= 0 || rect.Height <= 0) return;
        Invalidate(Rectangle.Inflate(rect, 2, 2));
        Invalidate(SizeLabel(rect));
    }

    private void InvalidateMark(Mark mark)
    {
        if (mark != null && mark.IsVisible) Invalidate(Rectangle.Intersect(selection, mark.PaintBounds));
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
        UpdatePointer(PointToClient(MousePosition));
        Invalidate();
    }

    internal bool TryUndo()
    {
        if (marks.Count == 0) return false;
        InvalidateMark(marks[marks.Count - 1]);
        marks.RemoveAt(marks.Count - 1);
        undo.Enabled = marks.Count > 0;
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
        }
        if (!editing || anchor.HasValue) return base.ProcessCmdKey(ref message, key);
        switch (key)
        {
            case Keys.D1: case Keys.NumPad1: ChooseTool(Color.Black, false); return true;
            case Keys.D2: case Keys.NumPad2: ChooseTool(Color.White, false); return true;
            case Keys.D3: case Keys.NumPad3: ChooseTool(GrayMask, false); return true;
            case Keys.D4: case Keys.NumPad4: ChooseTool(maskColor, true); return true;
            case Keys.R: ResetSelection(); return true;
            case Keys.T: MoveToolbar(); return true;
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

        internal Rectangle PaintBounds { get { return Rectangle.Inflate(Between(start, end), 24, 24); } }

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
