using System.Collections.Generic;
using UnityEditor;

namespace LocalWorkflow.UnityHub
{
    internal sealed class HubAssetPostprocessor : AssetPostprocessor
    {
        private static void OnPostprocessAllAssets(
            string[] importedAssets,
            string[] deletedAssets,
            string[] movedAssets,
            string[] movedFromAssetPaths)
        {
            string[] imported = importedAssets ?? new string[0];
            if (imported.Length > 0)
            {
                HubTcpClient.SendEvent("assets.import.started", new Dictionary<string, object>
                {
                    { "paths", imported }
                });
            }

            string[] deleted = deletedAssets ?? new string[0];
            List<object> moved = BuildMoves(movedFromAssetPaths, movedAssets);
            bool hasCompleted = imported.Length > 0 || deleted.Length > 0 || moved.Count > 0;
            if (hasCompleted)
            {
                HubTcpClient.SendEvent("assets.import.completed", new Dictionary<string, object>
                {
                    { "imported", imported },
                    { "deleted", deleted },
                    { "moved", moved }
                });
            }

            List<object> changed = new List<object>();
            AddAll(changed, imported);
            AddAll(changed, deleted);
            AddAll(changed, movedAssets);
            if (changed.Count > 0)
            {
                HubTcpClient.SendEvent("assets.changed", new Dictionary<string, object>
                {
                    { "paths", changed }
                });
            }

            if (imported.Length > 0)
            {
                HubTcpClient.SendEvent("assets.added", new Dictionary<string, object>
                {
                    { "paths", imported }
                });
            }
            HubGitObserver.RefreshNow();
        }

        private static List<object> BuildMoves(string[] from, string[] to)
        {
            List<object> moves = new List<object>();
            if (from == null || to == null) return moves;
            int count = System.Math.Min(from.Length, to.Length);
            for (int index = 0; index < count; index++)
            {
                moves.Add(new Dictionary<string, object>
                {
                    { "from", from[index] },
                    { "to", to[index] }
                });
            }
            return moves;
        }

        private static void AddAll(List<object> destination, string[] paths)
        {
            if (paths == null) return;
            for (int index = 0; index < paths.Length; index++)
                destination.Add(paths[index]);
        }
    }

    internal sealed class HubAssetModificationProcessor : AssetModificationProcessor
    {
        private static string[] OnWillSaveAssets(string[] paths)
        {
            HubWorkMetadata.RecordSave(paths);
            return paths;
        }
    }
}
