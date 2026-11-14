using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;

internal static class NativeCaptureTest
{
    [STAThread]
    private static int Main()
    {
        try { Run(); return 0; }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }

    private static void Run()
    {
        var virtualBounds = new Rectangle(-160, -40, 480, 300);
        var candidates = new[] { new Rectangle(-30, -10, 150, 100), new Rectangle(-190, -60, 250, 210) };
        Check(CaptureWindows.At(candidates, virtualBounds, new Point(145, 35)) ==
            new Rectangle(130, 30, 150, 100), "The front window must win where windows overlap.");
        Check(CaptureWindows.At(candidates, virtualBounds, new Point(3, 12)) ==
            new Rectangle(0, 0, 220, 190), "Window bounds must be intersected and translated into the screenshot.");
        Check(CaptureWindows.At(candidates, virtualBounds, new Point(470, 290)).IsEmpty,
            "The desktop background must remain available for a manual selection.");

        var desktop = Screen.PrimaryScreen.WorkingArea;
        var crop = new Rectangle(40, 30, 320, 180);
        var bounds = new Rectangle(desktop.Location, new Size(480, 360));
        var windows = new[] { new Rectangle(bounds.X + crop.X, bounds.Y + crop.Y, crop.Width, crop.Height) };
        using (var screen = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppRgb))
        using (var form = new RegionCapture(screen, bounds, windows))
        {
            using (var graphics = Graphics.FromImage(screen)) graphics.Clear(Color.CornflowerBlue);
            form.CreateControl();
            Mouse(form, 0x0200, 0, 80, 65);
            Check(form.Cursor == Cursors.Hand, "Hovering a selectable window must indicate click-to-select.");
            Mouse(form, 0x0201, 1, 80, 65);
            Mouse(form, 0x0202, 0, 80, 65);
            Check(form.DialogResult == DialogResult.None, "Selecting a window should leave the editor open.");
            var toolbar = form.Controls[0];
            var buttons = toolbar.Controls.OfType<Button>().ToArray();
            var undo = buttons.Single(button => button.AccessibleName == "撤销");
            var black = buttons.Single(button => button.AccessibleName == "黑色遮挡");
            var white = buttons.Single(button => button.AccessibleName == "白色遮挡");
            var layout = buttons.Select(button => button.Bounds).ToArray();
            var firstPosition = toolbar.Location;
            Key(form, Keys.T);
            Check(toolbar.Location != firstPosition, "T must move the toolbar to the other side of the selection.");
            Key(form, Keys.T);
            Check(toolbar.Location == firstPosition, "The toolbar must return to its original position on the second press.");
            Check(!undo.Enabled, "Undo must be unavailable in an untouched selection.");
            Check(black.FlatAppearance.BorderSize == 1 && white.FlatAppearance.BorderSize == 0,
                "Black must be the initially selected tool.");
            Mouse(form, 0x0200, 0, 12, 12);
            Check(form.Cursor == Cursors.Default, "The pointer must indicate when drawing is unavailable outside the crop.");
            Drag(form, new Point(60, 50), new Point(112, 92));
            Check(undo.Enabled, "Undo must become available after drawing.");
            Drag(form, new Point(130, 100), new Point(165, 130));
            Key(form, Keys.Control | Keys.Z);
            using (var edited = form.RenderSelection())
            {
                Check(edited.Size == crop.Size, "The rendered window must retain its original pixel dimensions.");
                Check(edited.GetPixel(21, 21).ToArgb() == Color.Black.ToArgb(), "The mask must be baked into the crop.");
                Check(edited.GetPixel(95, 75).ToArgb() == Color.CornflowerBlue.ToArgb(), "Undo must remove the second mask.");
                Check(edited.GetPixel(0, 0).ToArgb() == Color.CornflowerBlue.ToArgb(), "Selection outlines must stay out of the crop.");
            }
            Key(form, Keys.D2);
            Check(black.FlatAppearance.BorderSize == 0 && white.FlatAppearance.BorderSize == 1,
                "Changing tools must move the selection outline to the new tool.");
            Check(layout.SequenceEqual(buttons.Select(button => button.Bounds)), "Changing tools must not move neighboring buttons.");
            Drag(form, new Point(130, 100), new Point(165, 130));
            using (var edited = form.RenderSelection())
                Check(edited.GetPixel(95, 75).ToArgb() == Color.White.ToArgb(), "2 must switch to the white mask.");
            Key(form, Keys.Control | Keys.Z);
            Key(form, Keys.Control | Keys.Z);
            Check(!undo.Enabled, "Undo must become unavailable again after the last mark is undone.");
            Key(form, Keys.R);
            Drag(form, new Point(85, 75), new Point(140, 122));
            using (var edited = form.RenderSelection())
                Check(edited.Size == new Size(55, 47), "R must return the overlay to selection mode.");
        }
        using (var screen = new Bitmap(bounds.Width, bounds.Height))
        using (var form = new RegionCapture(screen, bounds, windows))
        {
            form.CreateControl();
            Drag(form, new Point(90, 75), new Point(35, 28));
            using (var edited = form.RenderSelection())
                Check(edited.Size == new Size(55, 47), "A drag over a window must create a free-form crop.");
        }
        Console.WriteLine("Native capture passed: window and free selection, cursor feedback, tool shortcuts, undo, and flattened pixels.");
    }

    private static void Drag(Control form, Point start, Point end)
    {
        Mouse(form, 0x0201, 1, start.X, start.Y);
        Mouse(form, 0x0200, 1, end.X, end.Y);
        Mouse(form, 0x0202, 0, end.X, end.Y);
    }

    private static void Mouse(Control form, int message, int buttons, int x, int y)
    {
        SendMessage(form.Handle, message, new IntPtr(buttons), new IntPtr((y << 16) | (x & 0xffff)));
    }

    private static void Key(Form form, Keys keys)
    {
        typeof(RegionCapture).GetMethod("ProcessCmdKey", BindingFlags.Instance | BindingFlags.NonPublic)
            .Invoke(form, new object[] { new Message(), keys });
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
