// 五声音阶音色：正弦加泛音加包络，自行合成，无授权风险（策划案 7.4）。
// 纯函数，返回 Float32Array。三个力度层音色不同：越重泛音越多、越亮。
const LAYERS = [
  { partials: [[1, 1, 0.45], [2, 0.15, 0.2]], click: 0 },
  { partials: [[1, 1, 0.5], [2, 0.35, 0.3], [3, 0.18, 0.2], [4.2, 0.08, 0.12]], click: 0.08 },
  { partials: [[1, 1, 0.55], [2, 0.55, 0.35], [3, 0.35, 0.25], [4.2, 0.22, 0.15], [5.4, 0.14, 0.1], [6.8, 0.08, 0.07]], click: 0.25 },
];
export const LAYER_COUNT = LAYERS.length;
export const ROUND_ROBIN = 4;
const TARGET_RMS = 0.15;

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {{freq:number, layer:number, variant:number, sampleRate?:number, dur?:number}} o */
export function renderTone({ freq, layer, variant, sampleRate = 48000, dur = 1.1 }) {
  const { partials, click } = LAYERS[layer];
  const n = Math.floor(dur * sampleRate);
  const out = new Float32Array(n);
  const detune = 1 + (variant - 1.5) * 0.0015; // 轮转采样之间略有差异
  const rnd = prng(1000 + layer * 10 + variant);
  const attack = 0.002 * sampleRate;
  const tail = 0.02 * sampleRate;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (let k = 0; k < partials.length; k++) {
      const [ratio, amp, tau] = partials[k];
      s += amp * Math.exp(-t / tau) * Math.sin(2 * Math.PI * freq * ratio * detune * t + variant * 0.7 * k);
    }
    if (click) s += click * Math.exp(-t / 0.008) * (rnd() * 2 - 1);
    s *= Math.min(1, i / attack) * Math.min(1, (n - i) / tail);
    out[i] = s;
    sq += s * s;
  }
  // 各层按相同 RMS 归一：层间只差音色，响度交给力度曲线
  const k = TARGET_RMS / Math.sqrt(sq / n);
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, out[i] * k));
  return out;
}
