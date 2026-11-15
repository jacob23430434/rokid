// 1€ 滤波（Casiez 等，CHI 2012）：慢时稳，快时跟手。
const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuro {
  constructor({ minCutoff = 1, beta = 0, dCutoff = 1 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.reset();
  }
  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }
  /** @param {number} x 原始值 @param {number} t 秒 */
  filter(x, t) {
    if (this.x === null) {
      this.x = x;
      this.t = t;
      return x;
    }
    const dt = t - this.t;
    if (dt <= 0) return this.x;
    const dx = (x - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (x - this.x);
    this.t = t;
    return this.x;
  }
}

export class OneEuro3 {
  constructor(opts) {
    this.f = [new OneEuro(opts), new OneEuro(opts), new OneEuro(opts)];
  }
  reset() {
    this.f.forEach((f) => f.reset());
  }
  filter(p, t) {
    return [this.f[0].filter(p[0], t), this.f[1].filter(p[1], t), this.f[2].filter(p[2], t)];
  }
}
