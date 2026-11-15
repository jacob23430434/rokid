// 生成一份合成回放日志：按 1 星谱面逐音击打，带追踪噪声。运行：npm run fixture
// 用途：判定层回放测试的固定输入；也可在浏览器里用"加载回放"播放。
import { readFileSync, writeFileSync } from 'node:fs';
import { loadNotes } from '../src/core/chart.js';
import { LAYOUT_ROW4, placeLayout } from '../src/core/layouts.js';
import { Recorder } from '../src/core/replay.js';
import { swing, sampleSwings } from '../test/helpers.mjs';

const chart = JSON.parse(readFileSync(new URL('../charts/first-light-1.json', import.meta.url)));
const drums = placeLayout(LAYOUT_ROW4, -0.08);
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2;

const swings = loadNotes(chart).map((n, i) =>
  swing({ x: drums[n.drum].center[0] + rnd() * 0.03, plane: -0.08, tCross: 1000 + n.tMs + rnd() * 25, speed: 1.2 + (i % 5) * 0.5, top: 0.42 }),
);
const rec = new Recorder({ source: 'synthetic', chart: 'first-light-1', songStartMs: 1000, drumHeight: -0.08, world: { w: 0.8, h: 0.45 } });
for (const s of sampleSwings(swings, { fps: 30, rest: [0, 0.34, 0] })) {
  for (const h of s.hands) if (h.valid) h.p = h.p.map((c) => c + rnd() * 0.002); // 2mm 追踪抖动
  rec.push(s);
}
writeFileSync(new URL('../test/fixtures/first-light-1.replay.json', import.meta.url), JSON.stringify(rec.toJSON()) + '\n');
console.log(`${rec.samples.length} 个采样`);
