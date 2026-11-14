using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

internal static class CaptureClipboard
{
    internal static void Copy(Bitmap bitmap)
    {
        using (var png = new MemoryStream())
        using (var localOnly = new MemoryStream(new byte[sizeof(int)]))
        {
            bitmap.Save(png, ImageFormat.Png);
            png.Position = 0;
            var data = new DataObject();
            data.SetImage(bitmap);
            data.SetData("PNG", false, png);
            data.SetData("CanUploadToCloudClipboard", false, localOnly);
            Clipboard.SetDataObject(data, true, 6, 45);
        }
    }
}
