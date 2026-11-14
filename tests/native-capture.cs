using System;
using System.Drawing;
using System.Drawing.Imaging;
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
            Mouse(form, 0x0201, 1, 80, 65);
            Mouse(form, 0x0202, 0, 80, 65);
            Check(form.DialogResult == DialogResult.None, "Selecting a window should leave the editor open.");
            Drag(form, new Point(60, 50), new Point(112, 92));
            Drag(form, new Point(130, 100), new Point(165, 130));
            Check(form.TryUndo(), "The most recent mask should be undoable.");
            using (var edited = form.RenderSelection())
            {
                Check(edited.Size == crop.Size, "The rendered window must retain its original pixel dimensions.");
                Check(edited.GetPixel(21, 21).ToArgb() == Color.Black.ToArgb(), "The mask must be baked into the crop.");
                Check(edited.GetPixel(95, 75).ToArgb() == Color.CornflowerBlue.ToArgb(), "Undo must remove the second mask.");
                Check(edited.GetPixel(0, 0).ToArgb() == Color.CornflowerBlue.ToArgb(), "Selection outlines must stay out of the crop.");
            }
        }
        using (var screen = new Bitmap(bounds.Width, bounds.Height))
        using (var form = new RegionCapture(screen, bounds, windows))
        {
            form.CreateControl();
            Drag(form, new Point(90, 75), new Point(35, 28));
            using (var edited = form.RenderSelection())
                Check(edited.Size == new Size(55, 47), "A drag over a window must create a free-form crop.");
        }
        Console.WriteLine("Native capture passed: window hit testing, free selection, editing, and flattened pixels.");
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

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
