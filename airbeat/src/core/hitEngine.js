// 判定层：每个"手 × 鼓"一个状态机（策划案 5.2.3、5.2.4）。
// 纯逻辑，不依赖浏览器或引擎，可用回放日志做单元测试。
import { HandTracker } from './tracker.js';
import { DEFAULTS, mergeConfig } from './config.js';
import { sub, dot, len, lerp, scale } from './vec.js';

export const S = { IDLE: 'IDLE', ARMED: 'ARMED', COOLDOWN: 'COOLDOWN', WAIT_REARM: 'WAIT_REARM', FROZEN: 'FROZEN' };

export class HitEngine {
  /** @param {{drums: Array<{id:string, center:number[], normal:number[], r:number}>, config?: object}} opts */
  constructor({ drums = [], config = {} } = {}) {
    this.cfg = mergeConfig(DEFAULTS, config);
    this.hands = new Map();
    this.setDrums(drums);
  }
  setConfig(patch) {
    this.cfg = mergeConfig(this.cfg, patch);
    for (const h of this.hands.values()) h.tracker.cfg = this.cfg;
  }
  setDrums(drums) {
    this.drums = drums;
    for (const h of this.hands.values()) h.states = this.#freshStates();
  }
  /** 最近一次采样后某只手的追踪结果（给校准与渲染用） */
  hand(id) {
    return this.hands.get(id)?.last ?? { valid: false };
  }
  stateOf(handId, drumId) {
    return this.hands.get(handId)?.states.get(drumId)?.state;
  }

  /**
   * @param {{t:number, hands:Array<{id:string, valid:boolean, p?:number[]}>}} sample t 为毫秒
   * @returns {Array<{type:'hit', hand:string, drum:string, drumIndex:number, t:number, tHit:number, vn:number, predicted:boolean, point:number[]}>}
   */
  push(sample) {
    const events = [];
    for (const hs of sample.hands) {
      const hand = this.#hand(hs.id);
      const r = hand.tracker.push(sample.t, hs.valid ? hs.p : null);
      if (r === null) continue; // 被丢弃的采样：保持原状态
      hand.last = r;
      if (!r.valid) {
        for (const st of hand.states.values()) {
          if (st.state !== S.FROZEN) {
            st.resume = st.state;
            st.state = S.FROZEN;
          }
        }
        continue;
      }
      if (r.fresh) {
        // 首次出现或丢失 ≥ 150ms：回 IDLE，不补判，第一个采样不参与穿越测试
        hand.states = this.#freshStates();
        hand.p0 = r.p;
        hand.t0 = sample.t;
        hand.v0 = null;
        continue;
      }
      this.#step(hs.id, hand, sample.t, r, events);
      hand.p0 = r.p;
      hand.t0 = sample.t;
      hand.v0 = r.v;
    }
    return events;
  }

  #hand(id) {
    let h = this.hands.get(id);
    if (!h) {
      h = { tracker: new HandTracker(this.cfg), states: this.#freshStates(), p0: null, t0: 0, v0: null, last: { valid: false } };
      this.hands.set(id, h);
    }
    return h;
  }
  #freshStates() {
    return new Map(this.drums.map((d) => [d.id, { state: S.IDLE, until: 0, resume: S.IDLE }]));
  }

  /** 点落在哪面鼓的判定圆内；重叠处归最近的鼓心 */
  #owner(point) {
    let best = null;
    let bestDist = Infinity;
    for (const d of this.drums) {
      const rel = sub(point, d.center);
      const inPlane = len(sub(rel, scale(d.normal, dot(rel, d.normal))));
      if (inPlane <= this.cfg.judgeRadiusScale * d.r && inPlane < bestDist) {
        best = d;
        bestDist = inPlane;
      }
    }
    return best;
  }

  #step(handId, hand, t, r, events) {
    const cfg = this.cfg;
    const { p, v } = r;
    const speed = len(v);
    const canCross = r.gapMs <= cfg.maxSampleGapMs; // 规则 6
    const owner = this.#owner(p);
    const cosMax = Math.cos((cfg.maxAngleDeg * Math.PI) / 180);

    this.drums.forEach((d, drumIndex) => {
      const st = hand.states.get(d.id);
      if (st.state === S.FROZEN) st.state = st.resume; // 丢失 < 150ms：回原状态

      const h1 = dot(sub(p, d.center), d.normal); // 离鼓面高度，上正下负
      const h0 = dot(sub(hand.p0, d.center), d.normal);
      const vn = -dot(v, d.normal); // 击入速度
      const inCircle = owner === d;

      // 规则 1：穿越。用两点连线与鼓面圆盘求交，穿越时刻线性插值。
      let cross = null;
      if (canCross && h0 > 0 && h1 <= 0) {
        const s = h0 / (h0 - h1);
        const point = lerp(hand.p0, p, s);
        if (this.#owner(point) === d) cross = { tHit: hand.t0 + s * (t - hand.t0), point };
      }

      if (st.state === S.COOLDOWN && t >= st.until) st.state = S.WAIT_REARM;
      if (st.state === S.WAIT_REARM && h1 >= cfg.rearmHeight) st.state = S.IDLE; // 规则 5
      // 高速时一步可能跨过整个预备区，所以穿越本身也能上膛
      if (st.state === S.IDLE && ((inCircle && h1 > 0 && h1 <= cfg.armHeight && vn > 0) || cross)) st.state = S.ARMED;
      if (st.state !== S.ARMED) return;

      const prevVn = hand.v0 ? -dot(hand.v0, d.normal) : null;
      const predicted =
        !cross &&
        cfg.predict.enabled &&
        inCircle &&
        h1 > 0 &&
        vn > 0 &&
        (h1 / vn) * 1000 <= cfg.predict.leadMs &&
        (prevVn === null || vn >= prevVn * (1 - cfg.predict.maxDecel)); // 未减速
      const angleOk = speed > 0 && vn / speed >= cosMax; // 规则 3

      if ((cross || predicted) && vn >= cfg.vMin && angleOk) {
        const tHit = cross ? cross.tHit : t + (h1 / vn) * 1000;
        events.push({
          type: 'hit',
          hand: handId,
          drum: d.id,
          drumIndex,
          t,
          tHit,
          vn,
          predicted,
          point: cross ? cross.point : sub(p, scale(d.normal, h1)),
        });
        st.state = S.COOLDOWN; // 规则 4
        st.until = Math.max(t, tHit) + cfg.cooldownMs;
      } else if (!inCircle || vn <= 0) {
        st.state = S.IDLE;
      }
    });
  }
}
