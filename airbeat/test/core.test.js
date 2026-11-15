import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OneEuro } from '../src/core/oneEuro.js';
import { mapVelocity, gainDb, layerWeights, layerOf, particleCount } from '../src/core/velocity.js';
import { SwingDetector, calibrate, thresholds, AdaptiveRef } from '../src/core/calibration.js';
import { HandTracker } from '../src/core/tracker.js';
import { DEFAULTS } from '../src/core/config.js';
import { Judge, TrackingLog, grade } from '../src/core/judge.js';
import { loadNotes, validateChart, beatMs } from '../src/core/chart.js';
import { SONG, songDurationMs, buildBacking } from '../src/core/song.js';
import { LAYOUT_4, LAYOUT_8, LAYOUT_ROW4 } from '../src/core/layouts.js';
import { swing, sampleSwings } from './helpers.mjs';

const chart = (stars) => JSON.parse(readFileSync(new URL(`../charts/first-light-${stars}.json`, import.meta.url)));

test('1€ 滤波：静止时压抖动，快速移动时跟手', () => {
  const f = new OneEuro({ minCutoff: 1.5, beta: 10 });
  let worst = 0;
  for (let i = 0; i < 90; i++) {
    const y = f.filter(0.5 + (i % 2 ? 0.002 : -0.002), i / 30);
    if (i > 30) worst = Math.max(worst, Math.abs(y - 0.5));
  }
  assert.ok(worst < 0.001, `残余抖动 ${worst}`);
  const g = new OneEuro({ minCutoff: 1.5, beta: 10 });
  let y = 0;
  for (let i = 0; i < 15; i++) y = g.filter((2 * i) / 30, i / 30); // 2 m/s
  assert.ok((2 * 14) / 30 - y < 0.03, `滞后 ${(2 * 14) / 30 - y}m`);
});

test('力度映射：门限、曲线、dB、分层', () => {
  assert.equal(mapVelocity(0.4, 0.5, 3), 0);
  assert.equal(mapVelocity(9, 0.5, 3), 1);
  assert.ok(Math.abs(mapVelocity(1.75, 0.5, 3) - Math.pow(0.5, 1.3)) < 1e-9);
  assert.equal(gainDb(0), -20);
  assert.equal(gainDb(1), 0);
  assert.deepEqual(layerWeights(0.1), [1, 0, 0]);
  assert.deepEqual(layerWeights(0.5), [0, 1, 0]);
  assert.deepEqual(layerWeights(0.9), [0, 0, 1]);
  const [s, m, h] = layerWeights(0.35); // 边界正中：两层各半
  assert.ok(Math.abs(s - 0.5) < 1e-9 && Math.abs(m - 0.5) < 1e-9 && h === 0);
  for (let v = 0; v <= 1; v += 0.01) assert.ok(Math.abs(layerWeights(v).reduce((a, b) => a + b) - 1) < 1e-9);
  assert.deepEqual([0.2, 0.5, 0.8].map(layerOf), [0, 1, 2]);
  assert.equal(particleCount(0), 8);
  assert.equal(particleCount(1), 32);
});

test('校准：3 次试挥得到门限与鼓面高度', () => {
  const c = calibrate([{ peak: 1.8, lowY: -0.1 }, { peak: 2.4, lowY: -0.14 }, { peak: 2.0, lowY: -0.12 }]);
  assert.equal(c.vRef, 2.0);
  assert.ok(Math.abs(c.vMin - 0.7) < 1e-9);
  assert.ok(Math.abs(c.vMax - 3.6) < 1e-9);
  assert.ok(Math.abs(c.drumHeight - -0.1) < 1e-9);
  assert.deepEqual([thresholds(0.5).vMin, thresholds(0.5).vMax], [0.4, 2.5]); // 下限钳制
  assert.deepEqual([thresholds(5).vMin, thresholds(5).vMax], [1.2, 6.0]); // 上限钳制
});

test('挥击检测：三次试挥各识别一次，峰值速度与最低点正确', () => {
  const swings = [0, 1, 2].map((i) => swing({ tCross: 1000 + i * 700, speed: 2, plane: -0.1 }));
  const tracker = new HandTracker(DEFAULTS);
  const det = new SwingDetector();
  const found = [];
  for (const s of sampleSwings(swings, { fps: 30, rest: [0, 0.1, 0] })) {
    const r = tracker.push(s.t, s.hands[0].p);
    if (r?.valid && !r.fresh) {
      const sw = det.push(s.t, r.p, r.v);
      if (sw) found.push(sw);
    }
  }
  assert.equal(found.length, 3);
  for (const sw of found) {
    assert.ok(Math.abs(sw.peak - 2) < 0.2, `peak=${sw.peak}`);
    assert.ok(Math.abs(sw.lowY - -0.15) < 0.04, `lowY=${sw.lowY}`);
  }
});

test('游玩中修正：每 10 秒最多移动 10%', () => {
  const a = new AdaptiveRef(2.0);
  a.tick(0);
  for (let i = 0; i < 20; i++) a.record(1.0); // 越打越轻
  assert.equal(a.tick(5000), null);
  assert.ok(Math.abs(a.tick(10000).vRef - 1.8) < 1e-9);
  assert.ok(Math.abs(a.tick(20000).vRef - 1.62) < 1e-9);
});

test('判定窗与计分', () => {
  const notes = [0, 1000, 2000, 3000].map((tMs) => ({ tMs, drum: 0, accent: false }));
  const j = new Judge(notes, { stars: 3, beatMs: 500 });
  assert.equal(j.hit(0, 40, 0.5).result, 'perfect');
  assert.equal(j.hit(0, 1090, 0.5).result, 'good');
  assert.equal(j.hit(0, 1500, 0.5), null); // 窗外：不判
  assert.equal(j.hit(1, 2000, 0.5), null); // 打错鼓
  assert.deepEqual(j.update(2101).map((r) => r.result), ['miss']);
  assert.equal(j.combo, 0);
  assert.equal(j.score, 160);
  // 1-2 星放宽到 ±70 / ±140
  const easy = new Judge(notes, { stars: 1, beatMs: 500 });
  assert.equal(easy.hit(0, 65, 0.5).result, 'perfect');
  assert.equal(easy.hit(0, 1130, 0.5).result, 'good');
});

test('连击倍率、重音加成、能量与自由华彩', () => {
  const notes = Array.from({ length: 30 }, (_, i) => ({ tMs: i * 500, drum: 0, accent: i === 29 }));
  const j = new Judge(notes, { stars: 3, beatMs: 500 });
  for (let i = 0; i < 9; i++) assert.equal(j.hit(0, i * 500, 0.5).gained, 100);
  assert.equal(j.hit(0, 4500, 0.5).gained, 110); // 第 10 连击：×1.1
  for (let i = 10; i < 19; i++) j.hit(0, i * 500, 0.5);
  assert.equal(j.energy, 38);
  j.hit(0, 9500, 0.5); // 能量满
  assert.equal(j.energy, 0);
  assert.ok(j.inCadenza(9600));
  assert.equal(j.hit(0, 10000, 0.5).gained, 240); // ×1.2 倍率 × 2 华彩
  assert.ok(!j.inCadenza(9500 + 8 * 500 + 1));
  for (let i = 21; i < 29; i++) j.hit(0, i * 500, 0.5);
  const soft = new Judge(notes, { stars: 3, beatMs: 500 });
  assert.equal(soft.hit(0, 14500, 0.5).gained, 100); // 重音音符但力度不到强层
  assert.equal(new Judge(notes, { stars: 3, beatMs: 500 }).hit(0, 14500, 0.9).gained, 120);
});

test('保护：音符时刻追踪丢失，不加分也不断连击', () => {
  const notes = [0, 1000, 2000].map((tMs) => ({ tMs, drum: 0, accent: false }));
  const j = new Judge(notes, { stars: 3, beatMs: 500 });
  const log = new TrackingLog();
  for (let t = -200; t <= 2300; t += 33) if (t < 850 || t > 1150) log.push(t);
  j.hit(0, 0, 0.5);
  assert.deepEqual(j.update(1200, log.hadTracking).map((r) => r.result), ['protect']);
  assert.equal(j.combo, 1);
  assert.deepEqual(j.update(2200, log.hadTracking).map((r) => r.result), ['miss']);
  assert.equal(j.summary().counts.protect, 1);
});

test('评级', () => {
  assert.deepEqual([0.95, 0.9, 0.7, 0.5].map(grade), ['S', 'A', 'B', 'C']);
});

test('两张谱面满足星级硬约束，且落在曲目时长内', () => {
  for (const stars of [1, 2]) {
    const c = chart(stars);
    assert.deepEqual(validateChart(c), [], `${stars} 星`);
    const notes = loadNotes(c);
    assert.ok(notes[0].tMs >= SONG.playFromBar * 4 * beatMs(c));
    assert.ok(notes.at(-1).tMs < songDurationMs(SONG) - 2000);
    assert.equal(c.bpm, SONG.bpm);
  }
  assert.equal(songDurationMs(SONG), 60000);
});

test('谱面校验能抓出违规', () => {
  const bad = { bpm: 120, stars: 1, notes: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((beat, i) => ({ beat, drum: i % 3 })) };
  const errors = validateChart(bad);
  assert.ok(errors.some((e) => e.includes('面鼓')));
  assert.ok(errors.some((e) => e.includes('密度')));
  assert.ok(validateChart({ bpm: 120, stars: 3, notes: [{ beat: 0, drum: 0 }, { beat: 0.1, drum: 1 }, { beat: 0.2, drum: 0 }] }).some((e) => e.includes('单手间隔')));
});

test('伴奏事件按时间排序且不超出曲长', () => {
  const ev = buildBacking(SONG);
  assert.ok(ev.length > 100);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].t >= ev[i - 1].t);
  assert.ok(ev.at(-1).t < songDurationMs(SONG) / 1000);
});

test('布局：8 鼓的中间 4 面与 4 鼓完全相同；摄像头布局保持 19cm 间距', () => {
  assert.deepEqual(LAYOUT_8.slice(0, 4), LAYOUT_4);
  for (let i = 1; i < 4; i++) assert.ok(Math.abs(LAYOUT_ROW4[i].center[0] - LAYOUT_ROW4[i - 1].center[0] - 0.19) < 1e-9);
});
