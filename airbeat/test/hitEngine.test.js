import test from 'node:test';
import assert from 'node:assert/strict';
import { HitEngine, S } from '../src/core/hitEngine.js';
import { replayAll } from '../src/core/replay.js';
import { swing, sampleSwings } from './helpers.mjs';

const UP = [0, 1, 0];
const drum = (id, x = 0) => ({ id, center: [x, 0, 0], normal: UP, r: 0.08 });
const run = (samples, { drums = [drum('a')], config } = {}) => replayAll(new HitEngine({ drums, config }), { samples });

test('一次下击只触发一次，穿越时刻插值准确', () => {
  for (const fps of [30, 60, 90]) {
    for (const phase of [0, 7, 19]) {
      const hits = run(sampleSwings([swing({ tCross: 1000, speed: 2 })], { fps, phase }));
      assert.equal(hits.length, 1, `fps=${fps} phase=${phase}`);
      assert.ok(Math.abs(hits[0].tHit - 1000) < 12, `fps=${fps} phase=${phase} tHit=${hits[0].tHit}`);
      assert.ok(Math.abs(hits[0].vn - 2) < 0.3, `vn=${hits[0].vn}`);
    }
  }
});

test('规则 2：速度低于门限不发声', () => {
  assert.equal(run(sampleSwings([swing({ tCross: 1000, speed: 0.3 })])).length, 0);
});

test('规则 3：横扫不算击打', () => {
  // 下落 1 m/s，同时横向 3 m/s：夹角约 72°
  const hits = run(sampleSwings([swing({ tCross: 1000, speed: 1, vx: 3, top: 0.15 })], { fps: 60, rest: [-0.45, 0.15, 0] }));
  assert.equal(hits.length, 0);
});

test('判定半径 1.25r：边缘擦到算，圈外不算', () => {
  assert.equal(run(sampleSwings([swing({ x: 0.095, tCross: 1000 })])).length, 1);
  assert.equal(run(sampleSwings([swing({ x: 0.11, tCross: 1000 })])).length, 0);
});

test('高速挥击一步跨过预备区也能触发', () => {
  // 4 m/s、30Hz：相邻采样相距约 13cm
  for (const phase of [0, 11, 22]) {
    const hits = run(sampleSwings([swing({ tCross: 1000, speed: 4, top: 0.4, depth: 0.1 })], { fps: 30, phase }));
    assert.equal(hits.length, 1, `phase=${phase}`);
  }
});

test('规则 5：没抬回回位高度不能再打', () => {
  // 第二下只抬到鼓面上方 2cm
  const s1 = swing({ tCross: 1000, speed: 2, depth: 0.03 });
  const samples = sampleSwings([s1], { fps: 60, t1: s1.tStart + 130 });
  let t = samples.at(-1).t;
  const wobble = [-0.02, 0.0, 0.02, 0.0, -0.03, 0.02, -0.03];
  for (let i = 0; i < 40; i++) samples.push({ t: (t += 16.7), hands: [{ id: 'R', valid: true, p: [0, wobble[i % wobble.length], 0] }] });
  assert.equal(run(samples, { config: { vMin: 0.4 } }).length, 1);
});

test('抬手后连打两下得到两次击打', () => {
  const hits = run(sampleSwings([swing({ tCross: 1000 }), swing({ tCross: 1400 })], { fps: 60 }));
  assert.equal(hits.length, 2);
  assert.ok(hits[1].tHit - hits[0].tHit > 380);
});

test('追踪丢失 < 100ms：恢复后用丢失前后两点补做穿越测试', () => {
  const hits = run(sampleSwings([swing({ tCross: 1000, speed: 1.5, depth: 0.15 })], { fps: 60, lost: (t) => t > 960 && t < 1040 }));
  assert.equal(hits.length, 1);
  assert.ok(Math.abs(hits[0].tHit - 1000) < 25);
});

test('追踪丢失 ≥ 150ms：回 IDLE，不补判', () => {
  const hits = run(sampleSwings([swing({ tCross: 1000, speed: 1.5 })], { fps: 60, lost: (t) => t > 930 && t < 1100 }));
  assert.equal(hits.length, 0);
});

test('手从画面外进入：第一个采样不参与穿越测试', () => {
  const engine = new HitEngine({ drums: [drum('a')] });
  const ev = [
    ...engine.push({ t: 0, hands: [{ id: 'R', valid: true, p: [0, 0.3, 0] }] }),
    ...engine.push({ t: 33, hands: [{ id: 'R', valid: false }] }),
    ...engine.push({ t: 400, hands: [{ id: 'R', valid: true, p: [0, -0.05, 0] }] }),
    ...engine.push({ t: 433, hands: [{ id: 'R', valid: true, p: [0, -0.06, 0] }] }),
  ];
  assert.equal(ev.length, 0);
});

test('丢失时进入 FROZEN，短暂丢失后回到原状态', () => {
  const engine = new HitEngine({ drums: [drum('a')] });
  const s = (t, y) => engine.push({ t, hands: [{ id: 'R', valid: y !== null, p: [0, y, 0] }] });
  s(0, 0.2);
  s(33, 0.15);
  s(66, 0.1);
  assert.equal(engine.stateOf('R', 'a'), S.ARMED);
  s(99, null);
  assert.equal(engine.stateOf('R', 'a'), S.FROZEN);
  s(132, 0.05);
  assert.equal(engine.stateOf('R', 'a'), S.ARMED);
});

test('速度超过 8 m/s 的跳变被丢弃，不触发', () => {
  const samples = [];
  for (let i = 0; i < 10; i++) samples.push({ t: i * 33, hands: [{ id: 'R', valid: true, p: [0, 0.1, 0] }] });
  samples.push({ t: 330, hands: [{ id: 'R', valid: true, p: [0, -0.3, 0] }] }); // 单点尖峰
  for (let i = 11; i < 20; i++) samples.push({ t: i * 33, hands: [{ id: 'R', valid: true, p: [0, 0.1, 0] }] });
  assert.equal(run(samples).length, 0);
});

test('两鼓判定圆重叠处归最近的鼓心', () => {
  const drums = [drum('a', -0.095), drum('b', 0.095)]; // 判定半径 10cm，中间重叠 1cm
  const hits = run(sampleSwings([swing({ x: 0.003, tCross: 1000 })], { rest: [0.003, 0.2, 0] }), { drums });
  assert.deepEqual(hits.map((h) => h.drum), ['b']);
});

test('预测触发：提前发声，预测时刻接近真实穿越，且不重复触发', () => {
  const samples = sampleSwings([swing({ tCross: 1000, speed: 2 })], { fps: 60, phase: 5 });
  const hits = run(samples, { config: { predict: { enabled: true, leadMs: 30 } } });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].predicted, true);
  assert.ok(hits[0].t < 1000 && hits[0].t >= 970, `触发于 ${hits[0].t}`);
  assert.ok(Math.abs(hits[0].tHit - 1000) < 12, `tHit=${hits[0].tHit}`);
});

test('双手各打各的鼓，互不影响', () => {
  const drums = [drum('a', -0.2), drum('b', 0.2)];
  const L = sampleSwings([swing({ x: -0.2, tCross: 1000 })], { hand: 'L', fps: 60, t0: 700, t1: 1400, rest: [-0.2, 0.2, 0] });
  const R = sampleSwings([swing({ x: 0.2, tCross: 1030 })], { hand: 'R', fps: 60, t0: 700, t1: 1400, rest: [0.2, 0.2, 0] });
  const samples = L.map((s, i) => ({ t: s.t, hands: [...s.hands, ...R[i].hands] }));
  const hits = run(samples, { drums });
  assert.deepEqual(hits.map((h) => `${h.hand}${h.drum}`).sort(), ['La', 'Rb']);
});
