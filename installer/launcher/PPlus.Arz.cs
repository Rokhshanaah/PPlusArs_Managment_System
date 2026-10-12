using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Windows.Forms;

namespace PPlusArz
{
    internal static class Program
    {
        private const string AppTitle = "PPlus.Arz";
        private const string HealthUrl = "http://127.0.0.1:5001/api/health";
        private const string OpenUrl = "http://localhost:5001/";
        private static string _logFile;

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            string nodeExe = Path.Combine(root, "runtime", "node-v24.16.0-win-x64", "node.exe");
            string appDir = Path.Combine(root, "app");
            string envFile = Path.Combine(appDir, "server", ".env");
            string envExample = Path.Combine(appDir, "server", ".env.example");
            string bridgeExe = Path.Combine(root, "bridge", "ZKTecoBridge.exe");
            _logFile = Path.Combine(root, "pplus-arz-launch.log");

            if (!File.Exists(nodeExe))
            {
                MessageBox.Show(
                    "Embedded Node.js was not found.\nReinstall PPlus.Arz.",
                    AppTitle,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return;
            }

            if (!Directory.Exists(appDir))
            {
                MessageBox.Show(
                    "Application files are missing.\nReinstall PPlus.Arz.",
                    AppTitle,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return;
            }

            if (!File.Exists(envFile) && File.Exists(envExample))
            {
                File.Copy(envExample, envFile, false);
            }

            TryFreePort(5001);

            if (File.Exists(bridgeExe))
            {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = bridgeExe,
                        WorkingDirectory = Path.GetDirectoryName(bridgeExe),
                        UseShellExecute = true
                    });
                }
                catch
                {
                }
            }

            var psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = "server\\src\\server.js",
                WorkingDirectory = appDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };

            Process server;
            try
            {
                server = Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to start server:\n" + ex.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            if (server == null)
            {
                MessageBox.Show("Failed to start server process.", AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            server.OutputDataReceived += ServerOutput;
            server.ErrorDataReceived += ServerError;
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
            AppendLog("Server started pid=" + server.Id);

            using (var form = new RunningForm(server, AppTitle))
            {
                bool opened = false;
                string lanIp = GetLanIp();
                string mobileUrl = string.IsNullOrEmpty(lanIp) ? "" : ("http://" + lanIp + ":5001/");
                var timer = new Timer();
                timer.Interval = 500;
                int ticks = 0;
                timer.Tick += delegate
                {
                    ticks++;
                    if (server.HasExited)
                    {
                        timer.Stop();
                        form.ShowError(
                            "Server stopped unexpectedly.\n" +
                            "Make sure MySQL (XAMPP) is running.\n" +
                            "Details: " + _logFile);
                        return;
                    }

                    if (!opened && (IsHealthy() || ticks > 40))
                    {
                        opened = true;
                        try
                        {
                            Process.Start(OpenUrl);
                        }
                        catch
                        {
                        }

                        if (!IsHealthy() && ticks > 40)
                        {
                            form.SetStatus("Started — if page is blank, start MySQL then restart PPlus.Arz");
                        }
                        else if (!string.IsNullOrEmpty(mobileUrl))
                        {
                            form.SetStatus("PC: " + OpenUrl + "\nMobile (same Wi-Fi): " + mobileUrl);
                            form.SetMobileUrl(mobileUrl);
                        }
                        else
                        {
                            form.SetStatus("Running at " + OpenUrl);
                        }
                    }
                };
                timer.Start();
                Application.Run(form);
                timer.Stop();
            }

            try
            {
                if (!server.HasExited)
                {
                    server.Kill();
                    server.WaitForExit(3000);
                }
            }
            catch
            {
            }
        }

        private static void ServerOutput(object sender, DataReceivedEventArgs e)
        {
            if (e.Data != null) AppendLog(e.Data);
        }

        private static void ServerError(object sender, DataReceivedEventArgs e)
        {
            if (e.Data != null) AppendLog("ERR " + e.Data);
        }

        private static void AppendLog(string line)
        {
            try
            {
                File.AppendAllText(_logFile, DateTime.Now.ToString("HH:mm:ss") + " " + line + Environment.NewLine);
            }
            catch
            {
            }
        }

        private static bool IsHealthy()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(HealthUrl);
                req.Timeout = 1200;
                req.ReadWriteTimeout = 1200;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    int code = (int)resp.StatusCode;
                    return code >= 200 && code < 300;
                }
            }
            catch
            {
                return false;
            }
        }

        private static string GetLanIp()
        {
            try
            {
                using (System.Net.Sockets.Socket socket = new System.Net.Sockets.Socket(
                    System.Net.Sockets.AddressFamily.InterNetwork,
                    System.Net.Sockets.SocketType.Dgram, 0))
                {
                    socket.Connect("8.8.8.8", 65530);
                    System.Net.IPEndPoint endPoint = socket.LocalEndPoint as System.Net.IPEndPoint;
                    if (endPoint != null) return endPoint.Address.ToString();
                }
            }
            catch
            {
            }

            try
            {
                foreach (IPAddress addr in Dns.GetHostAddresses(Dns.GetHostName()))
                {
                    if (addr.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    {
                        string s = addr.ToString();
                        if (s.StartsWith("192.168.") || s.StartsWith("10.") || s.StartsWith("172."))
                            return s;
                    }
                }
            }
            catch
            {
            }
            return "";
        }

        private static void TryFreePort(int port)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "powershell.exe";
                psi.Arguments =
                    "-NoProfile -Command \"Get-NetTCPConnection -LocalPort " + port +
                    " -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }\"";
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                using (Process p = Process.Start(psi))
                {
                    if (p != null) p.WaitForExit(5000);
                }
            }
            catch
            {
            }
        }
    }

    internal sealed class RunningForm : Form
    {
        private readonly Process _server;
        private readonly Label _status;
        private string _mobileUrl = "";

        public RunningForm(Process server, string title)
        {
            _server = server;
            Text = title;
            Width = 460;
            Height = 220;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;

            try
            {
                string ico = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "zarin-logo.ico");
                if (File.Exists(ico)) Icon = new Icon(ico);
            }
            catch
            {
            }

            Label titleLabel = new Label();
            titleLabel.Text = title;
            titleLabel.AutoSize = false;
            titleLabel.Left = 16;
            titleLabel.Top = 16;
            titleLabel.Width = 410;
            titleLabel.Height = 28;
            titleLabel.Font = new Font("Segoe UI", 14F, FontStyle.Bold);

            _status = new Label();
            _status.Text = "Starting server...";
            _status.AutoSize = false;
            _status.Left = 16;
            _status.Top = 52;
            _status.Width = 410;
            _status.Height = 55;

            Button openBtn = new Button();
            openBtn.Text = "Open App";
            openBtn.Left = 16;
            openBtn.Top = 120;
            openBtn.Width = 110;
            openBtn.Height = 32;
            openBtn.Click += OpenClick;

            Button mobileBtn = new Button();
            mobileBtn.Text = "Copy Mobile URL";
            mobileBtn.Left = 140;
            mobileBtn.Top = 120;
            mobileBtn.Width = 140;
            mobileBtn.Height = 32;
            mobileBtn.Click += MobileCopyClick;

            Button stopBtn = new Button();
            stopBtn.Text = "Stop";
            stopBtn.Left = 294;
            stopBtn.Top = 120;
            stopBtn.Width = 110;
            stopBtn.Height = 32;
            stopBtn.Click += StopClick;

            Controls.Add(titleLabel);
            Controls.Add(_status);
            Controls.Add(openBtn);
            Controls.Add(mobileBtn);
            Controls.Add(stopBtn);

            FormClosing += FormClosingHandler;
        }

        public void SetMobileUrl(string url)
        {
            _mobileUrl = url ?? "";
        }

        private void OpenClick(object sender, EventArgs e)
        {
            try { Process.Start("http://localhost:5001/"); }
            catch { }
        }

        private void MobileCopyClick(object sender, EventArgs e)
        {
            if (string.IsNullOrEmpty(_mobileUrl))
            {
                MessageBox.Show(this, "Mobile URL is not ready yet.", Text);
                return;
            }
            try
            {
                Clipboard.SetText(_mobileUrl);
                MessageBox.Show(this, "Copied for phone:\n" + _mobileUrl, Text);
            }
            catch
            {
                MessageBox.Show(this, _mobileUrl, Text);
            }
        }

        private void StopClick(object sender, EventArgs e)
        {
            Close();
        }

        private void FormClosingHandler(object sender, FormClosingEventArgs e)
        {
            try
            {
                if (_server != null && !_server.HasExited)
                {
                    _server.Kill();
                }
            }
            catch
            {
            }
        }

        public void SetStatus(string text)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(SetStatus), text);
                return;
            }
            _status.Text = text;
        }

        public void ShowError(string text)
        {
            SetStatus(text);
            MessageBox.Show(this, text, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
