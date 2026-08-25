using System;
using System.Collections.Generic;
using System.Diagnostics;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace LocalWorkflow.UnityHub
{
    internal static class HubSnapshot
    {
        public static Dictionary<string, object> Capture()
        {
            Scene activeScene = SceneManager.GetActiveScene();
            Dictionary<string, object> unsaved = UnsavedPayload();
            Dictionary<string, object> snapshot = new Dictionary<string, object>
            {
                { "projectPath", HubSettings.ProjectPath },
                { "projectName", HubSettings.ProjectName },
                { "unityVersion", HubSettings.UnityVersion },
                { "unityPid", Process.GetCurrentProcess().Id },
                { "targetPlatform", HubSettings.TargetPlatform },
                { "editorState", GetEditorState() },
                { "activeScene", ScenePayload(activeScene) },
                { "openScenes", SceneListPayload() },
                { "git", HubGitObserver.Latest },
                { "activeFile", HubWorkMetadata.ActiveFile },
                { "lastSaveAt", HubWorkMetadata.LastSaveUtc },
                { "hasUnsavedChanges", unsaved["hasUnsavedChanges"] },
                { "dirtyScenes", unsaved["dirtyScenes"] }
            };
            return snapshot;
        }

        public static Dictionary<string, object> ScenePayload(Scene scene)
        {
            return new Dictionary<string, object>
            {
                { "name", scene.IsValid() ? scene.name : string.Empty },
                { "path", scene.IsValid() ? scene.path : string.Empty },
                { "isDirty", scene.IsValid() && scene.isDirty }
            };
        }

        public static List<object> SceneListPayload()
        {
            List<object> scenes = new List<object>();
            for (int index = 0; index < SceneManager.sceneCount; index++)
            {
                Scene scene = SceneManager.GetSceneAt(index);
                scenes.Add(new Dictionary<string, object>
                {
                    { "name", scene.IsValid() ? scene.name : string.Empty },
                    { "path", scene.IsValid() ? scene.path : string.Empty },
                    { "isLoaded", scene.IsValid() && scene.isLoaded },
                    { "isDirty", scene.IsValid() && scene.isDirty }
                });
            }
            return scenes;
        }

        public static Dictionary<string, object> UnsavedPayload()
        {
            List<object> dirtyScenes = new List<object>();
            for (int index = 0; index < SceneManager.sceneCount; index++)
            {
                Scene scene = SceneManager.GetSceneAt(index);
                if (scene.IsValid() && scene.isDirty) dirtyScenes.Add(scene.path);
            }
            return new Dictionary<string, object>
            {
                { "hasUnsavedChanges", dirtyScenes.Count > 0 },
                { "dirtyScenes", dirtyScenes }
            };
        }

        public static bool HasUnsavedScenes()
        {
            for (int index = 0; index < SceneManager.sceneCount; index++)
            {
                if (SceneManager.GetSceneAt(index).isDirty) return true;
            }
            return false;
        }

        public static string GetEditorState()
        {
            if (HubBuildRunner.IsBuilding) return "building";
            if (EditorApplication.isCompiling) return "compiling";
            if (EditorApplication.isPlaying && EditorApplication.isPaused) return "paused";
            if (EditorApplication.isPlaying) return "playing";
            return "editing";
        }
    }
}
