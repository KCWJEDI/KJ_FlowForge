const message = document.getElementById("license-message");
const keyInput = document.getElementById("license-key") as HTMLInputElement | null;
const submit = document.getElementById("license-submit") as HTMLButtonElement | null;
const cancel = document.getElementById("license-cancel") as HTMLButtonElement | null;
const error = document.getElementById("license-error");

if (message) message.textContent = decodeURIComponent(location.hash.slice(1)) || "유효한 키를 입력해 주세요.";

submit?.addEventListener("click", () => {
  void activate();
});

keyInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void activate();
});

cancel?.addEventListener("click", () => {
  window.close();
});

async function activate(): Promise<void> {
  const key = keyInput?.value.trim() ?? "";
  if (!error) return;
  if (!key) {
    error.textContent = "키를 입력해 주세요.";
    return;
  }
  submit!.disabled = true;
  error.textContent = "라이선스 확인 중…";
  try {
    const status = await window.hub.activateLicense(key);
    if (status.activated) {
      error.textContent = "인증 완료. 프로그램을 시작합니다…";
      setTimeout(() => window.close(), 800);
      return;
    }
    if (status.reason === "grace-offline") {
      error.textContent = "인터넷에 연결되어 있지 않습니다. 네트워크 연결 후 다시 시도해 주세요.";
    } else if (status.reason === "blocked") {
      error.textContent = "라이선스 목록에 접근할 수 없습니다. GITHUB_TOKEN 등록과 저장소 권한을 확인해 주세요.";
    } else {
      error.textContent = "유효하지 않은 키입니다. 다시 입력해 주세요.";
    }
  } catch (err) {
    error.textContent = `확인 실패: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    submit!.disabled = false;
  }
}
