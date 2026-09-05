import type { GitCommitSummary } from "../git/git-service";

export interface GeminiAdapterConfig {
  apiKey?: string;
  model: string;
}

export interface GeminiSummaryInput {
  repositoryLabel: string;
  project?: string;
  branch: string;
  author: string;
  commits: Array<Pick<GitCommitSummary, "subject">>;
  categorySummary?: string;
  fileCount?: number;
}

export class GeminiAdapter {
  public constructor(private config: GeminiAdapterConfig) {}

  public get enabled(): boolean {
    return Boolean(this.config.apiKey);
  }

  public configure(config: GeminiAdapterConfig): void {
    this.config = config;
  }

  private endpoint(): string {
    const model = this.config.model || "gemini-3.5-flash-lite";
    return "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
  }

  public async summarizeOverview(input: GeminiSummaryInput): Promise<string | null> {
    if (!this.config.apiKey) return null;
    const prompt = this.buildPrompt(input);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(this.endpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.config.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        const txt = await response.text();
        throw new Error("Gemini API error " + response.status + ": " + txt.slice(0, 300));
      }
      const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const textVal = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      return textVal && textVal.length > 0 ? textVal : null;
    } catch {
      return null;
    }
  }

  private buildPrompt(input: GeminiSummaryInput): string {
    const head = (input.repositoryLabel && input.branch) ? input.repositoryLabel + " " + input.branch : (input.repositoryLabel || input.branch || "");
    const headLine = [input.project, head, input.author ? "담당: " + input.author : ""].filter(Boolean).join(" | ");
    const subjects = input.commits.length > 0
      ? input.commits.map((commit) => "- " + commit.subject).join("\n")
      : "- (커밋 없음)";
    const extraLines: string[] = [];
    if (input.categorySummary) extraLines.push("분류: " + input.categorySummary);
    if (input.fileCount != null) extraLines.push("변경 파일: " + input.fileCount);
    const extra = extraLines.join("\n");
    const parts: string[] = [];
    parts.push("아래는 오늘 이루어진 개발 작업(Git 커밋) 목록입니다.");
    parts.push("이 작업들이 전체적으로 어떤 내용에 중점을 두었는지, 대표 변경 내용을 한국어로 요약해 주세요.");
    parts.push("조건:");
    parts.push("- 8줄 이내로 출력하세요.");
    parts.push("- 내용이 바뀌는 문단이나 다른 주제의 문장이 시작되는 부분마다 1. 2. 3. 처럼 번호를 매겨 구분을 확실하게 하세요.");
    parts.push("- 각 항목의 문장은 말투를 ~했음, ~함, ~보강함 처럼 짧게 끝내는 음슴체를 사용하세요.");
    parts.push("- 구체적인 커밋 제목이나 파일명을 나열하지 말고 전체 작업의 성격과 주요 변경 방향을 중심으로 요약하세요.");
    parts.push("- 예:");
    parts.push("1. 전반적인 게임 흐름 개선에 집중했음.");
    parts.push("2. 배틀 결과 UI와 일시정지 기능을 보강했음.");
    parts.push("3. 로컬라이제이션과 각종 워크트리 정리를 함께 진행했음.");
    parts.push("작업 정보: " + headLine);
    if (extra) parts.push("추가 정보:\n" + extra);
    parts.push("커밋 목록:");
    parts.push(subjects);
    return parts.filter(Boolean).join("\n");
  }
}
