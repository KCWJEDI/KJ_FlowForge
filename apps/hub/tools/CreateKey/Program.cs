using System;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

namespace KJ_FlowForge_CreateKey
{
    public class MainForm : Form
    {
        private TextBox idBox, ownerBox, expiryBox, resultBox;
        private Button generateButton, copyKeyButton, copyJsonButton, historyButton;
        private string lastKey = "";
        private string lastJson = "";
        // 원본 키 보관소: 개발자 PC의 로컬 AppData에만 저장됨 (Config 저장소·프로그램 배포본과 무관)
        private static readonly string HistoryPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "KJ_FlowForge", "issued-keys.txt");

        public MainForm()
        {
            Text = "KJ FlowForge - 라이선스 키 생성기";
            Size = new Size(560, 520);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;

            var label1 = new Label { Text = "키 ID (브랜치명·팀명·담당자 등)", Location = new Point(20, 20), AutoSize = true };
            idBox = new TextBox { Location = new Point(20, 43), Width = 500 };

            var label2 = new Label { Text = "사용자 이름", Location = new Point(20, 75), AutoSize = true };
            ownerBox = new TextBox { Location = new Point(20, 98), Width = 500 };

            var label3 = new Label { Text = "만료일 (YYYY-MM-DD, 비우면 만료 없음)", Location = new Point(20, 130), AutoSize = true };
            expiryBox = new TextBox { Location = new Point(20, 153), Width = 500 };

            generateButton = new Button { Text = "키 생성", Location = new Point(20, 190), Width = 120, Height = 34 };
            generateButton.Click += OnGenerate;

            copyKeyButton = new Button { Text = "키 복사", Location = new Point(150, 190), Width = 100, Height = 34, Enabled = false };
            copyKeyButton.Click += (s, e) => { if (lastKey.Length > 0) Clipboard.SetText(lastKey); };

            copyJsonButton = new Button { Text = "JSON 조각 복사", Location = new Point(260, 190), Width = 130, Height = 34, Enabled = false };
            copyJsonButton.Click += (s, e) => { if (lastJson.Length > 0) Clipboard.SetText(lastJson); };

            historyButton = new Button { Text = "발급 기록", Location = new Point(400, 190), Width = 120, Height = 34 };
            historyButton.Click += (s, e) => ShowHistory();

            var label4 = new Label { Text = "결과 (키는 발급 기록에 자동 저장됩니다. JSON은 Config 저장소의 licenses.json에 붙여넣으세요)", Location = new Point(20, 240), AutoSize = true };
            resultBox = new TextBox { Location = new Point(20, 263), Width = 500, Height = 180, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Font = new Font("Consolas", 9) };

            Controls.Add(label1); Controls.Add(idBox);
            Controls.Add(label2); Controls.Add(ownerBox);
            Controls.Add(label3); Controls.Add(expiryBox);
            Controls.Add(generateButton); Controls.Add(copyKeyButton); Controls.Add(copyJsonButton); Controls.Add(historyButton);
            Controls.Add(label4); Controls.Add(resultBox);
        }

        private void OnGenerate(object sender, EventArgs e)
        {
            string id = idBox.Text.Trim();
            string owner = ownerBox.Text.Trim();
            if (id.Length == 0 || owner.Length == 0)
            {
                MessageBox.Show("키 ID와 사용자 이름을 모두 입력해주세요.", "입력 필요", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            byte[] bytes = new byte[18];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            var sb = new StringBuilder("KJFF-");
            string hex = BitConverter.ToString(bytes).Replace("-", "");
            for (int i = 0; i < hex.Length; i += 6)
            {
                if (i > 0) sb.Append('-');
                sb.Append(hex.Substring(i, Math.Min(6, hex.Length - i)));
            }
            lastKey = sb.ToString();
            using (var sha = SHA256.Create())
            {
                byte[] hashBytes = sha.ComputeHash(Encoding.UTF8.GetBytes(lastKey));
                string hash = BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
                var sw = new StringWriter();
                sw.WriteLine('{');
                sw.WriteLine("  \"id\": \"" + id + "\",");
                sw.WriteLine("  \"hash\": \"" + hash + "\",");
                sw.WriteLine("  \"owner\": \"" + owner + "\"" + (expiryBox.Text.Trim().Length > 0 ? "," : ""));
                if (expiryBox.Text.Trim().Length > 0)
                    sw.WriteLine("  \"expiresAt\": \"" + expiryBox.Text.Trim() + "\"");
                sw.Write('}');
                lastJson = sw.ToString();
            }
            AppendHistory(id, owner, expiryBox.Text.Trim());
            resultBox.Text = "=== 사용자에게 전달할 키 ===\r\n" + lastKey + "\r\n\r\n=== licenses.json에 추가할 조각 ===\r\n" + lastJson + "\r\n\r\n(이 키는 발급 기록에 저장되었습니다. [발급 기록] 버튼에서 언제든 다시 볼 수 있습니다)";
            copyKeyButton.Enabled = true;
            copyJsonButton.Enabled = true;
        }

        private void AppendHistory(string id, string owner, string expiresAt)
        {
            try
            {
                string dir = Path.GetDirectoryName(HistoryPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                var line = new StringBuilder();
                line.Append(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
                line.Append("\t").Append(id);
                line.Append("\t").Append(owner);
                line.Append("\t").Append(lastKey);
                line.Append("\t").Append(expiresAt.Length > 0 ? expiresAt : "만료 없음");
                File.AppendAllText(HistoryPath, line.ToString() + Environment.NewLine, Encoding.UTF8);
            }
            catch (Exception ex)
            {
                MessageBox.Show("발급 기록 저장 실패: " + ex.Message, "경고", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void ShowHistory()
        {
            try
            {
                string content = File.Exists(HistoryPath)
                    ? File.ReadAllText(HistoryPath, Encoding.UTF8)
                    : "저장된 발급 기록이 없습니다.";
                var form = new Form
                {
                    Text = "발급 기록 - " + HistoryPath,
                    Size = new Size(720, 480),
                    StartPosition = FormStartPosition.CenterParent
                };
                var box = new TextBox
                {
                    Dock = DockStyle.Fill,
                    Multiline = true,
                    ReadOnly = true,
                    ScrollBars = ScrollBars.Both,
                    WordWrap = false,
                    Font = new Font("Consolas", 9),
                    Text = content
                };
                var copyAll = new Button { Text = "전체 복사", Dock = DockStyle.Bottom, Height = 34 };
                copyAll.Click += (s, e) => Clipboard.SetText(box.Text);
                form.Controls.Add(box);
                form.Controls.Add(copyAll);
                form.ShowDialog(this);
            }
            catch (Exception ex)
            {
                MessageBox.Show("발급 기록 열기 실패: " + ex.Message, "오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.Run(new MainForm());
        }
    }
}
