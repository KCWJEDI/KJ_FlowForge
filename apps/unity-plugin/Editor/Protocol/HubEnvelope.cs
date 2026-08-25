using System;
using System.Collections.Generic;

namespace LocalWorkflow.UnityHub
{
    internal sealed class HubEnvelope
    {
        public const int ProtocolVersion = 1;

        public int Version { get; set; }
        public string Type { get; set; }
        public string RequestId { get; set; }
        public string Name { get; set; }
        public object Payload { get; set; }
        public string Timestamp { get; set; }

        public static HubEnvelope Create(string type, string name, object payload = null, string requestId = null)
        {
            return new HubEnvelope
            {
                Version = ProtocolVersion,
                Type = type,
                RequestId = requestId ?? Guid.NewGuid().ToString("D"),
                Name = name,
                Payload = payload ?? new Dictionary<string, object>(),
                Timestamp = HubTime.NowUtcIso()
            };
        }

        public Dictionary<string, object> PayloadObject
        {
            get { return Payload as Dictionary<string, object> ?? new Dictionary<string, object>(); }
        }
    }

    // Matches JavaScript's Date.toISOString() so hub-side timestamps line up.
    internal static class HubTime
    {
        public static string NowUtcIso()
        {
            return DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
        }
    }
}
