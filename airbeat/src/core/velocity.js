// 力度映射（策划案 5.2.5）。
import { clamp } from './vec.js';

export const LAYER_BOUNDS = [0.35, 0.7];
const XFADE = 0.05;

/** 击入速度 → 力度 0..1。用个人校准值归一化，曲线 x^1.3。 */
export function mapVelocity(vn, vMin, vMax) {
  const x = clamp((vn - vMin) / (vMax - vMin), 0, 1);
  return Math.pow(x, 1.3);
}

/** vel = 0 时 −20dB，vel = 1 时 0dB，按 dB 线性 */
export const gainDb = (vel) => -20 + 20 * vel;
export const dbToLin = (db) => Math.pow(10, db / 20);

/** 轻 / 中 / 强三层权重，边界 ±0.05 内交叉淡化。返回 [soft, mid, hard]，和为 1。 */
export function layerWeights(vel) {
  const up = (b) => clamp((vel - (b - XFADE)) / (2 * XFADE), 0, 1);
  const a = up(LAYER_BOUNDS[0]);
  const b = up(LAYER_BOUNDS[1]);
  return [1 - a, a - b, b];
}

export const layerOf = (vel) => (vel > LAYER_BOUNDS[1] ? 2 : vel >= LAYER_BOUNDS[0] ? 1 : 0);
export const particleCount = (vel) => Math.min(32, Math.round(8 + 24 * vel));
export const brightness = (vel) => 1 + 2 * vel;
