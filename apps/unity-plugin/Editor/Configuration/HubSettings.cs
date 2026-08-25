using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace LocalWorkflow.UnityHub
{
    internal static class HubSettings
    {
        private const string Prefix = "LocalWorkflow.UnityHub.";
        private const int DefaultPort = 43101;

        public static string Host
        {
            get { return EditorPrefs.GetString(Prefix + "Host", "127.0.0.1"); }
            set { EditorPrefs.SetString(Prefix + "Host", string.IsNullOrEmpty(value) ? "127.0.0.1" : value); }
        }

        public static int Port
        {
            get { return EditorPrefs.GetInt(Prefix + "Port", DefaultPort); }
            set { EditorPrefs.SetInt(Prefix + "Port", value); }
        }

        public static string SessionSecret
        {
            get { return EditorPrefs.GetString(Prefix + "SessionSecret", string.Empty); }
            set { EditorPrefs.SetString(Prefix + "SessionSecret", value ?? string.Empty); }
        }

        public static bool AutoConnect
        {
            get { return EditorPrefs.GetBool(Prefix + "AutoConnect", true); }
            set { EditorPrefs.SetBool(Prefix + "AutoConnect", value); }
        }

        public static int MaxFrameBytes { get { return 8 * 1024 * 1024; } }

        public static string ProjectPath
        {
            get { return Directory.GetParent(Application.dataPath).FullName; }
        }

        public static string ProjectName
        {
            get { return PlayerSettings.productName; }
        }

        public static string UnityVersion
        {
            get { return Application.unityVersion; }
        }

        public static string TargetPlatform
        {
            get { return EditorUserBuildSettings.activeBuildTarget.ToString(); }
        }

        // Resolution order:
        //   1. HUB_UNITY_SESSION_SECRET environment variable
        //   2. The hub's per-run session file at
        //      <userData>/runtime/unity-session.json
        //      (userData defaults to %APPDATA%/local-unity-workflow-hub,
        //      override with HUB_USER_DATA_DIR)
        //   3. The value configured in the settings window.
        public static string ResolveSessionSecret()
        {
            return ResolveSessionSecretWithSource().Secret;
        }

        public static string SessionSecretSource
        {
            get { return ResolveSessionSecretWithSource().Source; }
        }

        // Thread-safe variant used by the background connection loop.
        // Unlike ResolveSessionSecret(), it never touches EditorPrefs
        // (main-thread-only). The settings value is passed in as a snapshot
        // taken on the main thread by HubTcpClient.Start().
        public static string ResolveSessionSecretThreadSafe(string settingsSecret)
        {
            return ResolveSessionSecretWithSourceThreadSafe(settingsSecret).Secret;
        }

        public static string SessionSecretSourceThreadSafe(string settingsSecret)
        {
            return ResolveSessionSecretWithSourceThreadSafe(settingsSecret).Source;
        }

        private static SessionSecretResult ResolveSessionSecretWithSource()
        {
            string environmentSecret = System.Environment.GetEnvironmentVariable("HUB_UNITY_SESSION_SECRET");
            if (!string.IsNullOrEmpty(environmentSecret)) return new SessionSecretResult(environmentSecret, "environment");

            string fileSecret = ReadHubSessionSecretFile();
            if (!string.IsNullOrEmpty(fileSecret)) return new SessionSecretResult(fileSecret, "session-file");

            return new SessionSecretResult(SessionSecret, string.IsNullOrEmpty(SessionSecret) ? "none" : "settings");
        }

        private static SessionSecretResult ResolveSessionSecretWithSourceThreadSafe(string settingsSecret)
        {
            string environmentSecret = System.Environment.GetEnvironmentVariable("HUB_UNITY_SESSION_SECRET");
            if (!string.IsNullOrEmpty(environmentSecret)) return new SessionSecretResult(environmentSecret, "environment");

            string fileSecret = ReadHubSessionSecretFile();
            if (!string.IsNullOrEmpty(fileSecret)) return new SessionSecretResult(fileSecret, "session-file");

            return new SessionSecretResult(settingsSecret ?? string.Empty, string.IsNullOrEmpty(settingsSecret) ? "none" : "settings");
        }

        private static string ReadHubSessionSecretFile()
        {
            try
            {
                string overrideDir = System.Environment.GetEnvironmentVariable("HUB_USER_DATA_DIR");
                string baseDirectory = string.IsNullOrEmpty(overrideDir)
                    ? Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.ApplicationData), "local-unity-workflow-hub")
                    : overrideDir;
                string secretFile = Path.Combine(baseDirectory, "runtime", "unity-session.json");
                if (!File.Exists(secretFile)) return string.Empty;

                string json = File.ReadAllText(secretFile);
                const string marker = "\"sessionSecret\"";
                int index = json.IndexOf(marker, System.StringComparison.Ordinal);
                if (index < 0) return string.Empty;
                index += marker.Length;
                while (index < json.Length && (json[index] == ' ' || json[index] == '\t' || json[index] == ':'))
                    index++;
                if (index >= json.Length || json[index] != '"') return string.Empty;
                index++;
                var builder = new StringBuilder();
                while (index < json.Length && json[index] != '"')
                    builder.Append(json[index++]);
                return builder.ToString();
            }
            catch
            {
                return string.Empty;
            }
        }

        // Stable per-project client id derived from the project path (no external packages).
        public static string ClientId
        {
            get
            {
                byte[] hash = MD5.Create().ComputeHash(Encoding.UTF8.GetBytes(ProjectPath));
                StringBuilder builder = new StringBuilder("unity-", 38);
                for (int index = 0; index < hash.Length; index++)
                    builder.Append(hash[index].ToString("x2"));
                return builder.ToString();
            }
        }

        private sealed class SessionSecretResult
        {
            public SessionSecretResult(string secret, string source)
            {
                Secret = secret;
                Source = source;
            }

            public string Secret { get; private set; }
            public string Source { get; private set; }
        }
    }
}
