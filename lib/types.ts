// API 응답 모델 (Apps Script 가 같은 형태로 JSON 반환, Vercel 은 그대로 중계)

export type ScanResult =
  | {
      ok: true;
      studentId: string;
      studentName: string;
      added: number;
      total: number;
      line1: string; // "홍길동 학생, 10점이 가산되어 총 50점입니다"
      line2: string; // 상시/달성 멘트 (없으면 "")
    }
  | {
      ok: false;
      reason: "unregistered" | "cooldown" | "error";
      message: string;
    };
