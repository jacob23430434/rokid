// 生成首曲的 2 张谱面。运行：npm run charts
import { writeFileSync } from 'node:fs';
import { SONG } from '../src/core/song.js';

const bars = [];
for (let b = SONG.playFromBar; b < SONG.playToBar; b++) bars.push(b);

// 1 星：2 面鼓（中间两面），二分音符，单手即可
const P1 = [[1, 2], [1, 2], [1, 1], [2, 2], [1, 2], [2, 1], [1, 2], [2, 2]];
const one = bars.flatMap((bar, i) => P1[i % P1.length].map((drum, k) => ({ beat: bar * 4 + k * 2, drum })));
one.push({ beat: SONG.playToBar * 4, drum: 1 });

// 2 星：4 面鼓，四分音符，左（0、1）右（2、3）交替；每 4 小节最后一拍留空喘气
const P2 = [[1, 2, 1, 2], [0, 3, 1, 2], [1, 2, 0, 3], [0, 2, 1, 3], [1, 3, 0, 2], [0, 3, 0, 3], [1, 2, 0, 3], [0, 2, 1, 3]];
const two = bars.flatMap((bar, i) =>
  P2[i % P2.length].map((drum, k) => ({ beat: bar * 4 + k, drum })).filter((_, k) => !(i % 4 === 3 && k === 3)),
);
two.push({ beat: SONG.playToBar * 4, drum: 2 });

const base = { song: SONG.id, title: SONG.title, bpm: SONG.bpm, offsetMs: 0 };
for (const [stars, notes] of [[1, one], [2, two]]) {
  const file = new URL(`../charts/${SONG.id}-${stars}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify({ ...base, stars, notes }) + '\n');
  console.log(`${stars} 星：${notes.length} 个音符`);
}
