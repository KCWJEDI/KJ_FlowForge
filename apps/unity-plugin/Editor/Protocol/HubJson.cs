using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace LocalWorkflow.UnityHub
{
    // Small JSON codec keeps the package dependency-free and preserves arbitrary command payloads.
    internal static class HubJson
    {
        public static string SerializeEnvelope(HubEnvelope envelope)
        {
            return Serialize(new Dictionary<string, object>
            {
                { "version", envelope.Version },
                { "type", envelope.Type },
                { "requestId", envelope.RequestId },
                { "name", envelope.Name },
                { "payload", envelope.Payload },
                { "timestamp", envelope.Timestamp }
            });
        }

        public static HubEnvelope DeserializeEnvelope(string json)
        {
            Dictionary<string, object> value = Deserialize(json) as Dictionary<string, object>;
            if (value == null)
                throw new FormatException("Hub frame root must be a JSON object.");

            int version = GetInt(value, "version", -1);
            if (version != HubEnvelope.ProtocolVersion)
                throw new FormatException("Hub frame 'version' must be a number equal to " + HubEnvelope.ProtocolVersion
                    + " (protocol version), but was '" + GetString(value, "version") + "'.");

            string type = GetString(value, "type");
            if (string.IsNullOrEmpty(type))
                throw new FormatException("Hub frame 'type' must be a non-empty string.");

            string requestId = GetString(value, "requestId");
            if (string.IsNullOrEmpty(requestId))
                throw new FormatException("Hub frame 'requestId' must be a non-empty string.");

            string name = GetString(value, "name");
            if (string.IsNullOrEmpty(name))
                throw new FormatException("Hub frame 'name' must be a non-empty string.");

            string timestamp = GetString(value, "timestamp");
            if (string.IsNullOrEmpty(timestamp))
                throw new FormatException("Hub frame 'timestamp' must be a non-empty string.");

            if (!value.ContainsKey("payload"))
                throw new FormatException("Hub frame must include a 'payload' key.");

            object payload = value["payload"] ?? new Dictionary<string, object>();

            return new HubEnvelope
            {
                Version = version,
                Type = type,
                RequestId = requestId,
                Name = name,
                Payload = payload,
                Timestamp = timestamp
            };
        }

        public static string Serialize(object value)
        {
            StringBuilder builder = new StringBuilder(256);
            WriteValue(builder, value);
            return builder.ToString();
        }

        public static object Deserialize(string json)
        {
            if (json == null)
                throw new ArgumentNullException("json");
            return new Parser(json).Parse();
        }

        public static string GetString(IDictionary<string, object> values, string key, string fallback = "")
        {
            object value;
            return values != null && values.TryGetValue(key, out value) && value != null
                ? Convert.ToString(value, CultureInfo.InvariantCulture)
                : fallback;
        }

        public static bool GetBool(IDictionary<string, object> values, string key, bool fallback = false)
        {
            object value;
            if (values == null || !values.TryGetValue(key, out value) || value == null)
                return fallback;
            if (value is bool)
                return (bool)value;
            bool result;
            return bool.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out result) ? result : fallback;
        }

        public static int GetInt(IDictionary<string, object> values, string key, int fallback = 0)
        {
            object value;
            if (values == null || !values.TryGetValue(key, out value) || value == null)
                return fallback;
            if (value is int)
                return (int)value;
            if (value is long)
                return (int)(long)value;
            int result;
            return int.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out result) ? result : fallback;
        }

        private static void WriteValue(StringBuilder builder, object value)
        {
            if (value == null)
            {
                builder.Append("null");
                return;
            }

            string text = value as string;
            if (text != null)
            {
                WriteString(builder, text);
                return;
            }

            if (value is bool)
            {
                builder.Append((bool)value ? "true" : "false");
                return;
            }

            IDictionary dictionary = value as IDictionary;
            if (dictionary != null)
            {
                builder.Append('{');
                bool first = true;
                foreach (DictionaryEntry entry in dictionary)
                {
                    if (!first) builder.Append(',');
                    first = false;
                    WriteString(builder, Convert.ToString(entry.Key, CultureInfo.InvariantCulture));
                    builder.Append(':');
                    WriteValue(builder, entry.Value);
                }
                builder.Append('}');
                return;
            }

            IEnumerable enumerable = value as IEnumerable;
            if (enumerable != null)
            {
                builder.Append('[');
                bool first = true;
                foreach (object item in enumerable)
                {
                    if (!first) builder.Append(',');
                    first = false;
                    WriteValue(builder, item);
                }
                builder.Append(']');
                return;
            }

            if (value is float || value is double || value is decimal)
            {
                builder.Append(Convert.ToDouble(value, CultureInfo.InvariantCulture).ToString("R", CultureInfo.InvariantCulture));
                return;
            }

            if (value is byte || value is sbyte || value is short || value is ushort ||
                value is int || value is uint || value is long || value is ulong)
            {
                builder.Append(Convert.ToString(value, CultureInfo.InvariantCulture));
                return;
            }

            WriteString(builder, Convert.ToString(value, CultureInfo.InvariantCulture));
        }

        private static void WriteString(StringBuilder builder, string value)
        {
            builder.Append('"');
            for (int i = 0; i < value.Length; i++)
            {
                char character = value[i];
                switch (character)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\b': builder.Append("\\b"); break;
                    case '\f': builder.Append("\\f"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (character < 32)
                            builder.Append("\\u").Append(((int)character).ToString("x4"));
                        else
                            builder.Append(character);
                        break;
                }
            }
            builder.Append('"');
        }

        private sealed class Parser
        {
            private readonly StringReader reader;

            public Parser(string json) { reader = new StringReader(json); }

            public object Parse()
            {
                object value = ParseValue();
                SkipWhitespace();
                if (reader.Peek() != -1)
                    throw new FormatException("Unexpected trailing JSON content.");
                return value;
            }

            private object ParseValue()
            {
                SkipWhitespace();
                int next = reader.Peek();
                switch (next)
                {
                    case '{': return ParseObject();
                    case '[': return ParseArray();
                    case '"': return ParseString();
                    case 't': ReadLiteral("true"); return true;
                    case 'f': ReadLiteral("false"); return false;
                    case 'n': ReadLiteral("null"); return null;
                    case -1: throw new EndOfStreamException("Unexpected end of JSON.");
                    default: return ParseNumber();
                }
            }

            private Dictionary<string, object> ParseObject()
            {
                Dictionary<string, object> result = new Dictionary<string, object>();
                reader.Read();
                SkipWhitespace();
                if (reader.Peek() == '}') { reader.Read(); return result; }
                while (true)
                {
                    SkipWhitespace();
                    string key = ParseString();
                    SkipWhitespace();
                    Expect(':');
                    result[key] = ParseValue();
                    SkipWhitespace();
                    int separator = reader.Read();
                    if (separator == '}') return result;
                    if (separator != ',') throw new FormatException("Expected ',' or '}' in JSON object.");
                }
            }

            private List<object> ParseArray()
            {
                List<object> result = new List<object>();
                reader.Read();
                SkipWhitespace();
                if (reader.Peek() == ']') { reader.Read(); return result; }
                while (true)
                {
                    result.Add(ParseValue());
                    SkipWhitespace();
                    int separator = reader.Read();
                    if (separator == ']') return result;
                    if (separator != ',') throw new FormatException("Expected ',' or ']' in JSON array.");
                }
            }

            private string ParseString()
            {
                Expect('"');
                StringBuilder builder = new StringBuilder();
                while (true)
                {
                    int raw = reader.Read();
                    if (raw == -1) throw new EndOfStreamException("Unterminated JSON string.");
                    char character = (char)raw;
                    if (character == '"') return builder.ToString();
                    if (character != '\\') { builder.Append(character); continue; }
                    int escaped = reader.Read();
                    if (escaped == -1) throw new EndOfStreamException("Unterminated JSON escape.");
                    switch ((char)escaped)
                    {
                        case '"': builder.Append('"'); break;
                        case '\\': builder.Append('\\'); break;
                        case '/': builder.Append('/'); break;
                        case 'b': builder.Append('\b'); break;
                        case 'f': builder.Append('\f'); break;
                        case 'n': builder.Append('\n'); break;
                        case 'r': builder.Append('\r'); break;
                        case 't': builder.Append('\t'); break;
                        case 'u': builder.Append((char)Convert.ToInt32(ReadCharacters(4), 16)); break;
                        default: throw new FormatException("Invalid JSON escape sequence.");
                    }
                }
            }

            private object ParseNumber()
            {
                StringBuilder builder = new StringBuilder();
                while (true)
                {
                    int next = reader.Peek();
                    if (next == -1 || "-+0123456789.eE".IndexOf((char)next) < 0) break;
                    builder.Append((char)reader.Read());
                }
                string value = builder.ToString();
                long integer;
                if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out integer)) return integer;
                double number;
                if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out number)) return number;
                throw new FormatException("Invalid JSON number: " + value);
            }

            private void ReadLiteral(string expected)
            {
                if (ReadCharacters(expected.Length) != expected)
                    throw new FormatException("Invalid JSON literal.");
            }

            private string ReadCharacters(int count)
            {
                char[] buffer = new char[count];
                if (reader.Read(buffer, 0, count) != count)
                    throw new EndOfStreamException("Unexpected end of JSON.");
                return new string(buffer);
            }

            private void Expect(char expected)
            {
                if (reader.Read() != expected)
                    throw new FormatException("Expected '" + expected + "'.");
            }

            private void SkipWhitespace()
            {
                while (reader.Peek() != -1 && char.IsWhiteSpace((char)reader.Peek())) reader.Read();
            }
        }
    }
}
