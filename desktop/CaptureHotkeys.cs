using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;

internal sealed class CaptureHotkeys
{
    internal const int Message = 0x0312;
    private static readonly Binding DefaultCapture = new Binding(6, 120);
    private static readonly Binding DefaultHistory = new Binding(6, 121);
    private readonly string path;
    private Binding capture = DefaultCapture, history = DefaultHistory;
    private int captureSlot, historySlot;
    private int nextSlot;

    [DllImport("user32.dll")] private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr window, int id);

    internal CaptureHotkeys(string path) { this.path = path; }
    internal int CaptureSlot { get { return captureSlot; } }
    internal int HistorySlot { get { return historySlot; } }
    internal string Settings { get { return "hotkeys|" + capture + "|" + history; } }
    internal string BindingFor(int slot) { return slot == captureSlot ? capture.ToString() : history.ToString(); }

    internal bool Initialize(IntPtr window)
    {
        try
        {
            Binding first, second;
            var lines = File.ReadAllLines(path);
            if (lines.Length == 2 && ParsePair(lines[0], lines[1], out first, out second)) { capture = first; history = second; }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        captureSlot = Reserve(window, capture);
        historySlot = Reserve(window, history);
        return captureSlot != 0 && historySlot != 0;
    }

    internal string Change(IntPtr window, string firstValue, string secondValue)
    {
        Binding first, second;
        if (!ParsePair(firstValue, secondValue, out first, out second)) return "请为两个功能设置不同的有效快捷键。";
        var firstSlot = Reuse(first);
        var secondSlot = Reuse(second);
        var newFirst = firstSlot == 0;
        var newSecond = secondSlot == 0;
        if (newFirst) firstSlot = Reserve(window, first);
        if (newSecond) secondSlot = Reserve(window, second);
        if (firstSlot == 0 || secondSlot == 0)
        {
            if (newFirst) Release(window, firstSlot);
            if (newSecond) Release(window, secondSlot);
            return firstSlot == 0 ? "区域截屏快捷键已被占用，请换一组。" : "截图剪贴板快捷键已被占用，请换一组。";
        }
        try { Save(first, second); }
        catch (IOException) { return Abort(window, newFirst ? firstSlot : 0, newSecond ? secondSlot : 0); }
        catch (UnauthorizedAccessException) { return Abort(window, newFirst ? firstSlot : 0, newSecond ? secondSlot : 0); }
        if (captureSlot != firstSlot && captureSlot != secondSlot) Release(window, captureSlot);
        if (historySlot != firstSlot && historySlot != secondSlot) Release(window, historySlot);
        capture = first;
        history = second;
        captureSlot = firstSlot;
        historySlot = secondSlot;
        return null;
    }

    private void Save(Binding first, Binding second)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, first + "\n" + second);
            if (File.Exists(path)) File.Replace(temporary, path, null);
            else File.Move(temporary, path);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static string Abort(IntPtr window, int first, int second)
    {
        Release(window, first);
        Release(window, second);
        return "无法保存快捷键，已保留原设置。";
    }

    private int Reuse(Binding binding)
    {
        if (binding.SameAs(capture) && captureSlot != 0) return captureSlot;
        return binding.SameAs(history) ? historySlot : 0;
    }

    private int Reserve(IntPtr window, Binding binding)
    {
        do { nextSlot = nextSlot == 0xBFFF ? 1 : nextSlot + 1; }
        while (nextSlot == captureSlot || nextSlot == historySlot);
        return RegisterHotKey(window, nextSlot, binding.Modifiers | 0x4000, binding.Key) ? nextSlot : 0;
    }

    internal void Close(IntPtr window)
    {
        Release(window, captureSlot);
        Release(window, historySlot);
    }

    private static void Release(IntPtr window, int slot) { if (slot != 0) UnregisterHotKey(window, slot); }

    private static bool ParsePair(string one, string two, out Binding first, out Binding second)
    {
        var validFirst = Binding.TryParse(one, out first);
        var validSecond = Binding.TryParse(two, out second);
        return validFirst && validSecond && !first.SameAs(second);
    }

    private struct Binding
    {
        internal readonly uint Modifiers, Key;
        internal Binding(uint modifiers, uint key) { Modifiers = modifiers; Key = key; }
        internal bool SameAs(Binding other) { return Modifiers == other.Modifiers && Key == other.Key; }
        public override string ToString() { return Modifiers.ToString(CultureInfo.InvariantCulture) + ":" + Key.ToString(CultureInfo.InvariantCulture); }

        internal static bool TryParse(string value, out Binding binding)
        {
            binding = default(Binding);
            var parts = value.Split(':');
            uint modifiers, key;
            if (parts.Length != 2 || !uint.TryParse(parts[0], out modifiers) || !uint.TryParse(parts[1], out key) ||
                modifiers > 7 || (modifiers & 3) == 0 || !((key >= 48 && key <= 57) || (key >= 65 && key <= 90) || (key >= 112 && key <= 122))) return false;
            binding = new Binding(modifiers, key);
            return true;
        }
    }
}
