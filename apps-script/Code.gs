/**
 * QR 점수 스캐너 — Apps Script 백엔드 (구글시트에 붙여넣는 코드)
 * ─────────────────────────────────────────────────────────────
 * 설치 방법
 *  1) 점수 시트에서 [확장 프로그램] → [Apps Script] 열기
 *  2) 이 파일 내용 전체를 Code.gs 에 붙여넣고 저장
 *  3) 함수 목록에서 setup 선택 후 ▶실행  (권한 승인 → 탭 5개 자동 생성)
 *  4) [배포] → [새 배포] → 유형 "웹 앱"
 *       - 실행: 나(소유자) / 액세스 권한: 모든 사용자  → 배포 → 웹앱 URL 복사
 *  5) Vercel 환경변수에 APPS_SCRIPT_URL = 복사한 URL
 *  6) (선택·권장) 보안: setSecret 의 값을 바꿔 1회 실행 → 같은 값을 Vercel APP_SHARED_SECRET 에
 *
 *  ※ 시트를 새로고침하면 상단 [QR 점수 스캐너] 메뉴에서도 초기 설정을 실행할 수 있습니다.
 */

var TABS = {
  students: "student list",
  record: "Tag Record",
  scores: "Scores",
  messages: "messages",
  config: "config",
};

var DEFAULTS = {
  pointsPerScan: 10,
  cooldownSec: 0,
  cameraTimeoutSec: 8,
  triggerKey: "Space",
  firstLine: "{이름} 학생, {추가}점이 가산되어 총 {총점}점입니다",
  unregistered: "거부",
  displaySec: 4,
};

// ─────────────── 초기 설정 ───────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("QR 점수 스캐너")
    .addItem("① 초기 설정(탭 생성)", "setup")
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureTab_(ss, TABS.students, ["학번", "이름", "QR(자동)"], [
    ["10101", "홍길동"],
    ["10102", "김보건"],
  ]);
  fillQrColumn_(ss.getSheetByName(TABS.students)); // 학번 입력하면 C열에 QR 자동 표시
  ensureTab_(ss, TABS.record, ["시각", "학번", "이름", "가점", "총점"], []);
  ensureTab_(ss, TABS.scores, ["학번", "이름", "총점", "최근스캔", "_ts(자동·수정금지)"], []);
  ensureTab_(ss, TABS.messages, ["임계점수", "멘트", "1회만"], [
    [0, "{이름} 학생 힘내세요", "N"],
    [50, "{이름} 학생 잘했어요", "N"],
    [100, "선생님에게 선물을 받아가세요", "Y"],
    [150, "하트스티커 3개를 받아가세요", "Y"],
  ]);
  ensureTab_(ss, TABS.config, ["키", "값"], [
    ["회당가점", 10],
    ["쿨다운초", 0],
    ["카메라타임아웃초", 8],
    ["트리거키", "Space"],
    ["첫문장", "{이름} 학생, {추가}점이 가산되어 총 {총점}점입니다"],
    ["미등록처리", "거부"],
    ["표시시간초", 4],
  ]);

  ss.toast("초기 설정 완료! 탭 5개가 준비되었습니다.", "QR 점수 스캐너", 5);
}

function ensureTab_(ss, name, headers, examples) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var firstCell = sh.getRange(1, 1).getValue();
  if (firstCell === "" || firstCell === null) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    if (examples && examples.length) {
      sh.getRange(2, 1, examples.length, examples[0].length).setValues(examples);
    }
    sh.setFrozenRows(1);
  }
  return sh;
}

/** student list C열(QR)을 채워, 학번을 입력하면 QR이 자동으로 보이게 함 (빈 행은 공백) */
function fillQrColumn_(sh) {
  if (!sh) return;
  var LAST = 1000;
  var formulas = [];
  for (var r = 2; r <= LAST; r++) {
    formulas.push([
      '=IF($A' + r + '="","",IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=200x200&data="&$A' + r + '))',
    ]);
  }
  sh.getRange(2, 3, formulas.length, 1).setFormulas(formulas);
}

/** 보안 비밀키 설정: 아래 값을 원하는 문자열로 바꾼 뒤 이 함수를 1회 실행 */
function setSecret() {
  PropertiesService.getScriptProperties().setProperty("SECRET", "여기에-비밀키-입력");
}

// ─────────────── 웹앱 엔드포인트 ───────────────
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (!checkSecret_(p.secret)) return json_({ ok: false, message: "인증 실패" });
    var config = getConfig_(SpreadsheetApp.getActiveSpreadsheet());
    return json_({
      ok: true,
      triggerKey: config.triggerKey,
      cameraTimeoutSec: config.cameraTimeoutSec,
      displaySec: config.displaySec,
    });
  } catch (err) {
    return json_({ ok: false, message: errMsg_(err) });
  }
}

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    if (!checkSecret_(body.secret)) return json_({ ok: false, reason: "error", message: "인증 실패" });

    var id = body.studentId == null ? "" : String(body.studentId).trim();
    if (!id) return json_({ ok: false, reason: "error", message: "학번이 비어 있습니다." });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var config = getConfig_(ss);
    var messages = getMessages_(ss);

    // 1) 학번 → 이름
    var students = readTab_(ss, TABS.students);
    var name = "";
    for (var i = 1; i < students.length; i++) {
      if (cell_(students[i][0]) === id) {
        name = cell_(students[i][1]) || "(이름 없음)";
        break;
      }
    }
    if (!name) {
      if (config.unregistered === "거부") {
        return json_({ ok: false, reason: "unregistered", message: "등록되지 않은 학번입니다." });
      }
      name = "(미등록)";
    }

    // 2) Scores 에서 현재 총점 + 행 위치 + 마지막 스캔 시각
    var scoresSheet = ss.getSheetByName(TABS.scores);
    var scores = scoresSheet.getDataRange().getValues();
    var prev = 0, rowIndex1 = -1, lastTs = 0;
    for (var j = 1; j < scores.length; j++) {
      if (cell_(scores[j][0]) === id) {
        prev = Number(scores[j][2]) || 0;
        lastTs = Number(scores[j][4]) || 0;
        rowIndex1 = j + 1;
        break;
      }
    }

    var now = new Date();
    var nowMs = now.getTime();

    // 3) 쿨다운
    if (config.cooldownSec > 0 && lastTs && nowMs - lastTs < config.cooldownSec * 1000) {
      return json_({ ok: false, reason: "cooldown", message: "이미 적립되었습니다. 잠시 후 다시 시도하세요." });
    }

    // 4) 가산 + 멘트
    var added = config.pointsPerScan;
    var total = prev + added;
    var vars = { "이름": name, "학번": id, "추가": added, "총점": total };
    var line1 = fill_(config.firstLine, vars);
    var msg = pickMessage_(prev, total, messages);
    var line2 = msg ? fill_(msg, vars) : "";

    var nowStr = Utilities.formatDate(now, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss");

    // 5) 로그 + 6) Scores upsert (A:학번 B:이름 C:총점 D:최근스캔 E:_ts)
    ss.getSheetByName(TABS.record).appendRow([nowStr, id, name, added, total]);
    if (rowIndex1 > 0) {
      scoresSheet.getRange(rowIndex1, 1, 1, 5).setValues([[id, name, total, nowStr, nowMs]]);
    } else {
      scoresSheet.appendRow([id, name, total, nowStr, nowMs]);
    }

    return json_({ ok: true, studentId: id, studentName: name, added: added, total: total, line1: line1, line2: line2 });
  } catch (err) {
    return json_({ ok: false, reason: "error", message: errMsg_(err) });
  }
}

// ─────────────── 내부 헬퍼 ───────────────
function getConfig_(ss) {
  var rows = readTab_(ss, TABS.config);
  var map = {};
  for (var i = 1; i < rows.length; i++) {
    var k = cell_(rows[i][0]);
    if (k) map[k] = cell_(rows[i][1]);
  }
  function num(k, d) {
    var v = map[k];
    var n = v != null && v !== "" ? Number(v) : NaN;
    return isFinite(n) ? n : d;
  }
  return {
    pointsPerScan: num("회당가점", DEFAULTS.pointsPerScan),
    cooldownSec: num("쿨다운초", DEFAULTS.cooldownSec),
    cameraTimeoutSec: num("카메라타임아웃초", DEFAULTS.cameraTimeoutSec),
    triggerKey: map["트리거키"] != null ? map["트리거키"] : DEFAULTS.triggerKey,
    firstLine: map["첫문장"] || DEFAULTS.firstLine,
    unregistered: map["미등록처리"] === "허용" ? "허용" : "거부",
    displaySec: num("표시시간초", DEFAULTS.displaySec),
  };
}

function getMessages_(ss) {
  var rows = readTab_(ss, TABS.messages);
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var raw = cell_(rows[i][0]);
    if (raw === "") continue;
    var th = Number(raw);
    if (!isFinite(th)) continue;
    out.push({
      threshold: th,
      text: rows[i][1] == null ? "" : String(rows[i][1]),
      once: cell_(rows[i][2]).toUpperCase() === "Y",
    });
  }
  out.sort(function (a, b) { return a.threshold - b.threshold; });
  return out;
}

/** 달성(once=Y, 이번에 처음 넘은 임계) 우선, 없으면 상시(once=N, 현재 점수대) */
function pickMessage_(prev, total, messages) {
  var i, m;
  for (i = messages.length - 1; i >= 0; i--) {
    m = messages[i];
    if (m.once && prev < m.threshold && m.threshold <= total) return m.text;
  }
  for (i = messages.length - 1; i >= 0; i--) {
    m = messages[i];
    if (!m.once && m.threshold <= total) return m.text;
  }
  return "";
}

function fill_(t, vars) {
  return String(t).replace(/\{(이름|학번|추가|총점)\}/g, function (_, k) {
    return String(vars[k] != null ? vars[k] : "");
  });
}

function readTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  return sh ? sh.getDataRange().getValues() : [];
}

function cell_(v) {
  return (v == null ? "" : String(v)).trim();
}

function checkSecret_(provided) {
  var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret) return true; // 비밀키 미설정이면 통과(초기 편의)
  return String(provided || "") === String(secret);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errMsg_(err) {
  return err && err.message ? err.message : String(err);
}
