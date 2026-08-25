using System.Collections.Generic;
using UnityEditor;

namespace LocalWorkflow.UnityHub
{
    internal static class HubPlayCommands
    {
        public static void Enter(HubEnvelope envelope)
        {
            if (EditorApplication.isPlaying)
            {
                HubTcpClient.SendCommandError(envelope, "already_playing", "Play mode is already active.");
                return;
            }
            EditorApplication.isPaused = false;
            EditorApplication.isPlaying = true;
            HubTcpClient.SendCommandResponse(envelope, new Dictionary<string, object>
            {
                { "state", "entering" }
            });
        }

        public static void Exit(HubEnvelope envelope)
        {
            if (!EditorApplication.isPlaying)
            {
                HubTcpClient.SendCommandError(envelope, "not_playing", "Play mode is not active.");
                return;
            }
            EditorApplication.isPlaying = false;
            HubTcpClient.SendCommandResponse(envelope, new Dictionary<string, object>
            {
                { "state", "exiting" }
            });
        }
    }
}