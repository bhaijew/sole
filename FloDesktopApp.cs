using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Printing;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Collections.Generic;

namespace FloDesktop
{
    // =========================================================================
    // FloDesktop Native POS Shell & Hardware Service (C#)
    // - Fast Native Windows Executable (FloDesktop.exe)
    // - Direct Win32 Raw Thermal Printing (winspool.drv) - Zero print dialog
    // - Instant Cash Drawer Kick Pulse (ESC/POS)
    // - Process Supervisor for Background POS Engine
    // - Edge/Chromium POS App Window with Multi-Instance Guard
    // - System Tray Notification and Diagnostic Controller
    // =========================================================================

    public class RawPrinterHelper
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
        public class DOCINFOA
        {
            [MarshalAs(UnmanagedType.LPStr)]
            public string pDocName;
            [MarshalAs(UnmanagedType.LPStr)]
            public string pOutputFile;
            [MarshalAs(UnmanagedType.LPStr)]
            public string pDataType;
        }

        [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

        [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

        [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool EndDocPrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool StartPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool EndPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

        public static bool SendBytesToPrinter(string printerName, byte[] bytes, string docTitle)
        {
            if (bytes == null || bytes.Length == 0) return true;
            IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
            Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
            bool success = false;
            IntPtr hPrinter = IntPtr.Zero;
            DOCINFOA di = new DOCINFOA();
            di.pDocName = string.IsNullOrEmpty(docTitle) ? "FloDesktop Receipt" : docTitle;
            di.pDataType = "RAW";

            try
            {
                if (OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
                {
                    if (StartDocPrinter(hPrinter, 1, di))
                    {
                        if (StartPagePrinter(hPrinter))
                        {
                            int dwWritten = 0;
                            success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                            EndPagePrinter(hPrinter);
                        }
                        EndDocPrinter(hPrinter);
                    }
                    ClosePrinter(hPrinter);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[RawPrinterHelper] Error: " + ex.Message);
                success = false;
            }
            finally
            {
                Marshal.FreeCoTaskMem(pUnmanagedBytes);
            }
            return success;
        }

        public static bool KickCashDrawer(string printerName)
        {
            // Standard ESC/POS drawer kick pulse: ESC p m t1 t2
            // Pin 2 pulse: 27, 112, 0, 25, 250
            byte[] pulse = new byte[] { 0x1B, 0x70, 0x00, 0x19, 0xFA };
            return SendBytesToPrinter(printerName, pulse, "Open Cash Drawer");
        }
    }

    public class HardwareHttpServer
    {
        private HttpListener _listener;
        private Thread _serverThread;
        private bool _isRunning = false;
        private const int PORT = 3004;

        public void Start()
        {
            try
            {
                _listener = new HttpListener();
                _listener.Prefixes.Add(string.Format("http://localhost:{0}/", PORT));
                _listener.Prefixes.Add(string.Format("http://127.0.0.1:{0}/", PORT));
                _listener.Start();
                _isRunning = true;
                _serverThread = new Thread(ListenLoop);
                _serverThread.IsBackground = true;
                _serverThread.Start();
                Debug.WriteLine("[HardwareServer] Listening on port " + PORT);
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[HardwareServer] Start error: " + ex.Message);
            }
        }

        public void Stop()
        {
            _isRunning = false;
            if (_listener != null)
            {
                try { _listener.Stop(); } catch { }
            }
        }

        private void ListenLoop()
        {
            while (_isRunning && _listener != null && _listener.IsListening)
            {
                try
                {
                    HttpListenerContext context = _listener.GetContext();
                    ThreadPool.QueueUserWorkItem(ProcessRequest, context);
                }
                catch
                {
                    if (!_isRunning) break;
                }
            }
        }

        private void ProcessRequest(object state)
        {
            HttpListenerContext context = (HttpListenerContext)state;
            HttpListenerRequest req = context.Request;
            HttpListenerResponse res = context.Response;

            // CORS headers
            res.Headers.Add("Access-Control-Allow-Origin", "*");
            res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization");

            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = 200;
                res.Close();
                return;
            }

            string rawUrl = req.Url.AbsolutePath.ToLowerInvariant();
            byte[] responseBytes = new byte[0];
            res.ContentType = "application/json";

            try
            {
                if (rawUrl == "/status" || rawUrl == "/api/status")
                {
                    string json = "{\"status\":\"ok\",\"service\":\"FloDesktop C# Hardware Bridge\",\"version\":\"1.5.0\",\"port\":3004}";
                    responseBytes = Encoding.UTF8.GetBytes(json);
                }
                else if (rawUrl == "/printers" || rawUrl == "/api/printers")
                {
                    List<string> list = new List<string>();
                    foreach (string p in PrinterSettings.InstalledPrinters)
                    {
                        list.Add(string.Format("\"{0}\"", p.Replace("\\", "\\\\").Replace("\"", "\\\"")));
                    }
                    string json = "[" + string.Join(",", list.ToArray()) + "]";
                    responseBytes = Encoding.UTF8.GetBytes(json);
                }
                else if (rawUrl == "/kick-drawer" || rawUrl == "/api/kick-drawer")
                {
                    string printerName = req.QueryString["printer"];
                    if (string.IsNullOrEmpty(printerName))
                    {
                        PrinterSettings ps = new PrinterSettings();
                        printerName = ps.PrinterName;
                    }

                    bool kicked = RawPrinterHelper.KickCashDrawer(printerName);
                    string json = string.Format("{{\"success\":{0},\"printer\":\"{1}\",\"action\":\"kick-drawer\"}}", kicked ? "true" : "false", printerName);
                    responseBytes = Encoding.UTF8.GetBytes(json);
                }
                else if (rawUrl == "/print-raw" || rawUrl == "/api/print-raw")
                {
                    string printerName = req.QueryString["printer"];
                    if (string.IsNullOrEmpty(printerName))
                    {
                        PrinterSettings ps = new PrinterSettings();
                        printerName = ps.PrinterName;
                    }

                    byte[] bodyBytes;
                    using (MemoryStream ms = new MemoryStream())
                    {
                        req.InputStream.CopyTo(ms);
                        bodyBytes = ms.ToArray();
                    }

                    bool printed = RawPrinterHelper.SendBytesToPrinter(printerName, bodyBytes, "Flo POS Print");
                    string json = string.Format("{{\"success\":{0},\"printer\":\"{1}\",\"bytes\":{2}}}", printed ? "true" : "false", printerName, bodyBytes.Length);
                    responseBytes = Encoding.UTF8.GetBytes(json);
                }
                else
                {
                    res.StatusCode = 404;
                    string json = "{\"error\":\"Not found\"}";
                    responseBytes = Encoding.UTF8.GetBytes(json);
                }
            }
            catch (Exception ex)
            {
                res.StatusCode = 500;
                string json = string.Format("{{\"error\":\"{0}\"}}", ex.Message.Replace("\"", "'"));
                responseBytes = Encoding.UTF8.GetBytes(json);
            }

            try
            {
                res.ContentLength64 = responseBytes.Length;
                res.OutputStream.Write(responseBytes, 0, responseBytes.Length);
                res.Close();
            }
            catch { }
        }
    }

    public class FloDesktopContext : ApplicationContext
    {
        private NotifyIcon _trayIcon;
        private Process _backendProcess;
        private Process _edgeProcess;
        private HardwareHttpServer _hwServer;
        private string _appDir;
        private System.Windows.Forms.Timer _healthCheckTimer;

        public FloDesktopContext()
        {
            _appDir = AppDomain.CurrentDomain.BaseDirectory;

            InitTrayIcon();
            StartHardwareBridge();
            StartBackendAndOpenWindow();
        }

        private void InitTrayIcon()
        {
            ContextMenu menu = new ContextMenu();
            menu.MenuItems.Add("🍕 Open POS Terminal", OnOpenPosClicked);
            menu.MenuItems.Add("🖨️ Test Thermal Printer", OnTestPrinterClicked);
            menu.MenuItems.Add("💵 Kick Cash Drawer", OnKickDrawerClicked);
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("🔄 Restart POS Server", OnRestartServerClicked);
            menu.MenuItems.Add("🚪 Exit FloDesktop", OnExitClicked);

            _trayIcon = new NotifyIcon();
            _trayIcon.Text = "FloDesktop Pizza POS - Native C#";
            _trayIcon.ContextMenu = menu;
            _trayIcon.Visible = true;
            _trayIcon.DoubleClick += OnOpenPosClicked;

            string iconPath = Path.Combine(_appDir, @"assets\icon.ico");
            if (File.Exists(iconPath))
            {
                try { _trayIcon.Icon = new Icon(iconPath); }
                catch { _trayIcon.Icon = SystemIcons.Application; }
            }
            else
            {
                _trayIcon.Icon = SystemIcons.Application;
            }
        }

        private void StartHardwareBridge()
        {
            _hwServer = new HardwareHttpServer();
            _hwServer.Start();
        }

        private bool IsServerHealthy()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://localhost:3001/api/health");
                req.Timeout = 1200;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return res.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private void StartBackendAndOpenWindow()
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                if (!IsServerHealthy())
                {
                    StartBackendProcess();
                    int waited = 0;
                    while (waited < 12000 && !IsServerHealthy())
                    {
                        Thread.Sleep(300);
                        waited += 300;
                    }
                }

                OpenEdgeAppWindow();
            });
        }

        private void StartBackendProcess()
        {
            try
            {
                string nodePath = FindNodeExecutable();
                if (string.IsNullOrEmpty(nodePath))
                {
                    MessageBox.Show("Node.js runtime was not found. Please ensure Node.js is installed on this machine.", "FloDesktop POS", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                string scriptFile = "server.js";
                if (!File.Exists(Path.Combine(_appDir, scriptFile)))
                {
                    if (File.Exists(Path.Combine(_appDir, "dist\\index.js")))
                    {
                        scriptFile = "dist\\index.js";
                    }
                }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodePath;
                psi.Arguments = scriptFile;
                psi.WorkingDirectory = _appDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;

                if (nodePath.EndsWith("electron.exe", StringComparison.OrdinalIgnoreCase))
                {
                    psi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
                }

                _backendProcess = Process.Start(psi);
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[Backend] Start error: " + ex.Message);
            }
        }

        private string FindNodeExecutable()
        {
            // Prefer local project electron.exe so native addons like better-sqlite3 match ABI 125 perfectly
            string localElectron = Path.Combine(_appDir, @"node_modules\electron\dist\electron.exe");
            if (File.Exists(localElectron)) return localElectron;

            string[] commonPaths = new string[]
            {
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe"),
                "node.exe"
            };

            foreach (string path in commonPaths)
            {
                if (File.Exists(path)) return path;
            }

            try
            {
                Process p = new Process();
                p.StartInfo.FileName = "where.exe";
                p.StartInfo.Arguments = "node";
                p.StartInfo.UseShellExecute = false;
                p.StartInfo.RedirectStandardOutput = true;
                p.StartInfo.CreateNoWindow = true;
                p.Start();
                string output = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                if (!string.IsNullOrEmpty(output))
                {
                    string firstLine = output.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)[0];
                    if (File.Exists(firstLine)) return firstLine;
                }
            }
            catch { }

            return "node.exe";
        }

        public static string FindEdgeExecutable()
        {
            string[] edgePaths = new string[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Google\Chrome\Application\chrome.exe"
            };

            foreach (string p in edgePaths)
            {
                if (File.Exists(p)) return p;
            }
            return null;
        }

        private void OpenEdgeAppWindow()
        {
            try
            {
                string browserPath = FindEdgeExecutable();
                string targetUrl = "http://localhost:3001";

                if (!string.IsNullOrEmpty(browserPath))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = browserPath;
                    psi.Arguments = string.Format("--app={0} --start-maximized --disable-translate --disable-features=TranslateUI --no-first-run", targetUrl);
                    _edgeProcess = Process.Start(psi);
                }
                else
                {
                    Process.Start(targetUrl);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Could not launch POS display: " + ex.Message, "FloDesktop POS");
            }
        }

        private void OnOpenPosClicked(object sender, EventArgs e)
        {
            OpenEdgeAppWindow();
        }

        private void OnTestPrinterClicked(object sender, EventArgs e)
        {
            try
            {
                PrinterSettings ps = new PrinterSettings();
                string defaultPrinter = ps.PrinterName;

                // Send test ESC/POS receipt
                StringBuilder sb = new StringBuilder();
                sb.Append("\x1B\x40"); // Initialize
                sb.Append("\x1B\x61\x01"); // Center
                sb.Append("================================\n");
                sb.Append("    FLODESKTOP C# POS TEST      \n");
                sb.Append("================================\n");
                sb.Append("\x1B\x61\x00"); // Left
                sb.Append(string.Format("Printer: {0}\n", defaultPrinter));
                sb.Append(string.Format("Date: {0}\n", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")));
                sb.Append("Engine: Native C# Raw ESC/POS\n");
                sb.Append("Print Dialog: ZERO (Direct Win32)\n");
                sb.Append("--------------------------------\n");
                sb.Append("  Status: PRINTER READY  [OK]   \n");
                sb.Append("================================\n\n\n\n");
                sb.Append("\x1D\x56\x41\x03"); // Cut paper

                byte[] bytes = Encoding.ASCII.GetBytes(sb.ToString());
                bool ok = RawPrinterHelper.SendBytesToPrinter(defaultPrinter, bytes, "Flo Test Print");

                if (ok)
                {
                    _trayIcon.ShowBalloonTip(3000, "Printer Test", "Test receipt sent successfully to " + defaultPrinter, ToolTipIcon.Info);
                }
                else
                {
                    MessageBox.Show("Failed to print to: " + defaultPrinter + ".\nPlease verify printer connection in Windows Settings.", "FloDesktop Print Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Print error: " + ex.Message);
            }
        }

        private void OnKickDrawerClicked(object sender, EventArgs e)
        {
            try
            {
                PrinterSettings ps = new PrinterSettings();
                bool ok = RawPrinterHelper.KickCashDrawer(ps.PrinterName);
                if (ok)
                {
                    _trayIcon.ShowBalloonTip(2000, "Cash Drawer", "Cash drawer pulse signal sent.", ToolTipIcon.Info);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Cash drawer error: " + ex.Message);
            }
        }

        private void OnRestartServerClicked(object sender, EventArgs e)
        {
            try
            {
                if (_backendProcess != null && !_backendProcess.HasExited)
                {
                    _backendProcess.Kill();
                }
            }
            catch { }

            StartBackendAndOpenWindow();
            _trayIcon.ShowBalloonTip(2500, "POS Server", "Restarting local POS engine...", ToolTipIcon.Info);
        }

        private void OnExitClicked(object sender, EventArgs e)
        {
            if (MessageBox.Show("Are you sure you want to exit FloDesktop POS?", "Exit FloDesktop", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
            {
                ExitThread();
            }
        }

        protected override void ExitThreadCore()
        {
            if (_trayIcon != null)
            {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
            }

            if (_hwServer != null)
            {
                _hwServer.Stop();
            }

            try
            {
                if (_backendProcess != null && !_backendProcess.HasExited)
                {
                    _backendProcess.Kill();
                }
            }
            catch { }

            base.ExitThreadCore();
        }
    }

    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool createdNew;
            using (Mutex mutex = new Mutex(true, "FloDesktop_POS_SingleInstance_Mutex_Pizza", out createdNew))
            {
                if (!createdNew)
                {
                    try
                    {
                        string browserPath = FloDesktopContext.FindEdgeExecutable();
                        string targetUrl = "http://localhost:3001";
                        if (!string.IsNullOrEmpty(browserPath))
                        {
                            ProcessStartInfo psi = new ProcessStartInfo();
                            psi.FileName = browserPath;
                            psi.Arguments = string.Format("--app={0} --start-maximized --disable-translate --disable-features=TranslateUI --no-first-run", targetUrl);
                            Process.Start(psi);
                        }
                        else
                        {
                            Process.Start(targetUrl);
                        }
                    }
                    catch { }
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new FloDesktopContext());
            }
        }
    }
}
