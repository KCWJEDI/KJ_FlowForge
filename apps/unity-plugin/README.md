# Local Workflow Hub — Unity Plugin

Editor-only Unity package that bridges a Unity Editor to the Local Workflow Hub
over loopback TCP. Implements the `★★` and `★★★` collection/command scope from
`Unity_수집항목_리스트.txt`; `★` items are excluded. Works with **Unity 2021.3**
and newer.

## Installation

Install the package into your project's `Packages/` folder.

**Option A — UPM git URL:**

```json
{
  "dependencies": {
    "com.localworkflow.unity-hub": "file:path/to/repo/apps/unity-plugin"
  }
}
```

**Option B — manual copy:** copy the contents of `apps/unity-plugin` into
`<Project>/Packages/com.localworkflow.unity-hub/`.

The hub must already be running and listening on `127.0.0.1:43101` (the
per-run session secret is written by the hub to `<userData>/runtime/unity-session.json`
and matched on handshake).

## Settings Window

`Menu: Local Workflow Hub > Settings` opens an `EditorWindow` that edits:

| Setting | Default | Meaning |
| ------- | ------- | ------- |
| Host | `127.0.0.1` | Hub TCP host |
| Port | `43101` | Hub TCP port |
| Session Secret | *(auto-resolved)* | Used in the `unity.hello` handshake |
| Auto Connect | `true` | Connect on domain reload |

It also shows the live `HubTcpClient.Status` text and Start / Stop / Restart
buttons.

The session secret resolves in this order: `HUB_UNITY_SESSION_SECRET`
environment variable first, then the hub's per-run session file at
`<userData>/runtime/unity-session.json` (userData defaults to
`%APPDATA%/local-unity-workflow-hub`, override with `HUB_USER_DATA_DIR`), then
the value set in the Settings window. Settings are stored in `EditorPrefs`
under your project on this machine.

## TCP Framing

- Transport: TCP, loopback only.
- Each frame is a **4-byte big-endian length prefix** followed by a UTF-8 JSON
  body.
- Body is a `MessageEnvelope` (`version`, `type`, `requestId`, `name`,
  `payload`, `timestamp`).
- `type` is one of `hello`, `event`, `command`, `response`, `error`.
- Max frame size: 8 MiB (`HubSettings.MaxFrameBytes`).

## Commands (Hub → Unity)

`type: "command"`, handled on the editor main thread and answered with a
`response` carrying the originating `requestId`:

| Name | Payload |
| ---- | ------- |
| `scene.load` | `{ path: string, additive?: boolean }` |
| `scene.save` | `{ path?: string, saveAs?: boolean }` |
| `play.enter` | `{}` |
| `play.exit` | `{}` |
| `build.run` | `{ target: string, outputPath: string, scenes?: string[], development?: boolean }` |
| `assets.refresh` | `{ forceSynchronous?: boolean }` |
| `scripts.recompile` | `{}` |
| `status.snapshot` | `{}` — returns `status.snapshot` response |

## Event Categories (Unity → Hub)

`type: "event"`, pushed by the plugin:

| Category | Events |
| -------- | ------ |
| Connection | `project.connected`, `unity.hello` handshake |
| Editor state | `editor.state.changed` |
| Scenes | `scene.active.changed`, `scene.list.changed`, `scene.loaded`, `scene.unloaded` |
| Play mode | `play.mode.changed` |
| Build | `build.started`, `build.progress`, `build.completed` |
| Assets | `assets.import.started`, `assets.import.completed`, `assets.changed`, `assets.added` |
| Compilation | `compilation.started`, `compilation.completed`, `compilation.errors` |
| Git | `git.status` (observed via git CLI from the project) |
| Work metadata | `work.active-file.changed`, `work.saved`, `work.unsaved.changed` |
| Runtime | `runtime.metrics` (play mode FPS / frame time / memory) |

Exact payload shapes for asset and work events:

```ts
"assets.import.started":  { paths: string[] }
"assets.import.completed":{ imported: string[]; deleted: string[]; moved: Array<{ from: string; to: string }> }
"assets.changed":         { paths: string[] }
"assets.added":           { paths: string[] }

"work.active-file.changed":{ path: string | null }
"work.saved":              { path: string; savedAt: string }
"work.unsaved.changed":    { hasUnsavedChanges: boolean; dirtyScenes: string[] }
```

> The plugin only emits these protocol events and their documented fields; it
> does not send unknown fields.

## Scope (★★ / ★★★)

Implements the `★★★` and `★★` items from `Unity_수집항목_리스트.txt`:

- **★★★** — project identity, Unity version, editor state, current scene, build
  start/progress/completion + log, play mode enter/exit, console logs, asset
  import + change lists, compilation start/complete + errors, changed files /
  branch (git), scene load/save commands.
- **★★** — open scene list, platform tag, build metadata, asset-added events,
  warning logs, last-save time / unsaved-changes, runtime metrics, git
  conflict/branch status.
- **★** excluded (hierarchy changes, dependency graphs, profiler samples,
  per-frame GC allocations, focus detection, etc.).

## Layout

```text
Editor/
  Configuration/  HubSettings, HubSettingsWindow
  Networking/     HubTcpClient (async loop, framing, reconnect)
  Protocol/       HubEnvelope, HubJson (dependency-free JSON codec)
  Commands/       HubCommandRouter, scene/play/build/asset handlers
  Collection/     HubCollector, HubSnapshot, HubWorkMetadata,
                  HubAssetPostprocessor, HubGitObserver
```
