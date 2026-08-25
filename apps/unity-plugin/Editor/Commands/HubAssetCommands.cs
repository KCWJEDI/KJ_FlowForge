using System.Collections.Generic;
using UnityEditor;

namespace LocalWorkflow.UnityHub
{
    internal static class HubAssetCommands
    {
        public static void Refresh(HubEnvelope envelope)
        {
            bool forceSynchronous = HubJson.GetBool(envelope.PayloadObject, "forceSynchronous", false);
            AssetDatabase.Refresh(forceSynchronous ? ImportAssetOptions.ForceSynchronousImport : ImportAssetOptions.Default);
            HubTcpClient.SendCommandResponse(envelope, new Dictionary<string, object>
            {
                { "forceSynchronous", forceSynchronous },
                { "importing", false },
                { "changed", true }
            });
        }

        public static void Recompile(HubEnvelope envelope)
        {
            // Respond immediately: the refresh below can trigger a domain reload that
            // would discard any deferred callback before a response could be sent.
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            bool compiling = EditorApplication.isCompiling;
            bool changed = true;
            HubTcpClient.SendCommandResponse(envelope, new Dictionary<string, object>
            {
                { "compiling", compiling },
                { "changed", changed },
                { "message", compiling ? "Script compilation started." : "No script changes were detected." }
            });
        }
    }
}
