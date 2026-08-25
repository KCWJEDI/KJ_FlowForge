using System;
using System.Collections.Generic;
using UnityEditor;

namespace LocalWorkflow.UnityHub
{
    // Dispatches hub commands to typed handlers. MessageReceived is raised on the
    // main thread by HubTcpClient.PumpMainThread, so every handler can safely call
    // UnityEditor APIs. Every command resolves through either SendCommandResponse or
    // SendCommandError, both of which preserve the originating requestId.
    [InitializeOnLoad]
    internal static class HubCommandRouter
    {
        private static readonly Dictionary<string, Action<HubEnvelope>> Handlers =
            new Dictionary<string, Action<HubEnvelope>>(StringComparer.Ordinal)
            {
                { "scene.load", HubSceneCommands.Load },
                { "scene.save", HubSceneCommands.Save },
                { "play.enter", HubPlayCommands.Enter },
                { "play.exit", HubPlayCommands.Exit },
                { "build.run", HubBuildRunner.Run },
                { "assets.refresh", HubAssetCommands.Refresh },
                { "scripts.recompile", HubAssetCommands.Recompile },
                { "status.snapshot", Snapshot }
            };

        static HubCommandRouter()
        {
            HubTcpClient.MessageReceived += OnMessageReceived;
        }

        private static void OnMessageReceived(HubEnvelope envelope)
        {
            if (envelope == null || envelope.Type != "command") return;
            Action<HubEnvelope> handler;
            if (Handlers.TryGetValue(envelope.Name, out handler))
            {
                try
                {
                    handler(envelope);
                }
                catch (Exception exception)
                {
                    HubTcpClient.SendCommandError(envelope, "internal_error", exception.Message);
                }
                return;
            }
            HubTcpClient.SendCommandError(envelope, "unknown_command", "Unrecognized hub command: " + envelope.Name);
        }

        private static void Snapshot(HubEnvelope envelope)
        {
            HubTcpClient.SendCommandResponse(envelope, HubSnapshot.Capture());
        }
    }
}