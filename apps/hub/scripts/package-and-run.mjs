import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// KJ FlowForge를 패키징하고 바로 실행하는 스크립트입니다.
//   1) 실행 중인 인스턴스(포터블 exe / 추출된 앱)를 종료하고
//   2) package.json 버전을 패치 버전업한 뒤
//   3) 새 버전 이름으로 포터블 exe를 만들고
//   4) 그 exe를 실행합니다.
//
// 플래그:
//   --no-bump : 버전을 올리지 않고 현재 버전으로 빌드
//   --no-run  : 빌드만 하고 실행하지 않음

const root = process.cwd();
const pkgPath = path.join(root, "package.json");
const args = new Set(process.argv.slice(2));
const shouldBump = !args.has("--no-bump");
const shouldRun = !args.has("--no-run");

const log = (message) => process.stdout.write(`${message}\n`);

// 이 프로그램의 실행 파일 이름만 정확히 골라냅니다.
// (KJ_FlowForge_CreateKey.exe 같은 다른 도구는 건드리지 않습니다.)
const processFilter = "$_.ProcessName -eq 'KJ FlowForge' -or $_.ProcessName -match '^KJ-FlowForge-'";

function powershell(command, { inherit = false } = {}) {
  return execFileSync("powershell", ["-NoProfile", "-Command", command], {
    stdio: inherit ? "inherit" : "pipe",
    cwd: root,
  });
}

/** 실행 중인 인스턴스를 모두 종료합니다. 파일 잠금이 풀릴 때까지 재시도합니다. */
function closeRunningInstances() {
  log("실행 중인 KJ FlowForge 확인...");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const listing = powershell(
      `$p = Get-Process -ErrorAction SilentlyContinue | Where-Object { ${processFilter} }; ` +
        `if ($p) { $p | ForEach-Object { Write-Output ("  종료: " + $_.ProcessName + " (PID " + $_.Id + ")") } }`,
    )
      .toString()
      .trim();
    if (!listing) {
      log("  실행 중인 인스턴스 없음");
      return;
    }
    process.stdout.write(`${listing}\n`);
    powershell(
      `Get-Process -ErrorAction SilentlyContinue | Where-Object { ${processFilter} } | Stop-Process -Force -ErrorAction SilentlyContinue`,
    );
    powershell("Start-Sleep -Milliseconds 700");
  }
  throw new Error("실행 중인 KJ FlowForge를 종료하지 못했습니다. 수동으로 닫은 뒤 다시 시도하세요.");
}

/** package.json의 패치 버전을 1 올립니다. */
function bumpPatchVersion() {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const parts = String(pkg.version).split(".");
  const lastIndex = parts.length - 1;
  parts[lastIndex] = String(Number(parts[lastIndex]) + 1);
  pkg.version = parts.join(".");
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return pkg.version;
}

function main() {
  closeRunningInstances();

  const version = shouldBump ? bumpPatchVersion() : JSON.parse(readFileSync(pkgPath, "utf8")).version;
  if (shouldBump) log(`버전 업: ${version}`);

  log("빌드 중...");
  execFileSync("node", ["scripts/build.mjs"], { stdio: "inherit", cwd: root });

  log("패키징 중... (시간이 걸릴 수 있습니다)");
  execFileSync("node", ["node_modules/electron-builder/cli.js", "--win", "portable"], {
    stdio: "inherit",
    cwd: root,
  });

  const executable = path.join(root, "release", `KJ-FlowForge-${version}-x64.exe`);
  if (!existsSync(executable)) throw new Error(`빌드 결과물을 찾을 수 없습니다: ${executable}`);
  log(`빌드 완료: ${executable}`);

  if (!shouldRun) return;

  log("프로그램 실행...");
  spawn("powershell", ["-NoProfile", "-Command", `Start-Process -FilePath "${executable}"`], {
    detached: true,
    stdio: "ignore",
    cwd: root,
  }).unref();
  log("실행했습니다.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

