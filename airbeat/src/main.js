// 主流程：输入 → 判定层 → 音频 / 表现 / 计分。
import { HitEngine } from './core/hitEngine.js';
import { LAYOUT_ROW4, placeLayout } from './core/layouts.js';
import { mapVelocity } from './core/velocity.js';
import { SwingDetector, calibrate, thresholds, AdaptiveRef, CALIB_SWINGS } from './core/calibration.js';
import { Judge, TrackingLog } from './core/judge.js';
import { loadNotes, beatMs } from './core/chart.js';
import { SONG, songDurationMs, buildBacking } from './core/song.js';
import { Recorder } from './core/replay.js';
import { clamp } from './core/vec.js';
import { AudioEngine } from './audio/engine.js';
import { PointerInput } from './input/pointer.js';
import { CameraInput } from './input/camera.js';
import { ReplayPlayer } from './input/replayPlayer.js';
import { Renderer } from './ui/render.js';

const WORLD = { w: 0.8, h: 0.45 }; // 画面对应的世界尺寸（米）
const KEYS = ['D', 'F', 'J', 'K'];
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

const audio = new AudioEngine();
const engine = new HitEngine();
const renderer = new Renderer($('view'), WORLD);
const st = {
  mode: 'start', // start | calib | menu | free | song | result
  inputKind: null,
  drums: [],
  hands: { L: { valid: false }, R: { valid: false } },
  keys: null,
  notes: [],
  judge: null,
  songMs: 0,
  durationMs: songDurationMs(SONG),
  usedDrums: null,
  calibY: -0.05,
};
let input = null;
let cal = { ...thresholds(2), drumHeight: -0.08 };
let adaptive = null;
let swings = [];
let detectors = { L: new SwingDetector(), R: new SwingDetector() };
let tracking = new TrackingLog();
let recorder = null;
let lastRecording = null;
let lastStars = 1;
let hitCount = 0;
let sampleHz = 0;
let lastSampleT = 0;
let ended = false;

// 设备固定偏移：开发期测好写进配置，不让玩家校准（策划案 4.3）。可用 ?offset= 覆盖。
function inputOffsetMs() {
  if (params.has('offset')) return Number(params.get('offset'));
  if (st.inputKind !== 'camera') return 0;
  return input?.hasCaptureTime ? 20 : 90;
}

// ---------- 界面 ----------
function show(panel) {
  for (const id of ['panel-start', 'panel-menu', 'panel-result']) $(id).hidden = id !== panel;
  $('topbar').style.display = ['free', 'song', 'calib'].includes(st.mode) ? 'flex' : 'none';
}
const prompt = (text) => ($('prompt').textContent = text);

function setMode(mode) {
  st.mode = mode;
  window.__airbeat = { st, engine, audio, get cal() { return cal; }, get hitCount() { return hitCount; } };
  if (mode === 'start') show('panel-start');
  else if (mode === 'menu') show('panel-menu');
  else if (mode === 'result') show('panel-result');
  else show(null);
}

// ---------- 输入 ----------
async function startInput(kind, log) {
  $('start-error').textContent = '';
  try {
    await audio.init(LAYOUT_ROW4);
    input?.stop();
    st.inputKind = kind;
    if (kind === 'camera') {
      prompt('正在启动摄像头与手部识别…');
      show(null);
      $('cam').style.display = 'block';
      input = new CameraInput($('cam'), WORLD, onSample);
      await input.start();
    } else if (kind === 'pointer') {
      $('cam').style.display = 'none';
      input = new PointerInput($('stage'), (x, y) => renderer.toWorld(x, y), onSample);
      input.start();
    } else {
      $('cam').style.display = 'none';
      input = new ReplayPlayer(log, onSample, () => prompt('回放结束'));
    }
  } catch (err) {
    console.error(err);
    prompt('');
    setMode('start');
    $('start-error').textContent = `启动失败：${err.message || err}。可以改用"鼠标 / 触屏"。`;
    return;
  }
  st.keys = kind === 'camera' ? null : KEYS;
  if (kind === 'replay') {
    // 回放日志自带校准结果，直接进自由练习
    applyCalibration({ ...thresholds(log.vRef ?? 2), drumHeight: log.drumHeight ?? -0.08 });
    startFree();
    input.start();
  } else {
    startCalibration();
  }
}

function onSample(sample) {
  if (lastSampleT) sampleHz += (1000 / Math.max(1, sample.t - lastSampleT) - sampleHz) * 0.05;
  lastSampleT = sample.t;
  if (recorder && (st.mode === 'free' || st.mode === 'song')) recorder.push(sample);

  const events = engine.push(sample);
  let anyValid = false;
  for (const h of sample.hands) {
    const tr = engine.hand(h.id);
    const view = st.hands[h.id];
    view.valid = h.valid && tr.valid;
    if (!view.valid) continue;
    anyValid = true;
    Object.assign(view, { p: tr.p, fist: h.fist, palm: h.palm, outline: h.outline });
    if (st.mode === 'calib' && !tr.fresh) {
      const sw = detectors[h.id].push(sample.t, tr.p, tr.v);
      if (sw) onCalibSwing(sw, tr.p);
    }
  }
  if (anyValid && st.mode === 'song') tracking.push(audio.songMs(sample.t - inputOffsetMs()));
  if (st.mode === 'free' || st.mode === 'song') for (const ev of events) onHit(ev.drumIndex, ev.vn, ev.tHit - inputOffsetMs());
}

// ---------- 校准：3 次试挥 ----------
function startCalibration() {
  swings = [];
  detectors = { L: new SwingDetector(), R: new SwingDetector() };
  st.drums = [];
  st.usedDrums = null;
  engine.setDrums([]);
  setMode('calib');
  prompt(`朝发光的鼓敲 ${CALIB_SWINGS} 下`);
}

function onCalibSwing(sw, p) {
  swings.push(sw);
  // 第一声固定用强层，保证够响
  const vel = swings.length === 1 ? 1 : 0.6;
  const fake = { center: [p[0], sw.lowY, 0], color: '#ffd23d' };
  audio.hit(1, vel);
  renderer.hit(-1, fake, vel, performance.now());
  st.calibY = sw.lowY + 0.02;
  if (swings.length < CALIB_SWINGS) return prompt(`漂亮！再来 ${CALIB_SWINGS - swings.length} 下`);
  applyCalibration(calibrate(swings));
  prompt('');
  $('menu-info').textContent = `校准完成：门限 ${cal.vMin.toFixed(2)} m/s，满力度 ${cal.vMax.toFixed(2)} m/s。`;
  setMode('menu');
}

function applyCalibration(c) {
  // 鼓去找手：鼓面放在试挥最低点上方 2cm，但不出画面
  cal = { ...c, drumHeight: clamp(c.drumHeight, -WORLD.h / 2 + 0.05, WORLD.h / 2 - 0.16) };
  adaptive = new AdaptiveRef(cal.vRef);
  st.drums = placeLayout(LAYOUT_ROW4, cal.drumHeight);
  engine.setDrums(st.drums);
  engine.setConfig({
    vMin: cal.vMin,
    predict: { enabled: st.inputKind === 'camera' && params.get('predict') !== '0', leadMs: Number(params.get('lead') ?? 30) },
  });
}

// ---------- 游玩 ----------
function beginRecording(extra) {
  recorder = $('chk-record').checked
    ? new Recorder({ source: st.inputKind, world: WORLD, drumHeight: cal.drumHeight, vRef: cal.vRef, inputOffsetMs: inputOffsetMs(), ...extra })
    : null;
}

function startFree() {
  st.usedDrums = null;
  st.judge = null;
  beginRecording({ mode: 'free' });
  setMode('free');
  prompt('随便敲');
  setTimeout(() => st.mode === 'free' && prompt(''), 2500);
}

async function startSong(stars) {
  lastStars = stars;
  const chart = await (await fetch(`charts/${SONG.id}-${stars}.json`)).json();
  st.notes = loadNotes(chart);
  st.judge = new Judge(st.notes, { stars: chart.stars, beatMs: beatMs(chart) });
  st.notes = st.judge.notes;
  st.usedDrums = new Set(st.notes.map((n) => n.drum));
  tracking = new TrackingLog();
  ended = false;
  beginRecording({ mode: 'song', chart: `${SONG.id}-${stars}` });
  const start = audio.startBacking(buildBacking(SONG));
  if (recorder) recorder.meta.songStartMs = performance.now() + (start - audio.ctx.currentTime) * 1000 + audio.latencyMs;
  setMode('song');
  prompt('跟着光点敲');
  setTimeout(() => st.mode === 'song' && prompt(''), 4000);
}

/** 一次击打：发声不等下一帧，判定用扣掉固定偏移后的时刻 */
function onHit(drumIndex, vn, tPerf, velOverride) {
  const vel = velOverride ?? mapVelocity(vn, cal.vMin, cal.vMax);
  const now = performance.now();
  audio.hit(drumIndex, vel);
  renderer.hit(drumIndex, st.drums[drumIndex], vel, now);
  hitCount++;
  if (velOverride == null) adaptive?.record(vn);
  if (st.mode !== 'song') return;
  const res = st.judge.hit(drumIndex, audio.songMs(tPerf), vel);
  if (res) renderer.judgeText(st.drums[drumIndex], res.result, now);
}

function finishSong() {
  audio.stopBacking();
  const s = st.judge.summary();
  lastRecording = recorder?.toJSON() ?? lastRecording;
  recorder = null;
  $('res-grade').textContent = s.grade;
  $('res-score').textContent = `${s.score} 分 · 得分率 ${(s.rate * 100).toFixed(1)}% · 最大连击 ${s.maxCombo}`;
  $('res-stats').innerHTML = [['Perfect', s.counts.perfect], ['Good', s.counts.good], ['Miss', s.counts.miss], ['保护', s.counts.protect]]
    .map(([k, v]) => `<div><b>${v}</b>${k}</div>`)
    .join('');
  $('res-comment').textContent = comment(s);
  $('btn-up').hidden = lastStars >= 2;
  $('btn-download').hidden = !lastRecording;
  prompt('');
  setMode('result');
}

// 赛后点评：MVP 用本地模板（云端大模型点评在 Beta 接入）
function comment(s) {
  const parts = [`你隔空敲了 ${s.counts.perfect + s.counts.good + s.strays} 下。`];
  if (s.protectRatio > 0.1) parts.push('光线或手的位置影响了追踪，试试把手抬到画面中间、面向亮处。');
  else if (s.meanDeltaMs > 20) parts.push(`整体偏晚约 ${Math.round(s.meanDeltaMs)} 毫秒，可以在光圈收拢前一点出手。`);
  else if (s.meanDeltaMs < -20) parts.push(`整体偏早约 ${Math.round(-s.meanDeltaMs)} 毫秒，等光圈贴到鼓边再敲。`);
  else if (s.grade === 'S') parts.push('节奏很稳，可以升一星了。');
  else if (s.counts.miss > s.total * 0.2) parts.push('漏掉的音符有点多，先盯住一面鼓，跟着伴奏的重拍敲。');
  else if (s.counts.miss > 0) parts.push(`只漏了 ${s.counts.miss} 个，再来一遍就能全中。`);
  else parts.push('一个没漏，再来一遍把 Good 打成 Perfect。');
  return parts.join('');
}

function exitToMenu() {
  audio.stopBacking();
  lastRecording = recorder?.toJSON() ?? lastRecording;
  recorder = null;
  $('btn-download').hidden = !lastRecording;
  prompt('');
  if (st.inputKind === 'replay' || st.mode === 'calib') {
    input?.stop();
    input = null;
    $('cam').style.display = 'none';
    st.drums = [];
    engine.setDrums([]);
    setMode('start');
  } else setMode('menu');
}

// ---------- 帧循环 ----------
function frame(now) {
  requestAnimationFrame(frame);
  if (st.mode === 'song') {
    st.songMs = audio.songMs(now);
    for (const r of st.judge.update(st.songMs, tracking.hadTracking)) renderer.judgeText(st.drums[r.note.drum], r.result, now);
    if (!ended && st.songMs > st.durationMs + 300) {
      ended = true;
      finishSong();
    }
  }
  if (st.mode === 'free' || st.mode === 'song') {
    const upd = adaptive?.tick(now);
    if (upd) {
      cal = { ...cal, ...upd };
      engine.setConfig({ vMin: cal.vMin });
    }
  }
  renderer.draw(st, now);
  if (params.has('debug')) {
    $('debug').textContent =
      `采样 ${sampleHz.toFixed(0)}Hz  音频输出延迟 ${audio.latencyMs.toFixed(0)}ms  固定偏移 ${inputOffsetMs()}ms\n` +
      `v_min ${cal.vMin.toFixed(2)}  v_max ${cal.vMax.toFixed(2)}  鼓面高度 ${(cal.drumHeight * 100).toFixed(1)}cm  发声数 ${audio.voiceCount}  击打 ${hitCount}`;
  }
}

// ---------- 事件 ----------
$('btn-camera').onclick = () => startInput('camera');
$('btn-pointer').onclick = () => startInput('pointer');
$('file-replay').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const log = JSON.parse(await file.text());
    if (!Array.isArray(log.samples)) throw new Error('不是回放日志');
    await startInput('replay', log);
  } catch (err) {
    $('start-error').textContent = `无法加载：${err.message}`;
  }
  e.target.value = '';
};
$('btn-free').onclick = startFree;
$('btn-song1').onclick = () => startSong(1);
$('btn-song2').onclick = () => startSong(2);
$('btn-recal').onclick = startCalibration;
$('btn-again').onclick = () => startSong(lastStars);
$('btn-up').onclick = () => startSong(lastStars + 1);
$('btn-back').onclick = () => setMode('menu');
$('btn-exit').onclick = exitToMenu;
$('btn-download').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(lastRecording)], { type: 'application/json' }));
  a.download = `airbeat-replay-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key === 'Escape' && ['free', 'song', 'calib'].includes(st.mode)) return exitToMenu();
  const i = KEYS.indexOf(e.key.toUpperCase());
  if (i < 0 || !(st.mode === 'free' || st.mode === 'song')) return;
  onHit(i, 0, e.timeStamp, e.shiftKey ? 0.9 : 0.55);
});
window.addEventListener('resize', () => renderer.resize());

setMode('start');
requestAnimationFrame(frame);
