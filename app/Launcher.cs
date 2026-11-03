// BMC6 Launcher : application Windows native (WinForms). Le "moteur" (installation, mods, connexion, lancement)
// est le serveur Node de src/, demarre en arriere-plan sans fenetre ; cette application n'est que l'interface.
// Compilee avec le compilateur C# fourni par Windows (voir tools/build-exe.js) : rien a installer.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Theme
{
    public static readonly Color Bg = Color.FromArgb(10, 12, 16);
    public static readonly Color Card = Color.FromArgb(17, 20, 26);
    public static readonly Color Card2 = Color.FromArgb(23, 27, 35);
    public static readonly Color Line = Color.FromArgb(46, 53, 65);
    public static readonly Color Text = Color.FromArgb(232, 234, 238);
    public static readonly Color Muted = Color.FromArgb(138, 146, 160);
    public static readonly Color Accent = Color.FromArgb(91, 140, 255);
    public static readonly Color Violet = Color.FromArgb(138, 91, 255);
    public static readonly Color Green = Color.FromArgb(61, 220, 132);
    public static readonly Color Red = Color.FromArgb(255, 93, 93);
    public static readonly Color Amber = Color.FromArgb(255, 184, 77);

    public static GraphicsPath Round(Rectangle r, int radius)
    {
        int d = radius * 2;
        GraphicsPath p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }
}

/// <summary>Bouton plat aux coins arrondis (plein, ou contour seulement).</summary>
class RoundButton : Control
{
    public Color Fill = Theme.Card2;
    public Color TextColor = Theme.Text;
    public bool Outline;
    bool hover;

    public RoundButton()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        Cursor = Cursors.Hand;
        Font = new Font("Segoe UI Semibold", 10.5f);
        Height = 40;
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
    protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        g.Clear(Parent != null ? Parent.BackColor : Theme.Card);
        Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
        Color fill = Fill;
        if (Enabled && hover) fill = ControlPaint.Light(fill, 0.15f);
        if (!Enabled) fill = Theme.Card2;
        using (GraphicsPath p = Theme.Round(r, 12))
        {
            if (Outline)
            {
                using (Pen pen = new Pen(Enabled ? Color.FromArgb(hover ? 255 : 160, TextColor) : Theme.Line, 1.5f)) g.DrawPath(pen, p);
            }
            else
            {
                using (SolidBrush b = new SolidBrush(fill)) g.FillPath(b, p);
            }
        }
        Color tc = Enabled ? TextColor : Theme.Muted;
        TextRenderer.DrawText(g, Text, Font, ClientRectangle, tc, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
    }
}

/// <summary>Carte aux coins arrondis.</summary>
class Card : Panel
{
    public Card()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = Theme.Card;
        Padding = new Padding(20);
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        e.Graphics.Clear(Theme.Bg);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
        using (GraphicsPath p = Theme.Round(r, 16))
        {
            using (SolidBrush b = new SolidBrush(BackColor)) e.Graphics.FillPath(b, p);
            using (Pen pen = new Pen(Color.FromArgb(35, 41, 51))) e.Graphics.DrawPath(pen, p);
        }
    }
}

/// <summary>Barre de progression degradee.</summary>
class FlatBar : Control
{
    double val;
    public double Value { get { return val; } set { val = Math.Max(0, Math.Min(1, value)); Invalidate(); } }

    public FlatBar()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        Height = 10;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Parent != null ? Parent.BackColor : Theme.Card);
        Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
        using (GraphicsPath p = Theme.Round(r, Height / 2))
        using (SolidBrush b = new SolidBrush(Theme.Card2)) g.FillPath(b, p);
        int w = (int)((Width - 1) * val);
        if (w > Height)
        {
            Rectangle f = new Rectangle(0, 0, w, Height - 1);
            using (GraphicsPath p = Theme.Round(f, Height / 2))
            using (LinearGradientBrush b = new LinearGradientBrush(f, Theme.Accent, Theme.Violet, LinearGradientMode.Horizontal)) g.FillPath(b, p);
        }
    }
}

class MainForm : Form
{
    readonly string baseUrl, token;
    readonly Process server;
    readonly HttpClient http = new HttpClient();
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly NotifyIcon tray = new NotifyIcon();

    Label lblPack, lblMc, lblNf, lblState, lblVer, lblProg, lblErr, lblAccount, lblCodeHelp, lblCode, lblJoinHint, lblLoginErr;
    FlatBar bar;
    RoundButton btnPlay, btnInstall, btnKill, btnLogin, btnLogout, btnSave;
    LinkLabel linkUri;
    NumericUpDown numRam;
    CheckBox chkJoin;
    RichTextBox logBox;

    int next;
    bool polling, formLoaded, exiting, hiddenForGame;
    string phase = "idle", shownCode = "";
    string screenshotPath;

    public MainForm(Process server, string baseUrl, string token, string screenshotPath)
    {
        this.server = server;
        this.baseUrl = baseUrl;
        this.token = token;
        this.screenshotPath = screenshotPath;
        json.MaxJsonLength = int.MaxValue;
        http.Timeout = TimeSpan.FromSeconds(10);
        DoubleBuffered = true;
        BuildUi();
        timer.Interval = 800;
        timer.Tick += delegate { Poll(); };
        timer.Start();
        Shown += delegate { Poll(); };
    }

    // Dessin en double tampon de toute la fenetre (WS_EX_COMPOSITED) : evite les morceaux de boutons mal redessines.
    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x02000000; // WS_EX_COMPOSITED
            return cp;
        }
    }

    // ---------- Interface ----------

    static Label Lbl(string text, float size, bool bold, Color color)
    {
        Label l = new Label();
        l.Text = text;
        l.AutoSize = true;
        l.ForeColor = color;
        l.BackColor = Color.Transparent;
        l.Font = new Font(bold ? "Segoe UI Semibold" : "Segoe UI", size);
        return l;
    }

    Label Pill(string text)
    {
        Label l = Lbl(text, 9.5f, true, Theme.Muted);
        l.BackColor = Theme.Card2;
        l.Padding = new Padding(10, 4, 10, 4);
        l.Margin = new Padding(0, 0, 8, 0);
        return l;
    }

    RoundButton Btn(string text, Color fill, Color textColor, int w, int h)
    {
        RoundButton b = new RoundButton();
        b.Text = text;
        b.Fill = fill;
        b.TextColor = textColor;
        b.Width = w;
        b.Height = h;
        return b;
    }

    void BuildUi()
    {
        Text = "BMC6 Launcher";
        BackColor = Theme.Bg;
        ForeColor = Theme.Text;
        Font = new Font("Segoe UI", 9.5f);
        ClientSize = new Size(1040, 740);
        MinimumSize = new Size(900, 660);
        StartPosition = FormStartPosition.CenterScreen;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

        Panel body = new Panel();
        body.Dock = DockStyle.Fill;
        body.Padding = new Padding(22);
        body.BackColor = Theme.Bg;
        Controls.Add(body);

        // --- Carte principale ---
        Card hero = new Card();
        hero.Dock = DockStyle.Top;
        hero.Height = 230;
        lblPack = Lbl("BMC6", 24f, true, Theme.Text);
        lblPack.Location = new Point(24, 18);
        FlowLayoutPanel tags = new FlowLayoutPanel();
        tags.Location = new Point(24, 66);
        tags.AutoSize = false;
        tags.Size = new Size(620, 32);
        tags.WrapContents = false;
        tags.FlowDirection = FlowDirection.LeftToRight;
        tags.BackColor = Theme.Card;
        lblMc = Pill("Minecraft");
        lblNf = Pill("NeoForge");
        lblVer = Pill("Pack");
        lblVer.Visible = false;
        lblState = Pill("Non installé");
        tags.Controls.AddRange(new Control[] { lblMc, lblNf, lblVer, lblState });

        bar = new FlatBar();
        bar.Location = new Point(24, 112);
        bar.Width = 400;
        bar.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        bar.Visible = false;
        lblProg = Lbl("", 9f, false, Theme.Muted);
        lblProg.Location = new Point(24, 128);
        lblProg.Visible = false;
        lblErr = Lbl("", 9.5f, false, Theme.Red);
        lblErr.Location = new Point(24, 112);
        lblErr.MaximumSize = new Size(900, 0);

        btnPlay = Btn("Jouer", Theme.Green, Color.FromArgb(4, 23, 12), 230, 58);
        btnPlay.Font = new Font("Segoe UI Semibold", 15f);
        btnPlay.Location = new Point(24, 152);
        btnInstall = Btn("Installer", Theme.Accent, Color.White, 250, 58);
        btnInstall.Font = new Font("Segoe UI Semibold", 12f);
        btnInstall.Location = new Point(270, 152);
        btnKill = Btn("Fermer le jeu", Theme.Red, Theme.Red, 150, 58);
        btnKill.Outline = true;
        btnKill.Location = new Point(536, 152);
        btnKill.Visible = false;
        hero.Controls.AddRange(new Control[] { lblPack, tags, bar, lblProg, lblErr, btnPlay, btnInstall, btnKill });
        btnPlay.BringToFront();
        btnInstall.BringToFront();
        btnKill.BringToFront();
        hero.Resize += delegate { bar.Width = hero.Width - 48; };

        Panel gap = new Panel();
        gap.Dock = DockStyle.Top;
        gap.Height = 18;
        gap.BackColor = Theme.Bg;

        // --- Colonnes : compte + reglages | journal ---
        TableLayoutPanel cols = new TableLayoutPanel();
        cols.Dock = DockStyle.Fill;
        cols.ColumnCount = 2;
        cols.RowCount = 1;
        cols.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 340));
        cols.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        cols.BackColor = Theme.Bg;

        Card left = new Card();
        left.Dock = DockStyle.Fill;
        left.Margin = new Padding(0, 0, 18, 0);
        FlowLayoutPanel flow = new FlowLayoutPanel();
        flow.Dock = DockStyle.Fill;
        flow.FlowDirection = FlowDirection.TopDown;
        flow.WrapContents = false;
        flow.BackColor = Theme.Card;
        Label hAcc = Lbl("COMPTE", 8.5f, true, Theme.Muted);
        hAcc.Margin = new Padding(0, 0, 0, 6);
        lblAccount = Lbl("Non connecté", 12f, true, Theme.Text);
        lblAccount.Margin = new Padding(0, 0, 0, 12);
        lblCodeHelp = Lbl("Ouvre le lien et entre ce code :", 9f, false, Theme.Muted);
        lblCodeHelp.Margin = new Padding(0, 0, 0, 2);
        lblCodeHelp.Visible = false;
        lblCode = Lbl("", 22f, true, Theme.Text);
        lblCode.Font = new Font("Consolas", 22f, FontStyle.Bold);
        lblCode.Margin = new Padding(0, 0, 0, 4);
        lblCode.Visible = false;
        linkUri = new LinkLabel();
        linkUri.AutoSize = true;
        linkUri.LinkColor = Theme.Accent;
        linkUri.ActiveLinkColor = Theme.Accent;
        linkUri.BackColor = Theme.Card;
        linkUri.Margin = new Padding(0, 0, 0, 12);
        linkUri.Visible = false;
        linkUri.LinkClicked += delegate { if (linkUri.Tag != null) Process.Start((string)linkUri.Tag); };
        lblLoginErr = Lbl("", 9f, false, Theme.Red);
        lblLoginErr.MaximumSize = new Size(290, 0);
        lblLoginErr.Margin = new Padding(0, 0, 0, 10);
        lblLoginErr.Visible = false;
        btnLogin = Btn("Se connecter avec Microsoft", Theme.Card2, Theme.Text, 280, 40);
        btnLogin.Margin = new Padding(0);
        btnLogout = Btn("Se déconnecter", Theme.Red, Theme.Red, 280, 36);
        btnLogout.Outline = true;
        btnLogout.Margin = new Padding(0);
        btnLogout.Visible = false;

        Label hSet = Lbl("RÉGLAGES", 8.5f, true, Theme.Muted);
        hSet.Margin = new Padding(0, 28, 0, 8);
        Label lRam = Lbl("Mémoire du jeu (Mo)", 9.5f, true, Theme.Text);
        lRam.Margin = new Padding(0, 0, 0, 6);
        numRam = new NumericUpDown();
        numRam.Minimum = 2048;
        numRam.Maximum = 32768;
        numRam.Increment = 512;
        numRam.Value = 8192;
        numRam.BackColor = Theme.Card2;
        numRam.ForeColor = Theme.Text;
        numRam.BorderStyle = BorderStyle.FixedSingle;
        numRam.Font = new Font("Segoe UI", 11f);
        numRam.Width = 280;
        numRam.Margin = new Padding(0, 0, 0, 14);
        chkJoin = new CheckBox();
        chkJoin.Text = "Rejoindre le serveur au lancement";
        chkJoin.AutoSize = true;
        chkJoin.ForeColor = Theme.Text;
        chkJoin.BackColor = Theme.Card;
        chkJoin.Margin = new Padding(0);
        chkJoin.Visible = false;
        lblJoinHint = Lbl("", 8.5f, false, Theme.Muted);
        lblJoinHint.Margin = new Padding(20, 0, 0, 12);
        lblJoinHint.Visible = false;
        btnSave = Btn("Enregistrer", Theme.Card2, Theme.Text, 280, 38);
        btnSave.Margin = new Padding(0, 8, 0, 0);
        flow.Controls.AddRange(new Control[] { hAcc, lblAccount, lblCodeHelp, lblCode, linkUri, lblLoginErr, btnLogin, btnLogout, hSet, lRam, numRam, chkJoin, lblJoinHint, btnSave });
        left.Controls.Add(flow);

        Card right = new Card();
        right.Dock = DockStyle.Fill;
        Label hLog = Lbl("JOURNAL", 8.5f, true, Theme.Muted);
        hLog.Location = new Point(22, 18);
        logBox = new RichTextBox();
        logBox.ReadOnly = true;
        logBox.BorderStyle = BorderStyle.None;
        logBox.BackColor = Color.FromArgb(7, 9, 12);
        logBox.ForeColor = Color.FromArgb(201, 206, 216);
        logBox.Font = new Font("Consolas", 9.5f);
        logBox.Location = new Point(22, 44);
        logBox.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        right.Controls.AddRange(new Control[] { hLog, logBox });
        right.Resize += delegate { logBox.Size = new Size(right.Width - 44, right.Height - 66); };

        cols.Controls.Add(left, 0, 0);
        cols.Controls.Add(right, 1, 0);

        body.Controls.Add(cols);
        body.Controls.Add(gap);
        body.Controls.Add(hero);

        btnInstall.Click += delegate { Act("/api/install", ""); };
        btnPlay.Click += delegate { Act("/api/play", ""); };
        btnKill.Click += delegate { Act("/api/kill", ""); };
        btnLogin.Click += delegate { Act("/api/login", ""); };
        btnLogout.Click += delegate { Act("/api/logout", ""); };
        btnSave.Click += delegate
        {
            Act("/api/config", "ramMb=" + numRam.Value.ToString("0") + "&autoJoin=" + (chkJoin.Checked ? "true" : "false"));
        };

        // icone dans la zone de notification : sert quand la fenetre est masquee pendant une partie
        tray.Icon = Icon;
        tray.Text = "BMC6 Launcher";
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("Ouvrir", null, delegate { ShowFromTray(); });
        menu.Items.Add("Quitter", null, delegate { exiting = true; Close(); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { ShowFromTray(); };
    }

    void ShowFromTray()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
        hiddenForGame = false;
        tray.Visible = false;
    }

    // ---------- Communication avec le moteur ----------

    async System.Threading.Tasks.Task<Dictionary<string, object>> Api(string path, string body)
    {
        HttpRequestMessage req = new HttpRequestMessage(body == null ? HttpMethod.Get : HttpMethod.Post, baseUrl + path);
        req.Headers.Add("X-Token", token);
        if (body != null) req.Content = new StringContent(body, Encoding.UTF8, "application/x-www-form-urlencoded");
        HttpResponseMessage res = await http.SendAsync(req);
        string text = await res.Content.ReadAsStringAsync();
        return (Dictionary<string, object>)json.DeserializeObject(text);
    }

    async void Act(string path, string body)
    {
        try
        {
            Dictionary<string, object> r = await Api(path, body);
            if (!B(r, "ok")) MessageBox.Show(S(r, "msg"), "BMC6 Launcher", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        catch (Exception e)
        {
            MessageBox.Show("Le moteur du launcher ne répond pas : " + e.Message, "BMC6 Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        Poll();
    }

    static string S(Dictionary<string, object> d, string k) { object o; return d != null && d.TryGetValue(k, out o) && o != null ? o.ToString() : ""; }
    static bool B(Dictionary<string, object> d, string k) { object o; return d != null && d.TryGetValue(k, out o) && o is bool && (bool)o; }
    static double N(Dictionary<string, object> d, string k) { object o; double v; return d != null && d.TryGetValue(k, out o) && o != null && double.TryParse(o.ToString(), out v) ? v : 0; }
    static Dictionary<string, object> D(Dictionary<string, object> d, string k) { object o; return d != null && d.TryGetValue(k, out o) ? o as Dictionary<string, object> : null; }

    async void Poll()
    {
        if (polling) return;
        polling = true;
        try
        {
            Dictionary<string, object> s = await Api("/api/state?since=" + next, null);
            Apply(s);
        }
        catch (Exception) { }
        finally { polling = false; }
    }

    void Apply(Dictionary<string, object> s)
    {
        phase = S(s, "phase");
        bool installed = B(s, "installed"), update = B(s, "updateAvailable"), msOk = B(s, "msConfigured");
        string account = S(s, "account");
        Dictionary<string, object> pack = D(s, "pack"), cfg = D(s, "config"), login = D(s, "login");
        bool busy = phase != "idle";

        lblPack.Text = S(pack, "name");
        lblMc.Text = "Minecraft " + S(pack, "minecraft");
        lblNf.Text = "NeoForge " + S(pack, "neoforge");
        lblVer.Visible = S(pack, "version").Length > 0;
        lblVer.Text = "Pack " + S(pack, "version");
        lblState.Text = phase == "playing" ? "En jeu" : phase == "installing" ? "Installation…" : !installed ? "Non installé" : update ? "Mise à jour disponible" : "À jour";
        lblState.ForeColor = phase == "playing" || (installed && !update && !busy) ? Theme.Green : update ? Theme.Amber : Theme.Muted;

        btnPlay.Enabled = !busy && installed && account.Length > 0;
        btnInstall.Enabled = !busy;
        btnInstall.Text = !installed ? "Installer" : update ? "Mettre à jour" : "Vérifier les fichiers";
        btnKill.Visible = phase == "playing";

        bool installing = phase == "installing";
        bar.Visible = installing;
        lblProg.Visible = installing;
        if (installing)
        {
            double total = N(s, "total"), done = N(s, "done");
            bar.Value = total > 0 ? done / total : 0.03;
            lblProg.Text = S(s, "task") + (total > 0 ? "   " + done + " / " + total : "");
        }
        string err = S(s, "error");
        lblErr.Text = err;
        lblErr.Visible = err.Length > 0 && !installing;

        // compte
        bool waiting = login != null && S(login, "status") == "waiting";
        lblAccount.Text = account.Length > 0 ? "Connecté : " + account : "Non connecté";
        lblAccount.ForeColor = account.Length > 0 ? Theme.Green : Theme.Text;
        lblCodeHelp.Visible = waiting;
        lblCode.Visible = waiting;
        linkUri.Visible = waiting;
        if (waiting)
        {
            string code = S(login, "code"), uri = S(login, "uri");
            lblCode.Text = code;
            linkUri.Text = uri;
            linkUri.Tag = uri;
            if (code != shownCode)
            {
                shownCode = code;
                try { Process.Start(uri); } catch (Exception) { }
            }
        }
        else shownCode = "";
        string loginErr = login != null && S(login, "status") == "error" ? S(login, "msg") : "";
        lblLoginErr.Text = loginErr;
        lblLoginErr.Visible = loginErr.Length > 0;
        btnLogin.Visible = account.Length == 0 && !waiting;
        btnLogin.Enabled = msOk;
        btnLogout.Visible = account.Length > 0;

        // reglages
        string server = S(pack, "server");
        chkJoin.Visible = server.Length > 0;
        lblJoinHint.Visible = server.Length > 0;
        lblJoinHint.Text = server;
        if (!formLoaded && cfg != null)
        {
            formLoaded = true;
            decimal ram = (decimal)N(cfg, "ramMb");
            if (ram >= numRam.Minimum && ram <= numRam.Maximum) numRam.Value = ram;
            chkJoin.Checked = B(cfg, "autoJoin");
        }

        // journal
        object lines;
        if (s.TryGetValue("lines", out lines) && lines is ArrayList)
        {
            foreach (object o in (ArrayList)lines) AppendLog(o == null ? "" : o.ToString());
            next = (int)N(s, "next");
        }

        // fenetre masquee pendant une partie : on se ferme quand le jeu est termine
        if (hiddenForGame && phase == "idle") { exiting = true; Close(); }

        if (screenshotPath != null && formLoaded)
        {
            string path = screenshotPath;
            screenshotPath = null;
            System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
            t.Interval = 1200;
            t.Tick += delegate
            {
                t.Stop();
                using (Bitmap bmp = new Bitmap(ClientSize.Width, ClientSize.Height))
                {
                    DrawToBitmap(bmp, new Rectangle(0, 0, bmp.Width, bmp.Height));
                    bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
                }
                exiting = true;
                Close();
            };
            t.Start();
        }
    }

    void AppendLog(string line)
    {
        Color c = Color.FromArgb(201, 206, 216);
        if (line.StartsWith("> ")) c = Theme.Accent;
        else if (line.StartsWith("ERREUR") || line.Contains("ERROR:")) c = Theme.Red;
        else if (line.Contains("WARN:")) c = Theme.Amber;
        else if (line.StartsWith("[jeu]")) c = Theme.Muted;
        logBox.SelectionStart = logBox.TextLength;
        logBox.SelectionColor = c;
        logBox.AppendText(line + "\n");
        if (logBox.Lines.Length > 2500)
        {
            logBox.SelectionStart = 0;
            logBox.SelectionLength = logBox.GetFirstCharIndexFromLine(500);
            logBox.SelectedText = "";
        }
        logBox.SelectionStart = logBox.TextLength;
        logBox.ScrollToCaret();
    }

    // ---------- Fermeture ----------

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!exiting)
        {
            if (phase == "playing")
            {
                // le jeu continue : on masque la fenetre et on quittera a la fin de la partie
                e.Cancel = true;
                Hide();
                hiddenForGame = true;
                tray.Visible = true;
                tray.ShowBalloonTip(3000, "BMC6 Launcher", "Le jeu est lancé. Le launcher se fermera à la fin de la partie.", ToolTipIcon.Info);
                return;
            }
            if (phase == "installing" &&
                MessageBox.Show("Une installation est en cours. Quitter l'interrompt (elle reprendra là où elle en était).", "BMC6 Launcher",
                    MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK)
            {
                e.Cancel = true;
                return;
            }
        }
        base.OnFormClosing(e);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        timer.Stop();
        tray.Visible = false;
        tray.Dispose();
        try { if (!server.HasExited) server.Kill(); } catch (Exception) { }
        base.OnFormClosed(e);
    }
}

static class Program
{
    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    static int FreePort()
    {
        TcpListener l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        int port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    static bool Healthy(string url)
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url + "/health");
            req.Timeout = 1500;
            using (WebResponse res = req.GetResponse()) return true;
        }
        catch (Exception) { return false; }
    }

    [STAThread]
    static void Main(string[] args)
    {
        try { SetProcessDPIAware(); } catch (Exception) { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        bool created;
        using (Mutex mutex = new Mutex(true, "BMC6LauncherSingleInstance", out created))
        {
            if (!created)
            {
                MessageBox.Show("BMC6 Launcher est déjà ouvert.", "BMC6 Launcher", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            Process server = null;
            try
            {
                string dir = AppDomain.CurrentDomain.BaseDirectory;
                string node = Path.Combine(dir, "node.exe");
                if (!File.Exists(node)) node = "node"; // dossier de developpement : Node installe sur le PC
                int port = FreePort();
                string token = Guid.NewGuid().ToString("N");
                ProcessStartInfo psi = new ProcessStartInfo(node, "src\\main.js");
                psi.WorkingDirectory = dir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.EnvironmentVariables["PORT"] = port.ToString();
                psi.EnvironmentVariables["NO_BROWSER"] = "1";
                psi.EnvironmentVariables["BMC6_TOKEN"] = token;
                server = Process.Start(psi);

                string url = "http://127.0.0.1:" + port;
                bool up = false;
                for (int i = 0; i < 80 && !up; i++)
                {
                    if (server.HasExited) throw new Exception("le moteur s'est arrêté (Node.js introuvable ?).");
                    up = Healthy(url);
                    if (!up) Thread.Sleep(250);
                }
                if (!up) throw new Exception("le moteur ne répond pas.");

                string shot = null;
                for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--screenshot") shot = args[i + 1];
                Application.Run(new MainForm(server, url, token, shot));
            }
            catch (Exception e)
            {
                MessageBox.Show("Impossible de démarrer le launcher :\n" + e.Message, "BMC6 Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
                try { if (server != null && !server.HasExited) server.Kill(); } catch (Exception) { }
            }
        }
    }
}
