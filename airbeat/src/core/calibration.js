// 开局自适应校准：3 次试挥（策划案 5.2.4）。
import { clamp, median } from './vec.js';

export const CALIB_SWINGS = 3;

/** 不依赖鼓位的挥击检测：鼓去找手，不让手去找鼓。 */
export class SwingDetector {
  constructor({ vStart = 0.3, minDrop = 0.05 } = {}) {
    Object.assign(this, { vStart, minDrop });
    this.active = false;
  }
  /** @returns {null | {t:number, peak:number, lowY:number}} */
  push(t, p, v) {
    const down = -v[1];
    if (!this.active) {
      if (down >= this.vStart) {
        this.active = true;
        this.peak = down;
        this.startY = p[1];
        this.lowY = p[1];
      }
      return null;
    }
    this.peak = Math.max(this.peak, down);
    this.lowY = Math.min(this.lowY, p[1]);
    if (down > 0.05) return null;
    this.active = false;
    if (this.startY - this.lowY < this.minDrop) return null;
    return { t, peak: this.peak, lowY: this.lowY };
  }
  reset() {
    this.active = false;
  }
}

export function thresholds(vRef) {
  return {
    vRef,
    vMin: clamp(0.35 * vRef, 0.4, 1.2),
    vMax: clamp(1.8 * vRef, 2.5, 6.0),
  };
}

/** @param {Array<{peak:number, lowY:number}>} swings */
export function calibrate(swings) {
  return {
    ...thresholds(median(swings.map((s) => s.peak))),
    drumHeight: median(swings.map((s) => s.lowY)) + 0.02,
  };
}

/** 游玩中持续修正：每 10 秒把 v_ref 向最近 20 次击打速度的中位数移动最多 10%。 */
export class AdaptiveRef {
  constructor(vRef, { periodMs = 10000, window = 20, maxStep = 0.1 } = {}) {
    Object.assign(this, { vRef, periodMs, window, maxStep });
    this.hits = [];
    this.lastT = null;
  }
  record(vn) {
    this.hits.push(vn);
    if (this.hits.length > this.window) this.hits.shift();
  }
  /** @returns {null | {vRef:number, vMin:number, vMax:number}} 有更新时返回新阈值 */
  tick(t) {
    if (this.lastT === null) this.lastT = t;
    if (t - this.lastT < this.periodMs) return null;
    this.lastT = t;
    if (this.hits.length < 5) return null;
    const target = median(this.hits);
    this.vRef = clamp(target, this.vRef * (1 - this.maxStep), this.vRef * (1 + this.maxStep));
    return thresholds(this.vRef);
  }
}
