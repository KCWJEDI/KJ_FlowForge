import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// KJ FlowForge 릴리스 스크립트입니다.
//
//   1) (기본) 패치 버전을 올리고
//   2) 코드 서명이 설정돼 있으면 서명한 뒤
//   3) NSIS 설치본과 latest.yml을 만들어
//   4) 공개 업데이트 저장소(KCWJEDI/KJ_FlowForge_Releases)에 릴리스로 업로드합니다.
//
// 이렇게 업로드된 latest.yml의 version 값을 실행 중인 앱이 읽어 새 버전을 감지합니다.
//
// 준비물:
//   - GH_TOKEN(또는 GITHUB_TOKEN): KJ_FlowForge_Releases에 릴리스/자산을 올릴 repo 권한 토큰
//   - (선택) 코드 서명 인증서: WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD (또는 config/signing.json)
//
// 플래그:
//   --no-bump       버전을 올리지 않고 현재 버전으로 릴리스
//   --no-publish    빌드만 하고 업로드하지 않음(latest.yml/설치본만 생성)
//   --dir           압축 없이 release/win-unpacked만 생성(빠른 확인용)

const root = process.cwd();
const pkgPath = path.join(root, "package.json");
const args = new Set(process.argv.slice(2));
const shouldBump = !args.has("--no-bump");
const shouldPublish = !args.has("--no-publish");
const isDir = args.has("--dir");

const log = (message) => process.stdout.write(`${message}\n`);

function run(command, commandArgs, options = {}) {
  execFileSync(command, commandArgs, { stdio: "inherit", cwd: root, ...options });
}

function bumpPatchVersion() {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const parts = String(pkg.version).split(".");
  const lastIndex = parts.length - 1;
  parts[lastIndex] = String(Number(parts[lastIndex]) + 1);
  pkg.version = parts.join(".");
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return pkg.version;
}

/** config/signing.json(로컬, gitignore)에서도 서명 설정을 읽을 수 있게 합니다. */
function applySigningConfig() {
  if (process.env.WIN_CSC_LINK || process.env.CSC_LINK) {
    log("코드 서명: 환경변수(WIN_CSC_LINK)로 서명합니다.");
    return;
  }
  const configPath = path.join(root, "config", "signing.json");
  if (!existsSync(configPath)) {
    log("코드 서명: 인증서가 없어 서명을 건너뜁니다(빌드는 계속 진행).");
    return;
  }
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (config.certificateFile) process.env.WIN_CSC_LINK = config.certificateFile;
    if (config.certificatePassword) process.env.WIN_CSC_KEY_PASSWORD = config.certificatePassword;
    log("코드 서명: config/signing.json 으로 서명합니다.");
  } catch (error) {
    log("코드 서명 설정을 읽지 못했습니다: " + (error instanceof Error ? error.message : String(error)));
  }
}

function resolveGitHubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return "";
}

function main() {
  applySigningConfig();

  if (shouldBump) {
    const version = bumpPatchVersion();
    log(`버전 업: ${version}`);
  }

  log("빌드 중...");
  run("node", ["scripts/build.mjs"]);

  log("패키징 중... (NSIS 설치본 + latest.yml)");
  const builderArgs = ["node_modules/electron-builder/cli.js", "--win", isDir ? "dir" : "nsis"];
  if (shouldPublish && !isDir) {
    const token = resolveGitHubToken();
    if (!token) {
      log("GH_TOKEN/GITHUB_TOKEN 이 없어 업로드는 건너뜁니다(latest.yml/설치본만 생성).");
    } else {
      process.env.GH_TOKEN = token;
      builderArgs.push("--publish", "always");
    }
  }
  run("node", builderArgs);

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  log(`완료: release/KJ-FlowForge-Setup-${pkg.version}-x64.exe`);
  if (shouldPublish) {
    log("업로드된 latest.yml 을 실행 중인 앱이 읽어 새 버전을 감지합니다.");
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

