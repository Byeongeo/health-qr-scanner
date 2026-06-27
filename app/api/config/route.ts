import { NextResponse } from "next/server";
import { callConfig } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 클라이언트 설정 + 연결 테스트 (Apps Script 로 중계)
export async function GET() {
  try {
    const data = await callConfig();
    return NextResponse.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "연결 실패";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
