using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using libzkfpcsharp;

namespace ZKTecoBridge
{
    internal class Enrollment
    {
        public int Fid { get; set; }
        public string CustomerId { get; set; }
        public string CustomerName { get; set; }
        public string Phone { get; set; }
        public string DocumentNumber { get; set; }
        public string CardNumber { get; set; }
        public string BankName { get; set; }
        public string CardHolderName { get; set; }
        public string PhotoUrl { get; set; }
        public string FingerprintUrl { get; set; }
        public object Balances { get; set; }
        public string FingerprintTemplate { get; set; }
        public string FingerprintFormat { get; set; }
    }

    internal class SyncBody
    {
        public List<Enrollment> Enrollments { get; set; }
    }

    internal sealed class ZkScanner : IDisposable
    {
        private IntPtr _device = IntPtr.Zero;
        private IntPtr _db = IntPtr.Zero;
        private int _width = 0;
        private int _height = 0;
        private bool _initialized = false;

        public bool Ready
        {
            get
            {
                return _initialized && _device != IntPtr.Zero && _db != IntPtr.Zero;
            }
        }
        public string DeviceName { get; private set; }

        public ZkScanner()
        {
            DeviceName = "ZKTeco Fingerprint Scanner";
        }

        public void Start()
        {
            if (_initialized) return;

            int ret = zkfp2.Init();
            if (ret != zkfperrdef.ZKFP_ERR_OK)
                throw new Exception("ZKFinger SDK initialization failed: " + ret);

            int count = zkfp2.GetDeviceCount();
            if (count <= 0)
            {
                zkfp2.Terminate();
                throw new Exception("No ZKTeco fingerprint scanner found.");
            }

            _device = zkfp2.OpenDevice(0);
            if (_device == IntPtr.Zero)
            {
                zkfp2.Terminate();
                throw new Exception("Could not open ZKTeco scanner.");
            }

            _db = zkfp2.DBInit();
            if (_db == IntPtr.Zero)
            {
                zkfp2.CloseDevice(_device);
                _device = IntPtr.Zero;
                zkfp2.Terminate();
                throw new Exception("Could not initialize ZKFinger matching database.");
            }

            _width = ReadIntParameter(1);
            _height = ReadIntParameter(2);

            if (_width <= 0) _width = 256;
            if (_height <= 0) _height = 288;

            _initialized = true;
        }

        private int ReadIntParameter(int code)
        {
            byte[] value = new byte[4];
            int size = 4;
            int ret = zkfp2.GetParameters(_device, code, value, ref size);
            if (ret != zkfperrdef.ZKFP_ERR_OK) return 0;
            return BitConverter.ToInt32(value, 0);
        }

        public void ClearTemplates()
        {
            EnsureReady();
            zkfp2.DBClear(_db);
        }

        public int AddTemplate(int fid, string base64)
        {
            EnsureReady();
            byte[] template = Convert.FromBase64String(base64);
            return zkfp2.DBAdd(_db, fid, template);
        }

        public CaptureResult Capture(int timeoutMs)
        {
            EnsureReady();

            byte[] image = new byte[_width * _height];
            byte[] template = new byte[2048];
            int templateLength = template.Length;

            DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);

            while (DateTime.UtcNow < deadline)
            {
                templateLength = template.Length;
                int ret = zkfp2.AcquireFingerprint(
                    _device,
                    image,
                    template,
                    ref templateLength
                );

                if (ret == zkfperrdef.ZKFP_ERR_OK && templateLength > 0)
                {
                    byte[] exactTemplate = new byte[templateLength];
                    Buffer.BlockCopy(template, 0, exactTemplate, 0, templateLength);

                    return new CaptureResult
                    {
                        Template = exactTemplate,
                        Image = image,
                        ImageDataUrl = MakePngDataUrl(image, _width, _height),
                    };
                }

                Thread.Sleep(120);
            }

            throw new TimeoutException("Fingerprint was not detected. Place the finger flat on the scanner.");
        }

        public IdentifyResult Identify(byte[] template)
        {
            EnsureReady();

            int fid = 0;
            int score = 0;
            int ret = zkfp2.DBIdentify(_db, template, ref fid, ref score);

            return new IdentifyResult
            {
                Matched = ret == zkfperrdef.ZKFP_ERR_OK && fid > 0,
                Fid = fid,
                Score = score,
                ResultCode = ret,
            };
        }

        public byte[] EnrollThreeCaptures(int timeoutMs, out string imageDataUrl)
        {
            // ZKFinger enrollment is more reliable when the same finger is captured 3 times.
            CaptureResult a = Capture(timeoutMs);
            Thread.Sleep(450);
            CaptureResult b = Capture(timeoutMs);
            Thread.Sleep(450);
            CaptureResult c = Capture(timeoutMs);

            imageDataUrl = c.ImageDataUrl;

            byte[] merged = new byte[2048];
            int mergedLength = merged.Length;

            int ret = zkfp2.DBMerge(
                _db,
                a.Template,
                b.Template,
                c.Template,
                merged,
                ref mergedLength
            );

            if (ret != zkfperrdef.ZKFP_ERR_OK)
                throw new Exception("Could not create registered fingerprint template. ZK error: " + ret);

            byte[] exact = new byte[mergedLength];
            Buffer.BlockCopy(merged, 0, exact, 0, mergedLength);
            return exact;
        }

        private void EnsureReady()
        {
            if (!Ready)
                throw new Exception("ZKTeco scanner is not initialized.");
        }

        private static string MakePngDataUrl(byte[] gray, int width, int height)
        {
            using (var bmp = new Bitmap(width, height, PixelFormat.Format24bppRgb))
            {
                for (int y = 0; y < height; y++)
                {
                    for (int x = 0; x < width; x++)
                    {
                        byte v = gray[y * width + x];
                        bmp.SetPixel(x, y, Color.FromArgb(v, v, v));
                    }
                }

                using (var ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
                }
            }
        }

        public void Dispose()
        {
            try
            {
                if (_db != IntPtr.Zero)
                {
                    zkfp2.DBFree(_db);
                    _db = IntPtr.Zero;
                }
            }
            catch { }

            try
            {
                if (_device != IntPtr.Zero)
                {
                    zkfp2.CloseDevice(_device);
                    _device = IntPtr.Zero;
                }
            }
            catch { }

            try { zkfp2.Terminate(); } catch { }

            _initialized = false;
        }
    }

    internal class CaptureResult
    {
        public byte[] Template { get; set; }
        public byte[] Image { get; set; }
        public string ImageDataUrl { get; set; }
    }

    internal class IdentifyResult
    {
        public bool Matched { get; set; }
        public int Fid { get; set; }
        public int Score { get; set; }
        public int ResultCode { get; set; }
    }

    internal static class Program
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer
        {
            MaxJsonLength = int.MaxValue
        };

        private static readonly Dictionary<int, Enrollment> IdentityByFid =
            new Dictionary<int, Enrollment>();

        private static readonly ZkScanner Scanner = new ZkScanner();

        private static HttpListener _listener;

        public static void Main()
        {
            Console.OutputEncoding = Encoding.UTF8;

            try
            {
                Scanner.Start();
                Console.WriteLine("ZKTeco scanner initialized.");
            }
            catch (Exception ex)
            {
                Console.WriteLine("Scanner startup warning: " + ex.Message);
                Console.WriteLine("The bridge will stay open. Connect/install the scanner and restart this app.");
            }

            _listener = new HttpListener();
            _listener.Prefixes.Add("http://127.0.0.1:18181/");
            _listener.Start();

            Console.WriteLine("ZKTeco Bridge: http://127.0.0.1:18181");
            Console.WriteLine("Keep this window open while using the web application.");

            while (true)
            {
                HttpListenerContext ctx = _listener.GetContext();
                ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
            }
        }

        private static void Handle(HttpListenerContext ctx)
        {
            try
            {
                AddCors(ctx.Response);

                if (ctx.Request.HttpMethod == "OPTIONS")
                {
                    ctx.Response.StatusCode = 204;
                    ctx.Response.Close();
                    return;
                }

                string path = ctx.Request.Url.AbsolutePath.TrimEnd('/').ToLowerInvariant();

                if (path == "/health" && ctx.Request.HttpMethod == "GET")
                {
                    if (!Scanner.Ready)
                    {
                        TryRestartScanner();
                    }

                    WriteJson(ctx, 200, new
                    {
                        ok = Scanner.Ready,
                        deviceName = Scanner.DeviceName,
                        templates = IdentityByFid.Count,
                        message = Scanner.Ready
                            ? "ZKTeco scanner is ready."
                            : "Scanner not ready. Check driver, USB and SDK DLL files."
                    });
                    return;
                }

                if (path == "/templates/sync" && ctx.Request.HttpMethod == "POST")
                {
                    EnsureScanner();

                    SyncBody body = ReadBody<SyncBody>(ctx);
                    Scanner.ClearTemplates();
                    IdentityByFid.Clear();

                    int fid = 1;
                    int loaded = 0;

                    foreach (Enrollment enrollment in body.Enrollments ?? new List<Enrollment>())
                    {
                        if (string.IsNullOrWhiteSpace(enrollment.FingerprintTemplate))
                            continue;

                        try
                        {
                            int ret = Scanner.AddTemplate(fid, enrollment.FingerprintTemplate);

                            if (ret == zkfperrdef.ZKFP_ERR_OK)
                            {
                                enrollment.Fid = fid;
                                IdentityByFid[fid] = enrollment;
                                fid++;
                                loaded++;
                            }
                        }
                        catch
                        {
                            // Ignore malformed old template and continue.
                        }
                    }

                    WriteJson(ctx, 200, new
                    {
                        ok = true,
                        loaded = loaded
                    });
                    return;
                }

                if (path == "/scan-identify" && ctx.Request.HttpMethod == "POST")
                {
                    EnsureScanner();
                    Dictionary<string, object> body = ReadBody<Dictionary<string, object>>(ctx);
                    int timeoutMs = GetInt(body, "timeoutMs", 15000);

                    CaptureResult capture = Scanner.Capture(timeoutMs);
                    IdentifyResult identify = Scanner.Identify(capture.Template);

                    Enrollment identity;
                    if (identify.Matched && IdentityByFid.TryGetValue(identify.Fid, out identity))
                    {
                        WriteJson(ctx, 200, new
                        {
                            ok = true,
                            matched = true,
                            score = identify.Score,
                            identity = identity,
                            fingerprintImage = capture.ImageDataUrl
                        });
                        return;
                    }

                    WriteJson(ctx, 200, new
                    {
                        ok = true,
                        matched = false,
                        score = identify.Score,
                        fingerprintImage = capture.ImageDataUrl
                    });
                    return;
                }

                if (path == "/scan-enroll" && ctx.Request.HttpMethod == "POST")
                {
                    EnsureScanner();
                    Dictionary<string, object> body = ReadBody<Dictionary<string, object>>(ctx);
                    int timeoutMs = GetInt(body, "timeoutMs", 15000);

                    // First capture: if this finger already exists, don't enroll it again.
                    CaptureResult first = Scanner.Capture(timeoutMs);
                    IdentifyResult duplicateCheck = Scanner.Identify(first.Template);

                    Enrollment existing;
                    if (duplicateCheck.Matched
                        && IdentityByFid.TryGetValue(duplicateCheck.Fid, out existing))
                    {
                        WriteJson(ctx, 200, new
                        {
                            ok = true,
                            duplicate = true,
                            matched = true,
                            score = duplicateCheck.Score,
                            identity = existing,
                            fingerprintImage = first.ImageDataUrl
                        });
                        return;
                    }

                    // New finger: capture 3 times and merge.
                    // The user should keep the same finger on / re-place it when requested by scanner.
                    string imageDataUrl;
                    byte[] registered = Scanner.EnrollThreeCaptures(timeoutMs, out imageDataUrl);

                    // Final duplicate check on merged template.
                    IdentifyResult finalDuplicate = Scanner.Identify(registered);

                    Enrollment existingFinal;
                    if (finalDuplicate.Matched
                        && IdentityByFid.TryGetValue(finalDuplicate.Fid, out existingFinal))
                    {
                        WriteJson(ctx, 200, new
                        {
                            ok = true,
                            duplicate = true,
                            matched = true,
                            score = finalDuplicate.Score,
                            identity = existingFinal,
                            fingerprintImage = imageDataUrl
                        });
                        return;
                    }

                    WriteJson(ctx, 200, new
                    {
                        ok = true,
                        duplicate = false,
                        template = Convert.ToBase64String(registered),
                        format = "ZK10",
                        fingerprintImage = imageDataUrl
                    });
                    return;
                }

                WriteJson(ctx, 404, new
                {
                    ok = false,
                    message = "Route not found."
                });
            }
            catch (Exception ex)
            {
                WriteJson(ctx, 500, new
                {
                    ok = false,
                    message = ex.Message
                });
            }
        }

        private static void EnsureScanner()
        {
            if (!Scanner.Ready)
            {
                TryRestartScanner();
            }

            if (!Scanner.Ready)
                throw new Exception("ZKTeco scanner is not ready. Install driver/SDK and reconnect USB.");
        }

        private static void TryRestartScanner()
        {
            try
            {
                Scanner.Dispose();
                Scanner.Start();
            }
            catch { }
        }

        private static int GetInt(Dictionary<string, object> body, string key, int fallback)
        {
            if (body == null || !body.ContainsKey(key) || body[key] == null)
                return fallback;

            int value;
            if (int.TryParse(Convert.ToString(body[key]), out value))
                return value;

            return fallback;
        }

        private static T ReadBody<T>(HttpListenerContext ctx)
        {
            using (var reader = new StreamReader(
                ctx.Request.InputStream,
                ctx.Request.ContentEncoding ?? Encoding.UTF8))
            {
                string json = reader.ReadToEnd();
                if (string.IsNullOrWhiteSpace(json))
                    json = "{}";
                return Json.Deserialize<T>(json);
            }
        }

        private static void WriteJson(HttpListenerContext ctx, int status, object data)
        {
            try
            {
                string json = Json.Serialize(data);
                byte[] bytes = Encoding.UTF8.GetBytes(json);

                ctx.Response.StatusCode = status;
                ctx.Response.ContentType = "application/json; charset=utf-8";
                ctx.Response.ContentEncoding = Encoding.UTF8;
                ctx.Response.ContentLength64 = bytes.Length;
                AddCors(ctx.Response);

                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                ctx.Response.OutputStream.Close();
            }
            catch
            {
                try { ctx.Response.Close(); } catch { }
            }
        }

        private static void AddCors(HttpListenerResponse response)
        {
            response.Headers["Access-Control-Allow-Origin"] = "*";
            response.Headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
            response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        }
    }
}
