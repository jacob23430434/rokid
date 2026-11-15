// 谱面格式与硬约束（策划案 4.5）。
export const STAR_RULES = {
  1: { maxDrums: 2, maxDensity: 1, accent: false },
  2: { maxDrums: 4, maxDensity: 1.5, accent: false },
  3: { maxDrums: 4, maxDensity: 2.5, accent: true },
  4: { maxDrums: 8, maxDensity: 4, accent: true },
  5: { maxDrums: 8, maxDensity: 6, accent: true },
};
const DENSITY_WINDOW_MS = 4000;
const MIN_HAND_INTERVAL_MS = 160;

export const beatMs = (chart) => 60000 / chart.bpm;

/** 谱面 JSON → 按时间排序的音符 [{tMs, drum, accent}] */
export function loadNotes(chart) {
  const b = beatMs(chart);
  return chart.notes
    .map((n) => ({ tMs: (chart.offsetMs || 0) + n.beat * b, drum: n.drum, accent: !!n.accent }))
    .sort((a, b2) => a.tMs - b2.tMs);
}

/** @returns {string[]} 违反的约束；空数组表示通过 */
export function validateChart(chart) {
  const rule = STAR_RULES[chart.stars];
  if (!rule) return [`未知星级 ${chart.stars}`];
  const notes = loadNotes(chart);
  const errors = [];
  const drums = new Set(notes.map((n) => n.drum));
  if (drums.size > rule.maxDrums) errors.push(`用到 ${drums.size} 面鼓，上限 ${rule.maxDrums}`);
  if (!rule.accent && notes.some((n) => n.accent)) errors.push('该星级不允许重音');

  let peak = 0;
  for (let i = 0, j = 0; i < notes.length; i++) {
    while (notes[i].tMs - notes[j].tMs >= DENSITY_WINDOW_MS) j++;
    peak = Math.max(peak, (i - j + 1) / (DENSITY_WINDOW_MS / 1000));
  }
  if (peak > rule.maxDensity + 1e-9) errors.push(`峰值密度 ${peak.toFixed(2)}/s，上限 ${rule.maxDensity}/s`);

  // 两只手：任意连续 3 个音符的跨度必须 ≥ 160ms，否则必有一只手间隔不足
  for (let i = 2; i < notes.length; i++) {
    if (notes[i].tMs - notes[i - 2].tMs < MIN_HAND_INTERVAL_MS) {
      errors.push(`${Math.round(notes[i].tMs)}ms 处单手间隔 < ${MIN_HAND_INTERVAL_MS}ms`);
      break;
    }
  }
  return errors;
}
