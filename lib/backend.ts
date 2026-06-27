import "server-only";

// Apps Script 웹앱을 서버 측에서 호출 (브라우저가 직접 부르면 CORS 문제 → 여기서 중계)
function appsScriptUrl(): string {
  const u = process.env.APPS_SCRIPT_URL;
  if (!u) throw new Error("APPS_SCRIPT_URL 환경변수가 설정되지 않았습니다.");
  return u;
}

function secret(): string {
  return process.env.APP_SHARED_SECRET || "";
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: false,
      reason: "error",
      message:
        "Apps Script 응답을 해석할 수 없습니다. 웹앱 배포의 액세스 권한이 '모든 사용자'인지, URL이 /exec 로 끝나는지 확인하세요.",
    };
  }
}

/** 스캔 처리 (학번 전송) */
export async function callScan(studentId: string): Promise<unknown> {
  const res = await fetch(appsScriptUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: secret(), studentId }),
    redirect: "follow",
    cache: "no-store",
  });
  return safeJson(res);
}

/** 클라이언트 설정 조회 + 연결 테스트 */
export async function callConfig(): Promise<unknown> {
  const url = new URL(appsScriptUrl());
  url.searchParams.set("action", "config");
  if (secret()) url.searchParams.set("secret", secret());
  const res = await fetch(url.toString(), { redirect: "follow", cache: "no-store" });
  return safeJson(res);
}
