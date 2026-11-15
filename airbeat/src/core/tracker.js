// 追踪层：滤波、速度估计、丢失与跳变检测（策划案 5.2.1）。
import { OneEuro3 } from './oneEuro.js';
import { sub, len, median } from './vec.js';

export class HandTracker {
  constructor(cfg) {
    this.cfg = cfg;
    this.filter = new OneEuro3(cfg.oneEuro);
    this.reset();
  }
  reset() {
    this.filter.reset();
    this.lastT = null; // 上一个被接受的采样时刻 ms
    this.lastRaw = null;
    this.lastP = null;
    this.vHist = [];
    this.jumps = 0;
  }
  /**
   * @param {number} t 采样时刻 ms
   * @param {number[]|null} raw 判定点位置；null 表示追踪无效
   * @returns {null | {valid:false} | {valid:true, fresh:boolean, p:number[], v:number[], gapMs:number}}
   *   null = 采样被丢弃（跳变或时间倒流），调用方保持原状态。
   *   fresh = 没有可用历史（首次出现或丢失过久），该采样不参与穿越测试。
   */
  push(t, raw) {
    if (!raw) return { valid: false };
    if (this.lastT !== null) {
      const gap = t - this.lastT;
      if (gap <= 0) return null;
      if (gap >= this.cfg.freezeResumeMs) this.reset();
    }
    if (this.lastT === null) return this.#start(t, raw);

    const dt = (t - this.lastT) / 1000;
    if (len(sub(raw, this.lastRaw)) / dt > this.cfg.maxSpeed) {
      // 追踪跳变：丢弃。连续两次说明手确实换了位置，从新位置重新开始。
      if (++this.jumps < 2) return null;
      this.reset();
      return this.#start(t, raw);
    }
    this.jumps = 0;

    const p = this.filter.filter(raw, t / 1000);
    const vi = sub(p, this.lastP).map((c) => c / dt);
    this.vHist.push(vi);
    if (this.vHist.length > 3) this.vHist.shift();
    // 最近 3 个采样的中位数，去掉单点尖峰
    const v = [0, 1, 2].map((k) => median(this.vHist.map((h) => h[k])));
    const gapMs = t - this.lastT;
    this.lastT = t;
    this.lastRaw = raw;
    this.lastP = p;
    return { valid: true, fresh: false, p, v, gapMs };
  }
  #start(t, raw) {
    const p = this.filter.filter(raw, t / 1000);
    this.lastT = t;
    this.lastRaw = raw;
    this.lastP = p;
    return { valid: true, fresh: true, p, v: [0, 0, 0], gapMs: 0 };
  }
}
