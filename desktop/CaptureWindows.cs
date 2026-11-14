using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;

internal static class CaptureWindows
{
    private const int ExtendedFrameBounds = 9;
    private const int Cloaked = 14;
    private const int ExtendedStyle = -20;
    private const int ClickThroughLayered = 0x80020;

    internal static Rectangle[] Snapshot(IntPtr excludedWindow)
    {
        var windows = new List<Rectangle>();
        var name = new StringBuilder(128);
        EnumWindows((window, parameter) => {
            if (window == excludedWindow || !IsWindowVisible(window) || IsIconic(window)) return true;
            if ((GetWindowLong(window, ExtendedStyle) & ClickThroughLayered) == ClickThroughLayered) return true;
            int cloaked;
            if (GetDwmInt(window, Cloaked, out cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
            name.Clear();
            GetClassName(window, name, name.Capacity);
            switch (name.ToString())
            {
                case "Progman": case "WorkerW": case "Shell_TrayWnd": case "Shell_SecondaryTrayWnd":
                    return true;
            }

            NativeRect frame;
            if (GetDwmRect(window, ExtendedFrameBounds, out frame, Marshal.SizeOf(typeof(NativeRect))) != 0 &&
                !GetWindowRect(window, out frame)) return true;
            var rect = Rectangle.FromLTRB(frame.Left, frame.Top, frame.Right, frame.Bottom);
            if (rect.Width >= 3 && rect.Height >= 3) windows.Add(rect);
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    internal static Rectangle At(IEnumerable<Rectangle> windows, Rectangle bounds, Point location)
    {
        var pointer = new Point(bounds.X + location.X, bounds.Y + location.Y);
        foreach (var window in windows)
        {
            if (!window.Contains(pointer)) continue;
            var result = Rectangle.Intersect(bounds, window);
            result.Offset(-bounds.X, -bounds.Y);
            return result;
        }
        return Rectangle.Empty;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left, Top, Right, Bottom; }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")]
    private static extern int GetDwmRect(IntPtr window, int attribute, out NativeRect value, int size);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")]
    private static extern int GetDwmInt(IntPtr window, int attribute, out int value, int size);
    [DllImport("user32.dll")]
    internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    internal static extern bool SetForegroundWindow(IntPtr window);
}
