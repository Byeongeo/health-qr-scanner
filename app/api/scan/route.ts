import { NextRequest, NextResponse } from "next/server";
import { callScan } from "@/lib/backend";
import type { ScanResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 브라우저 → (여기, 서버) → Apps Script 웹앱 으로 중계 (CORS 회피 + 비밀키 은닉)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.studentId ?? "").trim();
    if (!id) {
      const r: ScanResult = { ok: false, reason: "error", message: "학번이 비어 있습니다." };
      return NextResponse.json(r, { status: 400 });
    }
    const data = await callScan(id);
    return NextResponse.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "서버 오류";
    const r: ScanResult = { ok: false, reason: "error", message };
    return NextResponse.json(r, { status: 500 });
  }
}
