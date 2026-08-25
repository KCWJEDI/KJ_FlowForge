import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const watch = process.argv.includes("--watch");
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "renderer"), { recursive: true });
await Promise.all([
  cp(path.join(root, "src/renderer/index.html"), path.join(dist, "renderer/index.html")),
  cp(path.join(root, "src/renderer/styles.css"), path.join(dist, "renderer/styles.css")),
  cp(path.join(root, "src/renderer/license.html"), path.join(dist, "renderer/license.html")),
]);

const targets = [
  {
    entryPoints: ["src/main/index.ts"],
    outfile: "dist/main/index.cjs",
    platform: "node",
    format: "cjs",
    external: ["electron"],
  },
  {
    entryPoints: ["src/preload/index.ts"],
    outfile: "dist/preload/index.cjs",
    platform: "node",
    format: "cjs",
    external: ["electron"],
  },
  {
    entryPoints: ["src/renderer/index.ts"],
    outfile: "dist/renderer/index.js",
    platform: "browser",
    format: "iife",
  },
  {
    entryPoints: ["src/renderer/license-entry.ts"],
    outfile: "dist/renderer/license-entry.js",
    platform: "browser",
    format: "iife",
  },
];

const options = (target) => ({
  ...target,
  absWorkingDir: root,
  bundle: true,
  sourcemap: true,
  target: target.platform === "browser" ? "chrome120" : "node20",
  logLevel: "info",
});

if (watch) {
  const contexts = await Promise.all(targets.map((target) => context(options(target))));
  await Promise.all(contexts.map((item) => item.watch()));
  console.log("Watching Electron hub sources...");
} else {
  await Promise.all(targets.map((target) => build(options(target))));
}
