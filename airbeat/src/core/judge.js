// 节奏判定与计分（策划案 4.3）。
import { LAYER_BOUNDS } from './velocity.js';

export const WINDOWS = {
  normal: { perfect: 45, good: 100 },
  easy: { perfect: 70, good: 140 }, // 1-2 星放宽
};
export const windowsFor = (stars) => (stars <= 2 ? WINDOWS.easy : WINDOWS.normal);

const BASE = { perfect: 100, good: 60 };
const ENERGY = { perfect: 2, good: 1, miss: -4 };
export const ENERGY_MAX = 40;
const CADENZA_BEATS = 8;
const PROTECT_MS = 100;

export function grade(rate) {
  return rate >= 0.95 ? 'S' : rate >= 0.85 ? 'A' : rate >= 0.7 ? 'B' : 'C';
}

export class Judge {
  /**
   * @param {Array<{tMs:number, drum:number, accent:boolean}>} notes 已按时间排序
   * @param {{stars:number, beatMs:number}} opts
   */
  constructor(notes, { stars, beatMs }) {
    this.notes = notes.map((n) => ({ ...n, result: null }));
    this.win = windowsFor(stars);
    this.beatMs = beatMs;
    this.cursor = 0;
    this.score = 0;
    this.baseScore = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.energy = 0;
    this.cadenzaUntil = -Infinity;
    this.counts = { perfect: 0, good: 0, miss: 0, protect: 0 };
    this.deltas = [];
    this.strays = 0;
  }
  inCadenza(tMs) {
    return tMs < this.cadenzaUntil;
  }
  multiplier() {
    return Math.min(2, 1 + 0.1 * Math.floor(this.combo / 10));
  }

  /**
   * 一次击打。时刻应已扣掉设备固定偏移。
   * @returns {{result:'perfect'|'good', note:object, delta:number, gained:number} | null} null = 没有可判的音符
   */
  hit(drum, tMs, vel) {
    const note = this.notes.find((n) => !n.result && n.drum === drum && Math.abs(tMs - n.tMs) <= this.win.good);
    if (!note) {
      this.strays++;
      return null;
    }
    const delta = tMs - note.tMs;
    const result = Math.abs(delta) <= this.win.perfect ? 'perfect' : 'good';
    note.result = result;
    this.counts[result]++;
    this.deltas.push(delta);
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.baseScore += BASE[result];
    let gained = BASE[result] * this.multiplier();
    if (note.accent && vel > LAYER_BOUNDS[1]) gained *= 1.2; // 重音音符在强层命中 +20%
    if (this.inCadenza(tMs)) gained *= 2;
    this.score += Math.round(gained);
    this.#addEnergy(ENERGY[result], tMs);
    return { result, note, delta, gained: Math.round(gained) };
  }

  /**
   * 推进时间，结算过期音符。
   * @param {(t0:number, t1:number)=>boolean} hadTracking 该时间段内手部是否有过有效追踪
   * @returns {Array<{result:'miss'|'protect', note:object}>}
   */
  update(nowMs, hadTracking = () => true) {
    const out = [];
    while (this.cursor < this.notes.length) {
      const n = this.notes[this.cursor];
      if (n.result) {
        this.cursor++;
        continue;
      }
      // 等到保护窗口也过完再结算
      if (nowMs <= n.tMs + Math.max(this.win.good, PROTECT_MS)) break;
      if (hadTracking(n.tMs - PROTECT_MS, n.tMs + PROTECT_MS)) {
        n.result = 'miss';
        this.combo = 0;
        this.#addEnergy(ENERGY.miss, nowMs);
      } else {
        n.result = 'protect'; // 追踪丢失：不加分，不断连击
      }
      this.counts[n.result]++;
      out.push({ result: n.result, note: n });
      this.cursor++;
    }
    return out;
  }

  #addEnergy(d, tMs) {
    if (this.inCadenza(tMs)) return;
    this.energy = Math.max(0, Math.min(ENERGY_MAX, this.energy + d));
    if (this.energy >= ENERGY_MAX) {
      this.energy = 0;
      this.cadenzaUntil = tMs + CADENZA_BEATS * this.beatMs; // 自由华彩：分数翻倍
    }
  }

  get done() {
    return this.notes.every((n) => n.result);
  }
  summary() {
    const total = this.notes.length;
    const rate = total ? this.baseScore / (100 * total) : 0;
    const mean = this.deltas.length ? this.deltas.reduce((a, b) => a + b, 0) / this.deltas.length : 0;
    return {
      total,
      score: this.score,
      rate,
      grade: grade(rate),
      maxCombo: this.maxCombo,
      counts: { ...this.counts },
      meanDeltaMs: mean,
      protectRatio: total ? this.counts.protect / total : 0,
      strays: this.strays,
    };
  }
}

/** 记录有效采样时刻，供"保护"判定查询 */
export class TrackingLog {
  constructor(keepMs = 3000) {
    this.keepMs = keepMs;
    this.times = [];
  }
  push(tMs) {
    this.times.push(tMs);
    while (this.times.length && tMs - this.times[0] > this.keepMs) this.times.shift();
  }
  hadTracking = (t0, t1) => this.times.some((t) => t >= t0 && t <= t1);
}
