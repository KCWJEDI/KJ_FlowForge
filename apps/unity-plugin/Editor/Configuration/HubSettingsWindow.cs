using UnityEditor;
using UnityEngine;

namespace LocalWorkflow.UnityHub
{
    internal sealed class HubSettingsWindow : EditorWindow
    {
        [MenuItem("Local Workflow Hub/Settings")]
        private static void Open()
        {
            HubSettingsWindow window = GetWindow<HubSettingsWindow>("Local Workflow Hub Settings");
            window.minSize = new Vector2(380, 240);
            window.Show();
        }

        private void OnEnable()
        {
            HubTcpClient.ConnectionChanged += OnConnectionChanged;
        }

        private void OnDisable()
        {
            HubTcpClient.ConnectionChanged -= OnConnectionChanged;
        }

        private void OnConnectionChanged()
        {
            Repaint();
        }

        private void OnGUI()
        {
            EditorGUILayout.LabelField("Connection", EditorStyles.boldLabel);

            string nextHost = EditorGUILayout.TextField("Host", HubSettings.Host);
            if (nextHost != HubSettings.Host) HubSettings.Host = nextHost;

            int nextPort = EditorGUILayout.IntField("Port", HubSettings.Port);
            if (nextPort != HubSettings.Port) HubSettings.Port = nextPort;

            string nextSecret = EditorGUILayout.PasswordField("Session Secret", HubSettings.SessionSecret);
            if (nextSecret != HubSettings.SessionSecret) HubSettings.SessionSecret = nextSecret;
            EditorGUILayout.LabelField("Secret Source", HubSettings.SessionSecretSource);

            bool nextAutoConnect = EditorGUILayout.Toggle("Auto Connect", HubSettings.AutoConnect);
            if (nextAutoConnect != HubSettings.AutoConnect) HubSettings.AutoConnect = nextAutoConnect;

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Status", EditorStyles.boldLabel);
            EditorGUILayout.LabelField(HubTcpClient.Status);
            EditorGUI.indentLevel++;
            EditorGUILayout.LabelField(HubTcpClient.IsConnected ? "Connected to " +
                HubSettings.Host + ":" + HubSettings.Port : "Not connected");
            EditorGUI.indentLevel--;

            EditorGUILayout.Space();
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("Start")) HubTcpClient.Start();
            if (GUILayout.Button("Stop")) HubTcpClient.Stop();
            if (GUILayout.Button("Restart")) HubTcpClient.Restart();
            EditorGUILayout.EndHorizontal();
        }
    }
}
