using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;

namespace LocalWorkflow.UnityHub
{
    internal static class HubSceneCommands
    {
        public static void Load(HubEnvelope envelope)
        {
            Dictionary<string, object> payload = envelope.PayloadObject;
            string scenePath = HubJson.GetString(payload, "path");
            if (scenePath.Length == 0)
            {
                HubTcpClient.SendCommandError(envelope, "invalid_path", "scene.load requires a scene path.");
                return;
            }
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(scenePath) == null)
            {
                HubTcpClient.SendCommandError(envelope, "scene_not_found", "Scene file does not exist in the project: " + scenePath);
                return;
            }
            bool additive = HubJson.GetBool(payload, "additive", false);
            if (EditorApplication.isPlaying)
            {
                HubTcpClient.SendCommandError(envelope, "play_mode_blocked", "Cannot open scenes while play mode is active.");
                return;
            }

            try
            {
                Scene scene = EditorSceneManager.OpenScene(scenePath, additive ? OpenSceneMode.Additive : OpenSceneMode.Single);
                SceneManager.SetActiveScene(scene);

                HubTcpClient.SendCommandResponse(envelope, new Dictionary<string, object>
                {
                    { "path", scene.path },
                    { "additive", additive },
                    { "name", scene.name },
                    { "openScenes", HubSnapshot.SceneListPayload() }
                });
            }
            catch (Exception exception)
            {
                HubTcpClient.SendCommandError(envelope, "scene_load_failed", exception.Message);
            }
        }

        public static void Save(HubEnvelope envelope)
        {
            Dictionary<string, object> payload = envelope.PayloadObject;
            bool saveAs = HubJson.GetBool(payload, "saveAs", false);
            string requestedPath = HubJson.GetString(payload, "path");
            Scene activeScene = SceneManager.GetActiveScene();
            if (!activeScene.IsValid())
            {
                HubTcpClient.SendCommandError(envelope, "no_active_scene", "There is no active scene to save.");
                return;
            }

            try
            {
                if (!saveAs && activeScene.path.Length == 0)
                {
                    HubTcpClient.SendCommandError(envelope, "untitled_scene", "The active scene has never been saved. Provide a path or saveAs=true.");
                    return;
                }

                bool success;
                string savedPath;
                if (saveAs || requestedPath.Length == 0)
                {
                    savedPath = requestedPath.Length > 0 ? requestedPath : activeScene.path;
                    if (savedPath.Length == 0)
                    {
                        HubTcpClient.SendCommandError(envelope, "invalid_path", "scene.save requires a path when saving an untitled scene.");
                        return;
                    }
                    string normalized = savedPath;
                    if (normalized.IndexOf("Assets/", StringComparison.OrdinalIgnoreCase) != 0)
                        normalized = "Assets/" + savedPath;
                    string extension = ".unity";
                    if (normalized.IndexOf(extension, StringComparison.OrdinalIgnoreCase) != normalized.Length - extension.Length)
                        normalized += extension;
                    success = EditorSceneManager.SaveScene(activeScene, normalized);
                    savedPath = normalized;
                }
                else
                {
                    savedPath = activeScene.path;
                    success = EditorSceneManager.SaveScene(activeScene);
                }

                if (!success)
                {
                    HubTcpClient.SendCommandError(envelope, "scene_save_failed", "Unity declined to save the scene.");
                    return;
                }
                HubTcpClient.SendCommandResponse(envelope, new Dictionary<string, object>
                {
                    { "path", savedPath },
                    { "savedAt", HubTime.NowUtcIso() }
                });
            }
            catch (Exception exception)
            {
                HubTcpClient.SendCommandError(envelope, "scene_save_failed", exception.Message);
            }
        }
    }
}