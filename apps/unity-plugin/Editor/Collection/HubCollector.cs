using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Profiling;
using UnityEngine.SceneManagement;

namespace LocalWorkflow.UnityHub
{
    [InitializeOnLoad]
    internal static class HubCollector
    {
        private static readonly ConcurrentQueue<Dictionary<string, object>> PendingLogs =
            new ConcurrentQueue<Dictionary<string, object>>();
        private static readonly List<object> CompilationMessages = new List<object>();
        private static double lastStatusAt;
        private static double lastMetricsAt;
        private static double previousFrameAt;
        private static double compilationStartedAt;
        private static string lastStatusSignature = string.Empty;
        private static string lastEditorState = string.Empty;
        private static bool lastPaused;
        // logMessageReceivedThreaded may fire on a background thread (e.g. when
        // the connection loop logs from the thread pool), where EditorApplication
        // is not allowed. Mirror the play-mode flag here on the main thread.
        private static volatile bool cachedIsPlaying;

        static HubCollector()
        {
            EditorApplication.update += Update;
            EditorApplication.playModeStateChanged += OnPlayModeChanged;
            EditorSceneManager.sceneOpened += OnSceneOpened;
            EditorSceneManager.sceneClosed += OnSceneClosed;
            EditorSceneManager.activeSceneChangedInEditMode += OnActiveSceneChangedInEditMode;
            SceneManager.activeSceneChanged += OnActiveSceneChangedInPlayMode;
            Application.logMessageReceivedThreaded += OnLog;
            CompilationPipeline.compilationStarted += OnCompilationStarted;
            CompilationPipeline.assemblyCompilationFinished += OnAssemblyCompilationFinished;
            CompilationPipeline.compilationFinished += OnCompilationFinished;
            HubTcpClient.ConnectionChanged += OnConnectionChanged;
        }

        public static void SendSnapshot(string eventName = "status.snapshot")
        {
            HubTcpClient.SendEvent(eventName, HubSnapshot.Capture());
        }

        private static void OnConnectionChanged()
        {
            if (!HubTcpClient.IsConnected) return;
            HubTcpClient.SendEvent("project.connected", new Dictionary<string, object>
            {
                { "projectPath", HubSettings.ProjectPath },
                { "projectName", HubSettings.ProjectName },
                { "unityVersion", HubSettings.UnityVersion },
                { "unityPid", Process.GetCurrentProcess().Id },
                { "targetPlatform", HubSettings.TargetPlatform }
            });
            SendSnapshot();
            HubGitObserver.RefreshNow();
            SendSceneList();
            HubTcpClient.SendEvent("scene.active.changed", HubSnapshot.ScenePayload(SceneManager.GetActiveScene()));
            HubTcpClient.SendEvent("work.unsaved.changed", HubSnapshot.UnsavedPayload());
        }

        private static void Update()
        {
            double now = EditorApplication.timeSinceStartup;
            cachedIsPlaying = EditorApplication.isPlaying;
            FlushLogs(100);

            if (EditorApplication.isPlaying)
            {
                if (previousFrameAt <= 0) previousFrameAt = now;
                if (now - lastMetricsAt >= 1.0)
                {
                    double frameSeconds = Math.Max(0.000001, now - previousFrameAt);
                    HubTcpClient.SendEvent("runtime.metrics", new Dictionary<string, object>
                    {
                        { "fps", 1.0 / frameSeconds },
                        { "frameTimeMs", frameSeconds * 1000.0 },
                        { "memoryBytes", Profiler.GetTotalAllocatedMemoryLong() }
                    });
                    lastMetricsAt = now;
                }
                previousFrameAt = now;
            }
            else
            {
                previousFrameAt = 0;
            }

            if (now - lastStatusAt >= 1.0)
            {
                lastStatusAt = now;

                string editorState = HubSnapshot.GetEditorState();
                if (editorState != lastEditorState)
                {
                    lastEditorState = editorState;
                    HubTcpClient.SendEvent("editor.state.changed", new Dictionary<string, object>
                    {
                        { "state", editorState }
                    });
                }

                if (EditorApplication.isPlaying && EditorApplication.isPaused != lastPaused)
                {
                    lastPaused = EditorApplication.isPaused;
                    HubTcpClient.SendEvent("play.mode.changed", new Dictionary<string, object>
                    {
                        { "state", lastPaused ? "paused" : "playing" }
                    });
                }

                string signature = EditorApplication.isPlaying + "|" + EditorApplication.isPaused + "|" +
                    EditorApplication.isCompiling + "|" + EditorApplication.isUpdating + "|" +
                    SceneManager.GetActiveScene().path + "|" + HubSnapshot.HasUnsavedScenes();
                if (signature != lastStatusSignature)
                {
                    lastStatusSignature = signature;
                    SendSnapshot();
                }
                HubGitObserver.Tick(now);
                HubWorkMetadata.Tick();
            }
        }

        private static void FlushLogs(int budget)
        {
            Dictionary<string, object> entry;
            while (budget-- > 0 && PendingLogs.TryDequeue(out entry))
            {
                bool playMode = HubJson.GetBool(entry, "playMode", false);
                HubTcpClient.SendEvent(playMode ? "play.console.log" : "console.log", entry);
            }
        }

        private static void OnLog(string condition, string stackTrace, LogType type)
        {
            string severity;
            switch (type)
            {
                case LogType.Error: severity = "error"; break;
                case LogType.Exception: severity = "exception"; break;
                case LogType.Assert: severity = "assert"; break;
                case LogType.Warning: severity = "warning"; break;
                default: severity = "log"; break;
            }
            string message = condition ?? string.Empty;
            Dictionary<string, object> entry = new Dictionary<string, object>
            {
                { "severity", severity },
                { "message", message },
                { "stackTrace", stackTrace ?? string.Empty },
                { "channel", message.StartsWith("[Hub]", StringComparison.Ordinal) ? "hub" : "unity" },
                { "occurredAt", HubTime.NowUtcIso() },
                { "playMode", cachedIsPlaying }
            };
            PendingLogs.Enqueue(entry);
            HubBuildRunner.ObserveBuildLog(severity, message, stackTrace);
        }

        private static void OnPlayModeChanged(PlayModeStateChange state)
        {
            string playState;
            switch (state)
            {
                case PlayModeStateChange.EnteredPlayMode: playState = "playing"; break;
                case PlayModeStateChange.ExitingPlayMode: playState = "exiting"; break;
                case PlayModeStateChange.EnteredEditMode: playState = "stopped"; break;
                case PlayModeStateChange.ExitingEditMode: playState = "entering"; break;
                default: playState = state.ToString(); break;
            }
            HubTcpClient.SendEvent("play.mode.changed", new Dictionary<string, object>
            {
                { "state", playState }
            });
            SendSnapshot();
        }

        private static void OnSceneOpened(Scene scene, OpenSceneMode mode)
        {
            HubTcpClient.SendEvent("scene.loaded", new Dictionary<string, object>
            {
                { "name", scene.IsValid() ? scene.name : string.Empty },
                { "path", scene.IsValid() ? scene.path : string.Empty },
                { "mode", mode == OpenSceneMode.Additive ? "additive" : "single" }
            });
            SendSceneList();
        }

        private static void OnSceneClosed(Scene scene)
        {
            HubTcpClient.SendEvent("scene.unloaded", new Dictionary<string, object>
            {
                { "name", scene.IsValid() ? scene.name : string.Empty },
                { "path", scene.IsValid() ? scene.path : string.Empty }
            });
            SendSceneList();
        }

        private static void OnActiveSceneChangedInEditMode(Scene previous, Scene next)
        {
            if (EditorApplication.isPlaying) return;
            SendActiveSceneChanged(next);
        }

        private static void OnActiveSceneChangedInPlayMode(Scene previous, Scene next)
        {
            if (!EditorApplication.isPlaying) return;
            SendActiveSceneChanged(next);
        }

        private static void SendActiveSceneChanged(Scene next)
        {
            HubTcpClient.SendEvent("scene.active.changed", HubSnapshot.ScenePayload(next));
            SendSceneList();
        }

        private static void SendSceneList()
        {
            HubTcpClient.SendEvent("scene.list.changed", new Dictionary<string, object>
            {
                { "scenes", HubSnapshot.SceneListPayload() }
            });
        }

        private static void OnCompilationStarted(object context)
        {
            compilationStartedAt = EditorApplication.timeSinceStartup;
            CompilationMessages.Clear();
            HubTcpClient.SendEvent("compilation.started", new Dictionary<string, object>
            {
                { "assemblies", new string[0] }
            });
        }

        private static void OnAssemblyCompilationFinished(string assemblyPath, CompilerMessage[] messages)
        {
            if (messages == null) return;
            for (int index = 0; index < messages.Length; index++)
            {
                CompilerMessage message = messages[index];
                if (message.type != CompilerMessageType.Error && message.type != CompilerMessageType.Warning) continue;
                CompilationMessages.Add(new Dictionary<string, object>
                {
                    { "file", message.file ?? string.Empty },
                    { "line", message.line },
                    { "column", message.column },
                    { "code", string.Empty },
                    { "severity", message.type == CompilerMessageType.Error ? "error" : "warning" },
                    { "message", message.message ?? string.Empty }
                });
            }
        }

        private static void OnCompilationFinished(object context)
        {
            bool succeeded = true;
            for (int index = 0; index < CompilationMessages.Count; index++)
            {
                Dictionary<string, object> item = CompilationMessages[index] as Dictionary<string, object>;
                if (item != null && HubJson.GetString(item, "severity") == "error")
                {
                    succeeded = false;
                    break;
                }
            }
            long durationMs = Math.Max(0, (long)((EditorApplication.timeSinceStartup - compilationStartedAt) * 1000.0));
            HubTcpClient.SendEvent("compilation.completed", new Dictionary<string, object>
            {
                { "durationMs", durationMs },
                { "succeeded", succeeded }
            });
            if (CompilationMessages.Count > 0)
            {
                HubTcpClient.SendEvent("compilation.errors", new Dictionary<string, object>
                {
                    { "errors", new List<object>(CompilationMessages) }
                });
            }
        }
    }
}
