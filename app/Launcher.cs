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
    public static readonly Color Card2 = Color.FromArgb(25, 29, 38);
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
        g.Clear(Parent != null ? Parent.BackColor : Theme.Card);
        Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
        Color fill = Fill;
        if (Enabled && hover) fill = ControlPaint.Light(fill, 0.18f);
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

/// <summary>Curseur de memoire : de 2 Go a la memoire utilisable du PC, par pas de 512 Mo.</summary>
class RamSlider : Control
{
    public int MinMb = 2048, MaxMb = 28672, StepMb = 512;
    int val = 8192;
    bool drag;
    public event EventHandler ValueChanged;

    public int Value
    {
        get { return val; }
        set
        {
            int v = (int)(Math.Round((double)value / StepMb) * StepMb);
            v = Math.Max(MinMb, Math.Min(MaxMb, v));
            if (v != val) { val = v; Invalidate(); }
        }
    }

    public RamSlider()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        Cursor = Cursors.Hand;
        Height = 52;
        Font = new Font("Segoe UI", 8.5f);
    }

    int ThumbX() { double t = (double)(val - MinMb) / Math.Max(1, MaxMb - MinMb); return 12 + (int)(t * (Width - 24)); }

    void SetFromMouse(int x)
    {
        double t = Math.Max(0, Math.Min(1, (double)(x - 12) / Math.Max(1, Width - 24)));
        int before = val;
        Value = MinMb + (int)(t * (MaxMb - MinMb));
        if (val != before && ValueChanged != null) ValueChanged(this, EventArgs.Empty);
    }

    protected override void OnMouseDown(MouseEventArgs e) { drag = true; Capture = true; SetFromMouse(e.X); base.OnMouseDown(e); }
    protected override void OnMouseMove(MouseEventArgs e) { if (drag) SetFromMouse(e.X); base.OnMouseMove(e); }
    protected override void OnMouseUp(MouseEventArgs e) { drag = false; Capture = false; base.OnMouseUp(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Parent != null ? Parent.BackColor : Theme.Card);
        int cy = 18, x0 = 12, x1 = Width - 12, tx = ThumbX();
        Rectangle track = new Rectangle(x0, cy - 4, x1 - x0, 8);
        using (GraphicsPath p = Theme.Round(track, 4))
        using (SolidBrush b = new SolidBrush(Theme.Card2)) g.FillPath(b, p);
        // graduations tous les 4 Go
        using (Pen tick = new Pen(Theme.Line))
        {
            for (int mb = 4096; mb < MaxMb; mb += 4096)
            {
                int x = x0 + (int)((double)(mb - MinMb) / (MaxMb - MinMb) * (x1 - x0));
                g.DrawLine(tick, x, cy + 9, x, cy + 14);
            }
        }
        if (tx > x0 + 4)
        {
            Rectangle fill = new Rectangle(x0, cy - 4, tx - x0, 8);
            using (GraphicsPath p = Theme.Round(fill, 4))
            using (LinearGradientBrush b = new LinearGradientBrush(new Rectangle(x0, cy - 4, Math.Max(2, x1 - x0), 8), Theme.Accent, Theme.Violet, LinearGradientMode.Horizontal))
                g.FillPath(b, p);
        }
        using (SolidBrush shadow = new SolidBrush(Color.FromArgb(70, 0, 0, 0))) g.FillEllipse(shadow, tx - 11, cy - 9, 22, 22);
        using (SolidBrush b = new SolidBrush(Color.White)) g.FillEllipse(b, tx - 11, cy - 11, 22, 22);
        using (Pen pen = new Pen(Theme.Accent, 3f)) g.DrawEllipse(pen, tx - 8, cy - 8, 16, 16);
        string lo = (MinMb / 1024) + " Go", hi = (MaxMb / 1024) + " Go";
        TextRenderer.DrawText(g, lo, Font, new Point(x0 - 4, 34), Theme.Muted);
        Size hs = TextRenderer.MeasureText(hi, Font);
        TextRenderer.DrawText(g, hi, Font, new Point(x1 - hs.Width + 4, 34), Theme.Muted);
    }
}

/// <summary>Interrupteur on/off.</summary>
class Toggle : Control
{
    bool on;
    public event EventHandler Changed;
    public bool Checked { get { return on; } set { if (on != value) { on = value; Invalidate(); } } }

    public Toggle()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        Cursor = Cursors.Hand;
        Size = new Size(46, 26);
    }

    protected override void OnClick(EventArgs e)
    {
        on = !on;
        Invalidate();
        if (Changed != null) Changed(this, EventArgs.Empty);
        base.OnClick(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Parent != null ? Parent.BackColor : Theme.Card);
        Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
        using (GraphicsPath p = Theme.Round(r, Height / 2))
        using (SolidBrush b = new SolidBrush(on ? Theme.Green : Theme.Line)) g.FillPath(b, p);
        int d = Height - 8;
        using (SolidBrush b = new SolidBrush(Color.White)) g.FillEllipse(b, on ? Width - d - 5 : 4, 4, d, d);
    }
}

/// <summary>Pastille ronde avec l'initiale du joueur.</summary>
class AvatarBox : Control
{
    public string Letter = "?";
    public Color Tint = Theme.Line;

    public AvatarBox()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        Size = new Size(56, 56);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Parent != null ? Parent.BackColor : Theme.Card);
        Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
        using (LinearGradientBrush b = new LinearGradientBrush(r, ControlPaint.Light(Tint, 0.2f), ControlPaint.Dark(Tint, 0.1f), 45f)) g.FillEllipse(b, r);
        using (Font f = new Font("Segoe UI Semibold", 20f))
            TextRenderer.DrawText(g, Letter, f, r, Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
    }
}

class MainForm : Form
{
    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [StructLayout(LayoutKind.Sequential)]
    struct MEMORYSTATUSEX
    {
        public uint dwLength, dwMemoryLoad;
        public ulong ullTotalPhys, ullAvailPhys, ullTotalPageFile, ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll")]
    static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);

    readonly string baseUrl, token;
    readonly Process server;
    readonly HttpClient http = new HttpClient();
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly System.Windows.Forms.Timer saveTimer = new System.Windows.Forms.Timer();
    readonly NotifyIcon tray = new NotifyIcon();

    Label lblPack, lblMc, lblNf, lblState, lblVer, lblProg, lblErr, lblAccount, lblAccSub, lblCodeHelp, lblCode, lblJoinHint, lblJoin, lblLoginErr;
    Label lblRamValue, lblRamSub, lblRamNote, lblHdrVer;
    AvatarBox avatar;
    FlatBar bar;
    RoundButton btnPlay, btnInstall, btnKill, btnLogin, btnLogout, btnFolder, btnCopy, btnClear;
    LinkLabel linkUri;
    RamSlider ramSlider;
    Toggle tglJoin;
    RichTextBox logBox;

    int next, totalRamMb = 16384;
    bool polling, formLoaded, exiting, hiddenForGame;
    string phase = "idle", shownCode = "", instancePath = "";
    string screenshotPath;

    public MainForm(Process server, string baseUrl, string token, string screenshotPath)
    {
        this.server = server;
        this.baseUrl = baseUrl;
        this.token = token;
        this.screenshotPath = screenshotPath;
        json.MaxJsonLength = int.MaxValue;
        http.Timeout = TimeSpan.FromSeconds(10);
        MEMORYSTATUSEX m = new MEMORYSTATUSEX();
        m.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
        if (GlobalMemoryStatusEx(ref m)) totalRamMb = (int)(m.ullTotalPhys / (1024 * 1024));
        DoubleBuffered = true;
        BuildUi();
        timer.Interval = 800;
        timer.Tick += delegate { Poll(); };
        timer.Start();
        saveTimer.Interval = 600;
        saveTimer.Tick += delegate { saveTimer.Stop(); SaveNow(); };
        Shown += delegate { Poll(); };
    }

    // Dessin en double tampon de toute la fenetre (WS_EX_COMPOSITED) : evite les morceaux de boutons mal redessines.
    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x02000000;
            return cp;
        }
    }

    // Barre de titre sombre (Windows 10 1809+ / 11), couleur assortie au fond sur Windows 11
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            int dark = 1;
            DwmSetWindowAttribute(Handle, 20, ref dark, 4);
            DwmSetWindowAttribute(Handle, 19, ref dark, 4);
            int caption = 10 | (12 << 8) | (16 << 16);
            DwmSetWindowAttribute(Handle, 35, ref caption, 4);
            int text = 232 | (234 << 8) | (238 << 16);
            DwmSetWindowAttribute(Handle, 36, ref text, 4);
        }
        catch (Exception) { }
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

    static Panel Spacer(DockStyle dock, int size)
    {
        Panel p = new Panel();
        p.Dock = dock;
        if (dock == DockStyle.Top || dock == DockStyle.Bottom) p.Height = size; else p.Width = size;
        p.BackColor = Theme.Bg;
        return p;
    }

    void BuildUi()
    {
        Text = "BMC6 Launcher";
        BackColor = Theme.Bg;
        ForeColor = Theme.Text;
        Font = new Font("Segoe UI", 9.5f);
        ClientSize = new Size(1100, 790);
        MinimumSize = new Size(980, 740);
        StartPosition = FormStartPosition.CenterScreen;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

        // --- En-tete ---
        Panel header = new Panel();
        header.Dock = DockStyle.Top;
        header.Height = 70;
        header.BackColor = Theme.Bg;
        PictureBox logo = new PictureBox();
        logo.Size = new Size(38, 38);
        logo.Location = new Point(24, 16);
        logo.SizeMode = PictureBoxSizeMode.Zoom;
        logo.BackColor = Theme.Bg;
        try { logo.Image = Icon.ToBitmap(); } catch (Exception) { }
        Label title = Lbl("BMC6 Launcher", 15f, true, Theme.Text);
        title.Location = new Point(70, 14);
        Label sub = Lbl("Better MC · NeoForge", 9f, false, Theme.Muted);
        sub.Location = new Point(72, 40);
        lblHdrVer = Lbl("", 9.5f, true, Theme.Muted);
        lblHdrVer.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        lblHdrVer.Location = new Point(960, 26);
        header.Controls.AddRange(new Control[] { logo, title, sub, lblHdrVer });
        header.Resize += delegate { lblHdrVer.Left = header.Width - lblHdrVer.Width - 28; };

        // --- Corps : colonne de gauche (compte, memoire, options) | colonne de droite (jeu, journal) ---
        Panel body = new Panel();
        body.Dock = DockStyle.Fill;
        body.Padding = new Padding(22, 0, 22, 22);
        body.BackColor = Theme.Bg;

        // Colonne de droite
        Panel right = new Panel();
        right.Dock = DockStyle.Fill;
        right.BackColor = Theme.Bg;

        Card hero = new Card();
        hero.Dock = DockStyle.Top;
        hero.Height = 262;
        lblPack = Lbl("BMC6", 26f, true, Theme.Text);
        lblPack.Location = new Point(26, 20);
        FlowLayoutPanel tags = new FlowLayoutPanel();
        tags.Location = new Point(26, 76);
        tags.AutoSize = false;
        tags.Size = new Size(640, 32);
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
        bar.Location = new Point(26, 128);
        bar.Width = 400;
        bar.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        bar.Visible = false;
        lblProg = Lbl("", 9.5f, false, Theme.Muted);
        lblProg.Location = new Point(26, 146);
        lblProg.Visible = false;
        lblErr = Lbl("", 9.5f, false, Theme.Red);
        lblErr.Location = new Point(26, 126);
        lblErr.MaximumSize = new Size(800, 0);
        btnPlay = Btn("Jouer", Theme.Green, Color.FromArgb(4, 23, 12), 250, 62);
        btnPlay.Font = new Font("Segoe UI Semibold", 16f);
        btnPlay.Location = new Point(26, 180);
        btnInstall = Btn("Installer", Theme.Accent, Color.White, 260, 62);
        btnInstall.Font = new Font("Segoe UI Semibold", 12f);
        btnInstall.Location = new Point(292, 180);
        btnKill = Btn("Fermer le jeu", Theme.Red, Theme.Red, 160, 62);
        btnKill.Outline = true;
        btnKill.Location = new Point(568, 180);
        btnKill.Visible = false;
        hero.Controls.AddRange(new Control[] { lblPack, tags, bar, lblProg, lblErr, btnPlay, btnInstall, btnKill });
        btnPlay.BringToFront();
        btnInstall.BringToFront();
        btnKill.BringToFront();
        hero.Resize += delegate { bar.Width = hero.Width - 52; };

        Card journal = new Card();
        journal.Dock = DockStyle.Fill;
        Label hLog = Lbl("JOURNAL", 8.5f, true, Theme.Muted);
        hLog.Location = new Point(24, 20);
        btnClear = Btn("Effacer", Theme.Card2, Theme.Text, 78, 28);
        btnClear.Font = new Font("Segoe UI Semibold", 9f);
        btnClear.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        btnCopy = Btn("Copier", Theme.Card2, Theme.Text, 78, 28);
        btnCopy.Font = new Font("Segoe UI Semibold", 9f);
        btnCopy.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        logBox = new RichTextBox();
        logBox.ReadOnly = true;
        logBox.BorderStyle = BorderStyle.None;
        logBox.BackColor = Color.FromArgb(7, 9, 12);
        logBox.ForeColor = Color.FromArgb(201, 206, 216);
        logBox.Font = new Font("Consolas", 9.5f);
        logBox.Location = new Point(24, 54);
        logBox.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        journal.Controls.AddRange(new Control[] { hLog, btnClear, btnCopy, logBox });
        journal.Resize += delegate
        {
            logBox.Size = new Size(journal.Width - 48, journal.Height - 78);
            btnClear.Location = new Point(journal.Width - 24 - btnClear.Width, 14);
            btnCopy.Location = new Point(btnClear.Left - 8 - btnCopy.Width, 14);
        };

        right.Controls.Add(journal);
        right.Controls.Add(Spacer(DockStyle.Top, 16));
        right.Controls.Add(hero);

        // Colonne de gauche
        Panel left = new Panel();
        left.Dock = DockStyle.Left;
        left.Width = 366;
        left.BackColor = Theme.Bg;

        // Compte
        Card acc = new Card();
        acc.Dock = DockStyle.Top;
        acc.Height = 232;
        Label hAcc = Lbl("COMPTE", 8.5f, true, Theme.Muted);
        hAcc.Location = new Point(24, 20);
        avatar = new AvatarBox();
        avatar.Location = new Point(24, 50);
        lblAccount = Lbl("Non connecté", 13f, true, Theme.Text);
        lblAccount.Location = new Point(92, 56);
        lblAccSub = Lbl("Connexion Microsoft requise", 9f, false, Theme.Muted);
        lblAccSub.Location = new Point(93, 82);
        lblCodeHelp = Lbl("Ouvre le lien et entre ce code :", 9f, false, Theme.Muted);
        lblCodeHelp.Location = new Point(24, 122);
        lblCodeHelp.Visible = false;
        lblCode = Lbl("", 22f, true, Theme.Text);
        lblCode.Font = new Font("Consolas", 22f, FontStyle.Bold);
        lblCode.Location = new Point(24, 140);
        lblCode.Visible = false;
        linkUri = new LinkLabel();
        linkUri.AutoSize = true;
        linkUri.LinkColor = Theme.Accent;
        linkUri.ActiveLinkColor = Theme.Accent;
        linkUri.BackColor = Theme.Card;
        linkUri.Location = new Point(24, 184);
        linkUri.Visible = false;
        linkUri.LinkClicked += delegate { if (linkUri.Tag != null) Process.Start((string)linkUri.Tag); };
        lblLoginErr = Lbl("", 9f, false, Theme.Red);
        lblLoginErr.Location = new Point(24, 118);
        lblLoginErr.MaximumSize = new Size(300, 0);
        lblLoginErr.Visible = false;
        btnLogin = Btn("Se connecter avec Microsoft", Theme.Accent, Color.White, 316, 44);
        btnLogin.Location = new Point(24, 170);
        btnLogout = Btn("Se déconnecter", Theme.Red, Theme.Red, 316, 38);
        btnLogout.Outline = true;
        btnLogout.Location = new Point(24, 170);
        btnLogout.Visible = false;
        acc.Controls.AddRange(new Control[] { hAcc, avatar, lblAccount, lblAccSub, lblCodeHelp, lblCode, linkUri, lblLoginErr, btnLogin, btnLogout });

        // Memoire
        Card ram = new Card();
        ram.Dock = DockStyle.Top;
        ram.Height = 232;
        Label hRam = Lbl("MÉMOIRE", 8.5f, true, Theme.Muted);
        hRam.Location = new Point(24, 20);
        lblRamValue = Lbl("8 Go", 28f, true, Theme.Text);
        lblRamValue.Location = new Point(22, 40);
        lblRamSub = Lbl("", 9f, false, Theme.Muted);
        lblRamSub.Location = new Point(25, 92);
        ramSlider = new RamSlider();
        ramSlider.Location = new Point(24, 122);
        ramSlider.Width = 316;
        lblRamNote = Lbl("", 9f, false, Theme.Muted);
        lblRamNote.Location = new Point(25, 184);
        lblRamNote.MaximumSize = new Size(316, 0);
        ram.Controls.AddRange(new Control[] { hRam, lblRamValue, lblRamSub, ramSlider, lblRamNote });
        int usable = Math.Max(4096, ((totalRamMb - 4096) / 512) * 512);
        ramSlider.MaxMb = Math.Min(32768, usable);
        ramSlider.Value = 8192;
        UpdateRamLabels();
        ramSlider.ValueChanged += delegate { UpdateRamLabels(); if (formLoaded) { saveTimer.Stop(); saveTimer.Start(); } };

        // Options
        Card opt = new Card();
        opt.Dock = DockStyle.Top;
        opt.Height = 170;
        Label hOpt = Lbl("OPTIONS", 8.5f, true, Theme.Muted);
        hOpt.Location = new Point(24, 20);
        tglJoin = new Toggle();
        tglJoin.Location = new Point(24, 52);
        tglJoin.Visible = false;
        lblJoin = Lbl("Rejoindre le serveur au lancement", 10f, false, Theme.Text);
        lblJoin.Location = new Point(80, 54);
        lblJoin.Visible = false;
        lblJoinHint = Lbl("", 8.5f, false, Theme.Muted);
        lblJoinHint.Location = new Point(81, 76);
        lblJoinHint.Visible = false;
        tglJoin.Changed += delegate { if (formLoaded) { saveTimer.Stop(); saveTimer.Start(); } };
        btnFolder = Btn("Ouvrir le dossier du jeu", Theme.Card2, Theme.Text, 316, 42);
        btnFolder.Location = new Point(24, 108);
        opt.Controls.AddRange(new Control[] { hOpt, tglJoin, lblJoin, lblJoinHint, btnFolder });

        left.Controls.Add(opt);
        left.Controls.Add(Spacer(DockStyle.Top, 16));
        left.Controls.Add(ram);
        left.Controls.Add(Spacer(DockStyle.Top, 16));
        left.Controls.Add(acc);

        body.Controls.Add(right);
        body.Controls.Add(Spacer(DockStyle.Left, 18));
        body.Controls.Add(left);

        Controls.Add(body);
        Controls.Add(header);

        btnInstall.Click += delegate { Act("/api/install", ""); };
        btnPlay.Click += delegate { Act("/api/play", ""); };
        btnKill.Click += delegate { Act("/api/kill", ""); };
        btnLogin.Click += delegate { Act("/api/login", ""); };
        btnLogout.Click += delegate { Act("/api/logout", ""); };
        btnFolder.Click += delegate { OpenFolder(); };
        btnCopy.Click += delegate { if (logBox.TextLength > 0) { try { Clipboard.SetText(logBox.Text); } catch (Exception) { } } };
        btnClear.Click += delegate { logBox.Clear(); };

        // icone dans la zone de notification : sert quand la fenetre est masquee pendant une partie
        tray.Icon = Icon;
        tray.Text = "BMC6 Launcher";
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("Ouvrir", null, delegate { ShowFromTray(); });
        menu.Items.Add("Quitter", null, delegate { exiting = true; Close(); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { ShowFromTray(); };
    }

    void UpdateRamLabels()
    {
        double go = ramSlider.Value / 1024.0;
        lblRamValue.Text = go.ToString("0.#") + " Go";
        lblRamSub.Text = "sur " + Math.Round(totalRamMb / 1024.0) + " Go au total dans ce PC";
        double share = (double)ramSlider.Value / totalRamMb;
        if (share > 0.8) { lblRamValue.ForeColor = Theme.Red; lblRamNote.Text = "Trop élevé : Windows et le reste manqueront de mémoire."; }
        else if (share > 0.6) { lblRamValue.ForeColor = Theme.Amber; lblRamNote.Text = "Élevé : ferme les autres programmes pour jouer."; }
        else if (go < 4) { lblRamValue.ForeColor = Theme.Amber; lblRamNote.Text = "Peu de mémoire : ce pack est lourd, 6 à 10 Go sont conseillés."; }
        else { lblRamValue.ForeColor = Theme.Text; lblRamNote.Text = "Conseillé pour ce pack : 6 à 10 Go."; }
    }

    void OpenFolder()
    {
        if (instancePath.Length > 0 && Directory.Exists(instancePath)) Process.Start("explorer.exe", "\"" + instancePath + "\"");
        else MessageBox.Show("Le dossier n'existe pas encore : installe d'abord le jeu.", "BMC6 Launcher", MessageBoxButtons.OK, MessageBoxIcon.Information);
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

    /// <summary>Enregistre la memoire et l'option du serveur (automatique, quelques instants apres un changement).</summary>
    async void SaveNow()
    {
        try
        {
            Dictionary<string, object> r = await Api("/api/config", "ramMb=" + ramSlider.Value + "&autoJoin=" + (tglJoin.Checked ? "true" : "false"));
            if (!B(r, "ok")) MessageBox.Show(S(r, "msg"), "BMC6 Launcher", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        catch (Exception) { }
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

    static Color TintFor(string name)
    {
        Color[] palette = new Color[] { Color.FromArgb(91, 140, 255), Color.FromArgb(138, 91, 255), Color.FromArgb(224, 88, 155), Color.FromArgb(239, 138, 60), Color.FromArgb(47, 182, 124), Color.FromArgb(38, 167, 201) };
        int h = 0;
        foreach (char c in name) h += c;
        return palette[h % palette.Length];
    }

    void Apply(Dictionary<string, object> s)
    {
        phase = S(s, "phase");
        bool installed = B(s, "installed"), update = B(s, "updateAvailable"), msOk = B(s, "msConfigured");
        string account = S(s, "account");
        Dictionary<string, object> pack = D(s, "pack"), cfg = D(s, "config"), login = D(s, "login"), paths = D(s, "paths");
        bool busy = phase != "idle";
        instancePath = S(paths, "instance");

        lblPack.Text = S(pack, "name");
        lblMc.Text = "Minecraft " + S(pack, "minecraft");
        lblNf.Text = "NeoForge " + S(pack, "neoforge");
        lblVer.Visible = S(pack, "version").Length > 0;
        lblVer.Text = "Pack " + S(pack, "version");
        lblHdrVer.Text = S(pack, "version").Length > 0 ? "Pack " + S(pack, "version") : "";
        lblHdrVer.Left = lblHdrVer.Parent.Width - lblHdrVer.Width - 28;
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
        bool signedIn = account.Length > 0;
        lblAccount.Text = signedIn ? account : "Non connecté";
        lblAccount.ForeColor = Theme.Text;
        lblAccSub.Text = signedIn ? "Compte Microsoft connecté" : "Connexion Microsoft requise";
        lblAccSub.ForeColor = signedIn ? Theme.Green : Theme.Muted;
        avatar.Letter = signedIn ? account.Substring(0, 1).ToUpper() : "?";
        avatar.Tint = signedIn ? TintFor(account) : Theme.Line;
        avatar.Invalidate();
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
        btnLogin.Visible = !signedIn && !waiting;
        btnLogin.Enabled = msOk;
        btnLogin.Top = loginErr.Length > 0 ? 176 + lblLoginErr.Height - 10 : 170;
        btnLogout.Visible = signedIn;

        // reglages
        string srv = S(pack, "server");
        tglJoin.Visible = srv.Length > 0;
        lblJoin.Visible = srv.Length > 0;
        lblJoinHint.Visible = srv.Length > 0;
        lblJoinHint.Text = srv;
        if (!formLoaded && cfg != null)
        {
            ramSlider.Value = (int)N(cfg, "ramMb");
            tglJoin.Checked = B(cfg, "autoJoin");
            UpdateRamLabels();
            formLoaded = true;
        }

        // journal
        object lines;
        if (s.TryGetValue("lines", out lines) && lines is IEnumerable && !(lines is string))
        {
            foreach (object o in (IEnumerable)lines) AppendLog(o == null ? "" : o.ToString());
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
        if (saveTimer.Enabled) { saveTimer.Stop(); try { SaveNow(); } catch (Exception) { } }
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

        string shotArg = null;
        for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--screenshot") shotArg = args[i + 1];
        bool created;
        // le mode capture d'ecran (verification visuelle) peut tourner meme si le launcher est deja ouvert
        using (Mutex mutex = new Mutex(true, shotArg == null ? "BMC6LauncherSingleInstance" : "BMC6LauncherShot" + Guid.NewGuid().ToString("N"), out created))
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

                Application.Run(new MainForm(server, url, token, shotArg));
            }
            catch (Exception e)
            {
                MessageBox.Show("Impossible de démarrer le launcher :\n" + e.Message, "BMC6 Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
                try { if (server != null && !server.HasExited) server.Kill(); } catch (Exception) { }
            }
        }
    }
}
