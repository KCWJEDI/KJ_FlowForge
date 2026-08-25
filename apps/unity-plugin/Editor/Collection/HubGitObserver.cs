using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;

namespace LocalWorkflow.UnityHub
{
    internal static class HubGitObserver
    {
        private static readonly object Sync = new object();
        private static Dictionary<string, object> latest = new Dictionary<string, object>();
        private static bool running;
        private static double lastRefreshAt;
        private static string lastSignature = string.Empty;

        public static Dictionary<string, object> Latest
        {
            get { lock (Sync) return new Dictionary<string, object>(latest); }
        }

        public static void Tick(double now)
        {
            if (now - lastRefreshAt >= 5.0) RefreshNow();
        }

        public static void RefreshNow()
        {
            if (running) return;
            running = true;
            lastRefreshAt = UnityEditor.EditorApplication.timeSinceStartup;
            string projectPath = Directory.GetParent(Application.dataPath).FullName;
            Task.Run(() => ReadGit(projectPath)).ContinueWith(task =>
            {
                running = false;
                if (task.IsFaulted || task.Result == null) return;
                Dictionary<string, object> result = task.Result;
                string signature = HubJson.Serialize(result);
                lock (Sync) latest = result;
                if (signature == lastSignature) return;
                lastSignature = signature;
                HubTcpClient.SendEvent("git.status", result);
            });
        }

        private static Dictionary<string, object> ReadGit(string workingDirectory)
        {
            CommandResult root = RunGit(workingDirectory, "rev-parse --show-toplevel");
            if (root.ExitCode != 0)
            {
                return new Dictionary<string, object>
                {
                    { "available", false },
                    { "branch", string.Empty },
                    { "changedFiles", new List<object>() },
                    { "hasUncommittedChanges", false },
                    { "conflicts", new List<object>() },
                    { "reason", root.Error }
                };
            }

            CommandResult branch = RunGit(workingDirectory, "branch --show-current");
            CommandResult status = RunGit(workingDirectory, "status --porcelain=v1 -z");
            List<object> changed = new List<object>();
            List<object> conflicts = new List<object>();
            string[] records = status.Output.Split(new[] { '\0' }, StringSplitOptions.RemoveEmptyEntries);
            for (int index = 0; index < records.Length; index++)
            {
                string record = records[index];
                if (record.Length < 3) continue;
                string code = record.Substring(0, 2);
                string path = record.Substring(3);
                changed.Add(new Dictionary<string, object>
                {
                    { "status", code },
                    { "path", path }
                });
                if (code.IndexOf('U') >= 0 || code == "AA" || code == "DD") conflicts.Add(path);
                if ((code[0] == 'R' || code[0] == 'C') && index + 1 < records.Length && code[1] != ' ') index++;
            }

            return new Dictionary<string, object>
            {
                { "available", true },
                { "repositoryRoot", root.Output.Trim() },
                { "branch", branch.Output.Trim() },
                { "hasUncommittedChanges", changed.Count > 0 },
                { "changedFiles", changed },
                { "conflicts", conflicts }
            };
        }

        private static CommandResult RunGit(string workingDirectory, string arguments)
        {
            ProcessStartInfo info = new ProcessStartInfo
            {
                FileName = "git",
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            using (Process process = Process.Start(info))
            {
                string output = process.StandardOutput.ReadToEnd();
                string error = process.StandardError.ReadToEnd();
                if (!process.WaitForExit(3000))
                {
                    try { process.Kill(); } catch { }
                    return new CommandResult(-1, output, "git command timed out");
                }
                return new CommandResult(process.ExitCode, output, error);
            }
        }

        private sealed class CommandResult
        {
            public readonly int ExitCode;
            public readonly string Output;
            public readonly string Error;
            public CommandResult(int exitCode, string output, string error)
            {
                ExitCode = exitCode;
                Output = output ?? string.Empty;
                Error = error ?? string.Empty;
            }
        }
    }
}
