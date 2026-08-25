using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace LocalWorkflow.UnityHub
{
    [InitializeOnLoad]
    internal static class HubWorkMetadata
    {
        private static string activeFile = string.Empty;
        private static string lastSaveUtc = string.Empty;
        private static bool lastUnsaved;

        public static string ActiveFile { get { return activeFile; } }
        public static string LastSaveUtc { get { return lastSaveUtc; } }

        static HubWorkMetadata()
        {
            Selection.selectionChanged += OnSelectionChanged;
            lastUnsaved = HubSnapshot.HasUnsavedScenes();
        }

        public static void Tick()
        {
            bool unsaved = HubSnapshot.HasUnsavedScenes();
            if (unsaved == lastUnsaved) return;
            lastUnsaved = unsaved;
            HubTcpClient.SendEvent("work.unsaved.changed", HubSnapshot.UnsavedPayload());
        }

        public static void RecordSave(string[] paths)
        {
            lastSaveUtc = DateTime.UtcNow.ToString("o");
            HubTcpClient.SendEvent("work.saved", new Dictionary<string, object>
            {
                { "path", paths != null && paths.Length > 0 ? paths[0] : null },
                { "savedAt", lastSaveUtc }
            });
        }

        private static void OnSelectionChanged()
        {
            string path = Selection.activeObject == null ? string.Empty : AssetDatabase.GetAssetPath(Selection.activeObject);
            if (string.IsNullOrEmpty(path) || path == activeFile) return;
            activeFile = path;
            HubTcpClient.SendEvent("work.active-file.changed", new Dictionary<string, object>
            {
                { "path", activeFile }
            });
        }
    }
}
