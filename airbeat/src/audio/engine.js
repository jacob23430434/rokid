// 音频层（策划案 5.4）：低延迟发声、分层采样、轮转、限幅、按音频时钟调度伴奏。
import { renderTone, LAYER_COUNT, ROUND_ROBIN } from './synth.js';
import { gainDb, dbToLin, layerWeights } from '../core/velocity.js';

const MAX_VOICES = 16;
const FADE_S = 0.005;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.lastVariant = new Map();
    this.backing = null;
  }

  /** 必须在用户手势里调用 */
  async init(drums) {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      // 总线限幅 −1dBFS：多鼓叠加也不削波
      this.limiter = new DynamicsCompressorNode(this.ctx, { threshold: -1, knee: 0, ratio: 20, attack: 0.001, release: 0.05 });
      this.drumBus = new GainNode(this.ctx, { gain: 0.8 });
      this.backBus = new GainNode(this.ctx, { gain: 0.5 });
      this.drumBus.connect(this.limiter);
      this.backBus.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
    }
    await this.ctx.resume();
    const sr = this.ctx.sampleRate;
    // 短采样全部预生成：每面鼓 3 个力度层 × 4 个轮转采样
    this.buffers = drums.map((d) =>
      Array.from({ length: LAYER_COUNT }, (_, layer) =>
        Array.from({ length: ROUND_ROBIN }, (_, variant) => {
          const data = renderTone({ freq: d.freq, layer, variant, sampleRate: sr });
          const buf = this.ctx.createBuffer(1, data.length, sr);
          buf.copyToChannel(data, 0);
          return buf;
        }),
      ),
    );
    this.pans = drums.map((d) => Math.max(-1, Math.min(1, d.center[0] / 0.35))); // 左边的鼓从左边响
  }

  get latencyMs() {
    return this.ctx ? ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000 : 0;
  }
  get voiceCount() {
    return this.voices.length;
  }

  /** 发声。vel 为 0..1 的力度。 */
  hit(drumIndex, vel) {
    const ctx = this.ctx;
    if (!ctx || !this.buffers) return;
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    // 同一面鼓重复触发：旧声 5ms 淡出
    for (const v of this.voices) if (v.drum === drumIndex) this.#fade(v, now);
    this.voices = this.voices.filter((v) => v.drum !== drumIndex);

    const weights = layerWeights(vel);
    const jitterDb = (Math.random() * 2 - 1) * 1; // ±1dB
    const rate = 1 + (Math.random() * 2 - 1) * 0.03; // ±3% 音高
    const amp = dbToLin(gainDb(vel) + jitterDb);
    weights.forEach((w, layer) => {
      if (w <= 0) return;
      // 轮转发声：同层 4 个采样随机且不连续重复
      const key = drumIndex * 10 + layer;
      let variant = Math.floor(Math.random() * (ROUND_ROBIN - 1));
      if (variant >= (this.lastVariant.get(key) ?? -1) && this.lastVariant.has(key)) variant++;
      this.lastVariant.set(key, variant);

      while (this.voices.length >= MAX_VOICES) this.#fade(this.voices.shift(), now); // 超出上限淡出最旧的
      const src = new AudioBufferSourceNode(ctx, { buffer: this.buffers[drumIndex][layer][variant], playbackRate: rate });
      const gain = new GainNode(ctx, { gain: amp * Math.sqrt(w) }); // 等功率交叉淡化
      const pan = new StereoPannerNode(ctx, { pan: this.pans[drumIndex] });
      src.connect(gain).connect(pan).connect(this.drumBus);
      src.start();
      this.voices.push({ drum: drumIndex, src, gain, end: now + src.buffer.duration / rate });
    });
  }

  #fade(v, now) {
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + FADE_S);
    v.src.stop(now + FADE_S + 0.001);
  }

  // ---- 伴奏：按音频时钟调度，不用帧时间 ----

  /** @param {Array} events buildBacking() 的结果 @returns {number} 曲首对应的 ctx 时刻（秒） */
  startBacking(events, delay = 0.4) {
    this.stopBacking();
    const b = { events, i: 0, start: this.ctx.currentTime + delay, nodes: new Set() };
    b.timer = setInterval(() => this.#pump(b), 40);
    this.backing = b;
    this.#pump(b);
    return b.start;
  }
  stopBacking() {
    const b = this.backing;
    if (!b) return;
    clearInterval(b.timer);
    for (const n of b.nodes) {
      try {
        n.stop();
      } catch {}
    }
    this.backing = null;
  }
  /** 当前"听到的"曲内时刻（毫秒）：扣掉输出延迟 */
  songMs(perfNow = performance.now()) {
    const b = this.backing;
    if (!b) return 0;
    const ctxNow = this.ctx.currentTime + (perfNow - performance.now()) / 1000;
    return (ctxNow - b.start) * 1000 - this.latencyMs;
  }

  #pump(b) {
    const horizon = this.ctx.currentTime + 0.3;
    while (b.i < b.events.length && b.start + b.events[b.i].t < horizon) this.#play(b, b.events[b.i++]);
  }
  #play(b, e) {
    const t = b.start + e.t;
    const tone = (type, freq, dur, peak, attack) => {
      const osc = new OscillatorNode(this.ctx, { type, frequency: freq });
      const g = new GainNode(this.ctx, { gain: 0 });
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.backBus);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      b.nodes.add(osc);
      osc.onended = () => b.nodes.delete(osc);
    };
    if (e.type === 'bass') tone('triangle', e.freq, e.dur, 0.5, 0.01);
    else if (e.type === 'pad') for (const f of e.freqs) tone('sine', f, e.dur, 0.12, 0.25);
    else if (e.type === 'click') tone('square', e.accent ? 1568 : 1046.5, 0.06, 0.18, 0.001);
    else if (e.type === 'tick') tone('square', e.accent ? 3136 : 2093, 0.03, e.accent ? 0.05 : 0.025, 0.001);
  }
}
