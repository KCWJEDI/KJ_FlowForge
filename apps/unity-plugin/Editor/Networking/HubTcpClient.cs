using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;

namespace LocalWorkflow.UnityHub
{
    [InitializeOnLoad]
    internal static class HubTcpClient
    {
        private static readonly ConcurrentQueue<HubEnvelope> Inbound = new ConcurrentQueue<HubEnvelope>();
        private static readonly ConcurrentQueue<Action> MainThreadActions = new ConcurrentQueue<Action>();
        private static readonly object SendLock = new object();
        private static CancellationTokenSource cancellation;
        private static Task connectionTask;
        private static TcpClient client;
        private static NetworkStream stream;
        private static volatile bool connected;
        private static volatile string status = "Disconnected";

        public static event Action ConnectionChanged;
        public static event Action<HubEnvelope> MessageReceived;

        public static bool IsConnected { get { return connected; } }
        public static string Status { get { return status; } }

        static HubTcpClient()
        {
            EditorApplication.update += PumpMainThread;
            AssemblyReloadEvents.beforeAssemblyReload += Stop;
            EditorApplication.quitting += Stop;
            Debug.Log("[Hub] HubTcpClient initialized (AutoConnect=" + HubSettings.AutoConnect +
                ", secretSource=" + HubSettings.SessionSecretSource + ")");
            if (HubSettings.AutoConnect)
                EditorApplication.delayCall += Start;
        }

        public static void Start()
        {
            if (connectionTask != null && !connectionTask.IsCompleted) return;
            Debug.Log("[Hub] Start() called (Host=" + HubSettings.Host + ", Port=" + HubSettings.Port + ")");
            // UnityEditor APIs (EditorPrefs, PlayerSettings, build target) are
            // main-thread-only. Snapshot everything the background connection
            // loop needs before leaving the main thread.
            HelloSnapshot hello = new HelloSnapshot
            {
                Host = HubSettings.Host,
                Port = HubSettings.Port,
                SettingsSecret = HubSettings.SessionSecret,
                ClientId = HubSettings.ClientId,
                ProjectPath = HubSettings.ProjectPath,
                ProjectName = HubSettings.ProjectName,
                UnityVersion = HubSettings.UnityVersion,
                UnityPid = System.Diagnostics.Process.GetCurrentProcess().Id,
                TargetPlatform = HubSettings.TargetPlatform
            };
            cancellation = new CancellationTokenSource();
            connectionTask = Task.Run(() => ConnectionLoop(hello, cancellation.Token));
        }

        public static void Restart()
        {
            Stop();
            Start();
        }

        public static void Stop()
        {
            CancellationTokenSource source = cancellation;
            cancellation = null;
            if (source != null) source.Cancel();
            CloseSocket();
            SetConnectionState(false, "Disconnected");
        }

        public static void SendEvent(string name, object payload)
        {
            Send(HubEnvelope.Create("event", name, payload));
        }

        public static void SendResponse(HubEnvelope command, string name, object payload)
        {
            Send(HubEnvelope.Create("response", name, payload, command.RequestId));
        }

        public static void SendCommandResponse(HubEnvelope command, object result)
        {
            Send(HubEnvelope.Create("response", command.Name, new Dictionary<string, object>
            {
                { "ok", true },
                { "result", result ?? new Dictionary<string, object>() }
            }, command.RequestId));
        }

        public static void SendCommandError(HubEnvelope command, string code, string message)
        {
            Send(HubEnvelope.Create("response", command.Name, new Dictionary<string, object>
            {
                { "ok", false },
                { "error", new Dictionary<string, object>
                    {
                        { "code", code },
                        { "message", message }
                    }
                }
            }, command.RequestId));
        }

        public static void SendError(HubEnvelope command, string code, string message)
        {
            Send(HubEnvelope.Create("error", command.Name, new Dictionary<string, object>
            {
                { "code", code },
                { "message", message }
            }, command.RequestId));
        }

        public static void Send(HubEnvelope envelope)
        {
            NetworkStream activeStream = stream;
            if (!connected || activeStream == null) return;
            try
            {
                byte[] payload = Encoding.UTF8.GetBytes(HubJson.SerializeEnvelope(envelope));
                if (payload.Length > HubSettings.MaxFrameBytes)
                    throw new InvalidOperationException("Hub frame exceeds the configured size limit.");
                byte[] header =
                {
                    (byte)(payload.Length >> 24),
                    (byte)(payload.Length >> 16),
                    (byte)(payload.Length >> 8),
                    (byte)payload.Length
                };
                lock (SendLock)
                {
                    activeStream.Write(header, 0, header.Length);
                    activeStream.Write(payload, 0, payload.Length);
                    activeStream.Flush();
                }
            }
            catch (Exception exception)
            {
                EnqueueMainThread(() => Debug.LogWarning("[Hub] Send failed: " + exception.Message));
                CloseSocket();
            }
        }

        public static void EnqueueMainThread(Action action)
        {
            if (action != null) MainThreadActions.Enqueue(action);
        }

        private static async Task ConnectionLoop(HelloSnapshot hello, CancellationToken token)
        {
            int delayMilliseconds = 500;
            while (!token.IsCancellationRequested)
            {
                try
                {
                    SetConnectionState(false, "Connecting to " + hello.Host + ":" + hello.Port);
                    TcpClient nextClient = new TcpClient();
                    Task connect = nextClient.ConnectAsync(hello.Host, hello.Port);
                    Task timeout = Task.Delay(5000, token);
                    if (await Task.WhenAny(connect, timeout) != connect)
                    {
                        nextClient.Close();
                        throw new TimeoutException("Connection timed out.");
                    }
                    await connect;
                    nextClient.NoDelay = true;
                    client = nextClient;
                    stream = nextClient.GetStream();
                    SetConnectionState(true, "Connected");
                    delayMilliseconds = 500;
                    SendHello(hello);
                    await ReceiveLoop(stream, token);
                }
                catch (OperationCanceledException) { }
                catch (Exception exception)
                {
                    SetConnectionState(false, "Reconnect pending: " + exception.Message);
                    EnqueueMainThread(() => Debug.LogWarning("[Hub] Connect failed: " + exception.Message));
                }
                finally
                {
                    CloseSocket();
                }

                if (token.IsCancellationRequested) break;
                try { await Task.Delay(delayMilliseconds, token); } catch (OperationCanceledException) { }
                delayMilliseconds = Math.Min(delayMilliseconds * 2, 10000);
            }
        }

        private static async Task ReceiveLoop(NetworkStream activeStream, CancellationToken token)
        {
            byte[] header = new byte[4];
            while (!token.IsCancellationRequested)
            {
                await ReadExactly(activeStream, header, 4, token);
                int length = (header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3];
                if (length <= 0 || length > HubSettings.MaxFrameBytes)
                    throw new InvalidDataException("Invalid hub frame length: " + length);
                byte[] payload = new byte[length];
                await ReadExactly(activeStream, payload, length, token);
                HubEnvelope envelope = HubJson.DeserializeEnvelope(Encoding.UTF8.GetString(payload));
                Inbound.Enqueue(envelope);
            }
        }

        private static async Task ReadExactly(Stream source, byte[] buffer, int count, CancellationToken token)
        {
            int offset = 0;
            while (offset < count)
            {
                int read = await source.ReadAsync(buffer, offset, count - offset, token);
                if (read == 0) throw new EndOfStreamException("Hub closed the TCP connection.");
                offset += read;
            }
        }

        private static void PumpMainThread()
        {
            // Self-heal: if the delayCall scheduled from the static constructor
            // was lost (observed after a forced domain reload while the editor
            // was unfocused), make sure the background connection loop starts.
            if (HubSettings.AutoConnect && connectionTask == null)
                Start();

            Action action;
            int actionBudget = 128;
            while (actionBudget-- > 0 && MainThreadActions.TryDequeue(out action))
            {
                try { action(); }
                catch (Exception exception) { Debug.LogException(exception); }
            }

            HubEnvelope envelope;
            int messageBudget = 128;
            while (messageBudget-- > 0 && Inbound.TryDequeue(out envelope))
            {
                if (envelope.Type == "error")
                    Debug.LogWarning("[Hub] Received '" + envelope.Type + ":" + envelope.Name +
                        "' payload=" + HubJson.SerializeEnvelope(envelope));
                else if (envelope.Name == "unity.hello")
                    Debug.Log("[Hub] Hello handshake acknowledged by hub.");
                Action<HubEnvelope> handler = MessageReceived;
                if (handler != null) handler(envelope);
            }
        }

        private static void SendHello(HelloSnapshot hello)
        {
            string secret = HubSettings.ResolveSessionSecretThreadSafe(hello.SettingsSecret);
            Debug.Log("[Hub] Sending hello (secretLength=" + secret.Length +
                ", source=" + HubSettings.SessionSecretSourceThreadSafe(hello.SettingsSecret) +
                ", clientId=" + hello.ClientId + ")");
            Send(HubEnvelope.Create("hello", "unity.hello", new Dictionary<string, object>
            {
                { "sessionSecret", secret },
                { "clientId", hello.ClientId },
                { "projectPath", hello.ProjectPath },
                { "projectName", hello.ProjectName },
                { "unityVersion", hello.UnityVersion },
                { "unityPid", hello.UnityPid },
                { "targetPlatform", hello.TargetPlatform }
            }));
        }

        private static void SetConnectionState(bool isConnected, string nextStatus)
        {
            connected = isConnected;
            status = nextStatus;
            EnqueueMainThread(() =>
            {
                Action handler = ConnectionChanged;
                if (handler != null) handler();
            });
        }

        private static void CloseSocket()
        {
            connected = false;
            NetworkStream oldStream = Interlocked.Exchange(ref stream, null);
            TcpClient oldClient = Interlocked.Exchange(ref client, null);
            try { if (oldStream != null) oldStream.Close(); } catch { }
            try { if (oldClient != null) oldClient.Close(); } catch { }
        }

        private sealed class HelloSnapshot
        {
            public string Host;
            public int Port;
            public string SettingsSecret;
            public string ClientId;
            public string ProjectPath;
            public string ProjectName;
            public string UnityVersion;
            public int UnityPid;
            public string TargetPlatform;
        }
    }
}
