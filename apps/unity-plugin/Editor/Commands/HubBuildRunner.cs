using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace LocalWorkflow.UnityHub
{
    // Runs the build on the Unity main thread (the command handler is pumped on the
    // main thread by HubTcpClient), emitting build.started, build.progress and
    // build.completed events. Warning/error counts come from log entries observed via
    // HubCollector.ObserveBuildLog, which may arrive on background threads, so the
    // counters are guarded by a lock.
    internal static class HubBuildRunner
    {
        private const int MaxLogCharacters = 32768;

        private static readonly object Sync = new object();
        private static readonly List<string> BuildLog = new List<string>();
        private static volatile bool building;
        private static int warningCount;
        private static int errorCount;

        public static bool IsBuilding { get { return building; } }

        public static void Run(HubEnvelope envelope)
        {
            if (building)
            {
                HubTcpClient.SendCommandError(envelope, "build_in_progress", "A build is already running.");
                return;
            }

            Dictionary<string, object> payload = envelope.PayloadObject;
            string targetName = HubJson.GetString(payload, "target");
            string outputPath = HubJson.GetString(payload, "outputPath");
            bool development = HubJson.GetBool(payload, "development", false);
            List<object> scenes = payload.ContainsKey("scenes") ? payload["scenes"] as List<object> : null;

            BuildTarget buildTarget;
            if (!TryParseBuildTarget(targetName, out buildTarget))
            {
                HubTcpClient.SendCommandError(envelope, "invalid_target", "Unknown build target: " + targetName);
                return;
            }
            if (string.IsNullOrEmpty(outputPath))
            {
                HubTcpClient.SendCommandError(envelope, "invalid_output", "outputPath is required.");
                return;
            }

            List<string> scenePaths = BuildSceneList(scenes);
            string resolvedOutput = ResolveOutputPath(outputPath);

            BeginBuild();

            try
            {
                HubTcpClient.SendEvent("build.started", new Dictionary<string, object>
                {
                    { "target", buildTarget.ToString() },
                    { "outputPath", resolvedOutput },
                    { "scenes", scenePaths }
                });
                HubTcpClient.SendEvent("build.progress", new Dictionary<string, object>
                {
                    { "progress", 0 },
                    { "message", "Starting build for " + buildTarget }
                });

                BuildPlayerOptions options = new BuildPlayerOptions
                {
                    target = buildTarget,
                    locationPathName = resolvedOutput,
                    scenes = scenePaths.Count > 0 ? scenePaths.ToArray() : null,
                    options = development ? BuildOptions.Development : BuildOptions.None
                };

                BuildReport report = BuildPipeline.BuildPlayer(options);
                BuildSummary summary = report != null ? report.summary : default(BuildSummary);
                bool succeeded = report != null && summary.result == BuildResult.Succeeded;
                string result = report != null ? summary.result.ToString() : "Failed";

                CompleteBuild();
                HubTcpClient.SendEvent("build.progress", new Dictionary<string, object>
                {
                    { "progress", 1 },
                    { "message", "Build " + result }
                });
                HubTcpClient.SendEvent("build.completed", BuildCompletedPayload(
                    succeeded,
                    result,
                    buildTarget.ToString(),
                    resolvedOutput,
                    summary,
                    report));
                HubTcpClient.SendCommandResponse(envelope, new Dictionary<string, object>
                {
                    { "succeeded", succeeded },
                    { "result", result },
                    { "target", buildTarget.ToString() },
                    { "outputPath", resolvedOutput },
                    { "durationMs", summary.totalTime.TotalMilliseconds },
                    { "warningCount", warningCount },
                    { "errorCount", errorCount }
                });
            }
            catch (Exception exception)
            {
                CompleteBuild();
                HubTcpClient.SendEvent("build.completed", new Dictionary<string, object>
                {
                    { "succeeded", false },
                    { "result", "Exception: " + exception.Message },
                    { "target", buildTarget.ToString() },
                    { "outputPath", resolvedOutput },
                    { "durationMs", 0 },
                    { "warningCount", warningCount },
                    { "errorCount", errorCount },
                    { "log", BuildLogText() }
                });
                HubTcpClient.SendCommandError(envelope, "build_failed", exception.Message);
            }
        }

        // Thread-safe and safe to call when no build is in flight.
        internal static void ObserveBuildLog(string severity, string message, string stackTrace)
        {
            if (!building) return;
            lock (Sync)
            {
                if (severity == "error" || severity == "exception" || severity == "assert") errorCount++;
                else if (severity == "warning") warningCount++;
                AppendLog(severity, message, stackTrace);
            }
        }

        private static bool TryParseBuildTarget(string targetName, out BuildTarget buildTarget)
        {
            buildTarget = BuildTarget.StandaloneWindows64;
            if (string.IsNullOrEmpty(targetName)) return false;
            try
            {
                buildTarget = (BuildTarget)Enum.Parse(typeof(BuildTarget), targetName, true);
                return Enum.IsDefined(typeof(BuildTarget), buildTarget);
            }
            catch
            {
                return false;
            }
        }

        private static List<string> BuildSceneList(List<object> scenes)
        {
            List<string> scenePaths = new List<string>();
            if (scenes == null)
            {
                EditorBuildSettingsScene[] buildScenes = EditorBuildSettings.scenes;
                if (buildScenes != null)
                {
                    for (int index = 0; index < buildScenes.Length; index++)
                    {
                        EditorBuildSettingsScene item = buildScenes[index];
                        if (item.enabled && !string.IsNullOrEmpty(item.path)) scenePaths.Add(item.path);
                    }
                }
                return scenePaths;
            }
            for (int index = 0; index < scenes.Count; index++)
            {
                string path = scenes[index] == null ? string.Empty : Convert.ToString(scenes[index], System.Globalization.CultureInfo.InvariantCulture);
                if (!string.IsNullOrEmpty(path)) scenePaths.Add(path);
            }
            return scenePaths;
        }

        private static string ResolveOutputPath(string outputPath)
        {
            if (Path.IsPathRooted(outputPath)) return outputPath;
            return Path.Combine(Path.GetDirectoryName(Application.dataPath), outputPath);
        }

        private static Dictionary<string, object> BuildCompletedPayload(
            bool succeeded,
            string result,
            string target,
            string outputPath,
            BuildSummary summary,
            BuildReport report)
        {
            return new Dictionary<string, object>
            {
                { "succeeded", succeeded },
                { "result", result },
                { "target", target },
                { "outputPath", outputPath },
                { "durationMs", summary.totalTime.TotalMilliseconds },
                { "warningCount", summary.totalWarnings },
                { "errorCount", summary.totalErrors },
                { "log", BuildLogText() }
            };
        }

        private static string BuildLogText()
        {
            lock (Sync)
            {
                if (BuildLog.Count == 0) return string.Empty;
                StringBuilder builder = new StringBuilder(MaxLogCharacters);
                for (int index = 0; index < BuildLog.Count; index++)
                {
                    builder.AppendLine(BuildLog[index]);
                    if (builder.Length >= MaxLogCharacters)
                    {
                        builder.Length = MaxLogCharacters;
                        builder.AppendLine("... log truncated ...");
                        break;
                    }
                }
                return builder.ToString();
            }
        }

        private static void AppendLog(string severity, string message, string stackTrace)
        {
            string text = "[" + severity + "] " + message;
            if (!string.IsNullOrEmpty(stackTrace)) text += "\n" + stackTrace;
            BuildLog.Add(text);
            if (BuildLog.Count > 2000) BuildLog.RemoveAt(0);
        }

        private static void BeginBuild()
        {
            lock (Sync)
            {
                BuildLog.Clear();
                warningCount = 0;
                errorCount = 0;
                building = true;
            }
        }

        private static void CompleteBuild()
        {
            lock (Sync)
            {
                building = false;
            }
        }
    }
}