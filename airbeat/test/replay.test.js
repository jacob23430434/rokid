// 判定层回放测试（MVP 通过标准）：把落盘的手部日志喂给判定层，检查整首曲的结果。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HitEngine } from '../src/core/hitEngine.js';
import { replayAll } from '../src/core/replay.js';
import { Judge, TrackingLog } from '../src/core/judge.js';
import { loadNotes, beatMs } from '../src/core/chart.js';
import { LAYOUT_ROW4, placeLayout } from '../src/core/layouts.js';
import { mapVelocity, layerOf } from '../src/core/velocity.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const log = read('./fixtures/first-light-1.replay.json');
const chart = read('../charts/first-light-1.json');

function play(samples, config) {
  const engine = new HitEngine({ drums: placeLayout(LAYOUT_ROW4, log.drumHeight), config });
  const judge = new Judge(loadNotes(chart), { stars: chart.stars, beatMs: beatMs(chart) });
  const tracking = new TrackingLog();
  const hits = [];
  for (const s of samples) {
    const now = s.t - log.songStartMs;
    if (s.hands.some((h) => h.valid)) tracking.push(now);
    for (const ev of engine.push(s)) {
      hits.push(ev);
      judge.hit(ev.drumIndex, ev.tHit - log.songStartMs, mapVelocity(ev.vn, 0.5, 3.5));
    }
    judge.update(now, tracking.hadTracking);
  }
  judge.update(Infinity, tracking.hadTracking);
  return { hits, summary: judge.summary() };
}

test('回放整首 1 星谱面：每个音符恰好一次击打，无误触发、无漏判', () => {
  const { hits, summary } = play(log.samples);
  assert.equal(hits.length, summary.total);
  assert.equal(summary.counts.miss, 0);
  assert.equal(summary.strays, 0);
  assert.equal(summary.counts.perfect + summary.counts.good, summary.total);
  assert.equal(summary.grade, 'S');
  assert.equal(summary.maxCombo, summary.total);
});

test('回放结果可复现：同一份日志两次回放事件完全一致', () => {
  const a = replayAll(new HitEngine({ drums: placeLayout(LAYOUT_ROW4, log.drumHeight) }), log);
  const b = replayAll(new HitEngine({ drums: placeLayout(LAYOUT_ROW4, log.drumHeight) }), log);
  assert.deepEqual(a, b);
});

test('回放里的力度覆盖轻、中、强三层', () => {
  const { hits } = play(log.samples);
  const layers = new Set(hits.map((h) => layerOf(mapVelocity(h.vn, 0.5, 3.5))));
  assert.deepEqual([...layers].sort(), [0, 1, 2]);
});

test('开启预测触发后结果不变差', () => {
  const { hits, summary } = play(log.samples, { predict: { enabled: true, leadMs: 30 } });
  assert.equal(hits.length, summary.total);
  assert.equal(summary.counts.miss, 0);
  assert.ok(hits.some((h) => h.predicted));
});

test('中途丢失追踪 1 秒：受影响的音符记保护，连击不断', () => {
  const t0 = log.songStartMs + loadNotes(chart)[10].tMs;
  const samples = log.samples.map((s) => (Math.abs(s.t - t0) < 500 ? { t: s.t, hands: s.hands.map((h) => ({ id: h.id, valid: false })) } : s));
  const { summary } = play(samples);
  assert.equal(summary.counts.protect, 1);
  assert.equal(summary.counts.miss, 0);
  assert.equal(summary.maxCombo, summary.total - 1);
});
