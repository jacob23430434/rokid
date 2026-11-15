// 在浏览器里按原始时间间隔播放回放日志
export class ReplayPlayer {
  constructor(log, onSample, onEnd) {
    Object.assign(this, { log, onSample, onEnd });
    this.i = 0;
    this.raf = 0;
  }
  start() {
    const base = this.log.samples[0]?.t ?? 0;
    const t0 = performance.now();
    const tick = (now) => {
      const s = this.log.samples;
      while (this.i < s.length && s[this.i].t - base <= now - t0) {
        this.onSample({ t: t0 + s[this.i].t - base, hands: s[this.i].hands });
        this.i++;
      }
      if (this.i >= s.length) return this.onEnd?.();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop() {
    cancelAnimationFrame(this.raf);
  }
}
