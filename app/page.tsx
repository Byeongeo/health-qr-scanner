"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type Status = "idle" | "armed" | "processing" | "result";
type ClientConfig = { triggerKey: string; cameraTimeoutSec: number; displaySec: number };
type Result =
  | { ok: true; studentName: string; added: number; total: number; line1: string; line2: string }
  | { ok: false; message: string };

const DEFAULT_CFG: ClientConfig = { triggerKey: "Space", cameraTimeoutSec: 8, displaySec: 4 };

export default function Station() {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [count, setCount] = useState(0);
  const [warn, setWarn] = useState("");

  const cfgRef = useRef<ClientConfig>(DEFAULT_CFG);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const armingRef = useRef(false); // 카메라 여는 도중(getUserMedia 대기) 중복 arm 방지

  // 최신 status 를 콜백/루프에서 참조
  const statusRef = useRef<Status>("idle");
  statusRef.current = status;

  // 설정 로드 (시트 연결 테스트 겸용)
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          cfgRef.current = {
            triggerKey: d.triggerKey ?? "Space",
            cameraTimeoutSec: Number(d.cameraTimeoutSec) || 8,
            displaySec: Number(d.displaySec) || 4,
          };
        } else {
          setWarn("설정을 불러오지 못했습니다. 시트 연결을 확인하세요.");
        }
      })
      .catch(() => setWarn("서버에 연결하지 못했습니다."));
  }, []);

  // ── 오디오 ──
  const ensureAudio = useCallback(() => {
    try {
      if (!acRef.current) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        acRef.current = new AC();
      }
      if (acRef.current.state === "suspended") void acRef.current.resume();
    } catch {
      /* noop */
    }
  }, []);

  const beep = useCallback(() => {
    try {
      const ac = acRef.current;
      if (!ac) return;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.connect(g);
      g.connect(ac.destination);
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.5, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25);
      o.start();
      o.stop(ac.currentTime + 0.25);
    } catch {
      /* noop */
    }
  }, []);

  const speak = useCallback((lines: string[]) => {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      for (const t of lines) {
        if (!t) continue;
        const u = new SpeechSynthesisUtterance(t);
        u.lang = "ko-KR";
        u.rate = 0.95;
        u.pitch = 1.05;
        window.speechSynthesis.speak(u);
      }
    } catch {
      /* noop */
    }
  }, []);

  // ── 카메라/타이머 정리 ──
  const stopCamera = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    if (armIntervalRef.current) {
      clearInterval(armIntervalRef.current);
      armIntervalRef.current = null;
    }
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const finishToIdle = useCallback(() => {
    if (resultTimerRef.current) {
      clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
    setResult(null);
    setStatus("idle");
  }, []);

  const showResult = useCallback(
    (r: Result) => {
      setResult(r);
      setStatus("result");
      speak(r.ok ? [r.line1, r.line2] : [r.message]);
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
      resultTimerRef.current = setTimeout(finishToIdle, Math.max(2500, cfgRef.current.displaySec * 1000));
    },
    [speak, finishToIdle]
  );

  const handleScan = useCallback(
    async (data: string) => {
      stopCamera();
      setStatus("processing");
      beep();
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: data.trim() }),
        });
        const r = await res.json();
        if (r?.ok) {
          showResult({ ok: true, studentName: r.studentName, added: r.added, total: r.total, line1: r.line1, line2: r.line2 });
        } else {
          showResult({ ok: false, message: r?.message || "처리 중 오류가 발생했습니다." });
        }
      } catch {
        showResult({ ok: false, message: "서버에 연결하지 못했습니다." });
      }
    },
    [stopCamera, beep, showResult]
  );

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx && video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (code && code.data && statusRef.current === "armed") {
          void handleScan(code.data);
          return; // handleScan 이 카메라/루프 정리
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [handleScan]);

  const arm = useCallback(async () => {
    if (statusRef.current !== "idle" || armingRef.current) return;
    armingRef.current = true;
    setWarn("");
    ensureAudio(); // 사용자 동작 시점에 오디오 권한 확보
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      armingRef.current = false;
      setStatus("armed");
      const secs = cfgRef.current.cameraTimeoutSec;
      setCount(secs);
      rafRef.current = requestAnimationFrame(tick);

      let remain = secs;
      armIntervalRef.current = setInterval(() => {
        remain -= 1;
        setCount(remain);
      }, 1000);
      armTimerRef.current = setTimeout(() => {
        if (statusRef.current === "armed") {
          stopCamera();
          setStatus("idle");
        }
      }, secs * 1000);
    } catch {
      armingRef.current = false;
      setWarn("카메라를 열 수 없습니다. 브라우저 카메라 권한을 허용해 주세요.");
      stopCamera();
      setStatus("idle");
    }
  }, [ensureAudio, tick, stopCamera]);

  // 결과 화면에서 밟으면 결과를 닫고 바로 다음 카메라 켜기 (한 번 밟기 = 다음 스캔)
  const skipResultAndArm = useCallback(() => {
    if (resultTimerRef.current) {
      clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
    try {
      window.speechSynthesis?.cancel(); // 이전 학생 음성은 여기서 끊고 새 스캔으로
    } catch {
      /* noop */
    }
    setResult(null);
    statusRef.current = "idle"; // arm() 의 idle 가드를 즉시 통과시키기 위해 ref 먼저 갱신
    setStatus("idle");
    void arm();
  }, [arm]);

  // 트리거: 키(설정값) — 아무 클릭은 onStageClick 에서 처리
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return; // 페달을 꾹 밟아 키가 자동 반복돼도 1회만 인식
      const st = statusRef.current;
      if (st !== "idle" && st !== "result") return;
      const want = (cfgRef.current.triggerKey ?? "").trim().toLowerCase();
      const code = e.code.toLowerCase();
      // e.code(물리 키)는 한/영 IME 상태와 무관 — 한글 상태에서 b가 'ㅠ'/'Process'로 와도 KeyB로 매칭됨
      const matched =
        !want ||
        code === want || // "space", "enter", "f13", "keyb" 처럼 코드명 그대로 적은 경우
        code === "key" + want || // 영문 한 글자(b → KeyB)
        code === "digit" + want || // 숫자 한 글자(1 → Digit1)
        e.key.toLowerCase() === want; // 그 외 문자 일치(폴백)
      if (matched) {
        e.preventDefault();
        if (st === "result") skipResultAndArm();
        else void arm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [arm, skipResultAndArm]);

  // 언마운트 정리
  useEffect(() => {
    return () => {
      stopCamera();
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    };
  }, [stopCamera]);

  const onStageClick = () => {
    if (statusRef.current === "idle") void arm();
    else if (statusRef.current === "result") skipResultAndArm(); // 밟으면 바로 다음 카메라
  };

  return (
    <main className="station" onClick={onStageClick}>
      <span className="badge">QR 점수 스캐너</span>
      {warn && <div className="err-banner">{warn}</div>}

      {status === "idle" && (
        <div>
          <div className="idle-emoji">👟</div>
          <div className="idle-title">발판을 밟으세요</div>
          <div className="idle-sub">화면을 눌러도 카메라가 켜집니다</div>
        </div>
      )}

      {/* 카메라는 항상 DOM 에 두고 표시만 토글 (ref 안정) */}
      <div className={"cam-wrap" + (status === "armed" ? "" : " hidden")}>
        <video ref={videoRef} playsInline muted />
        <div className="scan-line" />
      </div>
      {status === "armed" && (
        <>
          <div className="armed-msg">QR 코드를 카메라에 대세요</div>
          <div className="armed-count">{count}초 후 자동으로 꺼집니다</div>
        </>
      )}

      {status === "processing" && <div className="idle-title">저장 중…</div>}

      {status === "result" && result && (
        <div className={"result popIn " + (result.ok ? "success" : "error")}>
          {result.ok ? (
            <>
              <div className="r-name">{result.studentName} 학생</div>
              <div className="r-score">
                +{result.added}점 · 총 {result.total}점
              </div>
              {result.line2 && <div className="r-line2">{result.line2}</div>}
            </>
          ) : (
            <div className="r-error">{result.message}</div>
          )}
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </main>
  );
}
