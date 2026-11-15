// 鼠标 / 触屏输入：没有摄像头时用来验证逻辑。
// 按指针事件自身的时间戳采样。逐帧重复采样会在事件频率低于帧率时产生"走一步停一步"的假速度。
const HOLD_MS = 50; // 指针静止超过这么久，补一个原地采样，保持追踪连续

export class PointerInput {
  /** @param {HTMLElement} el @param {(x:number,y:number)=>number[]} toWorld 屏幕像素 → 世界坐标 */
  constructor(el, toWorld, onSample) {
    Object.assign(this, { el, toWorld, onSample });
    this.pos = null;
    this.lastEmit = 0;
    this.raf = 0;
    this.move = (e) => {
      const r = el.getBoundingClientRect();
      this.pos = [e.clientX - r.left, e.clientY - r.top];
      this.#emit(e.timeStamp);
    };
    this.leave = () => (this.pos = null);
  }
  #emit(t) {
    if (t <= this.lastEmit) return;
    this.lastEmit = t;
    this.onSample({ t, hands: [this.pos ? { id: 'R', valid: true, p: this.toWorld(...this.pos) } : { id: 'R', valid: false }] });
  }
  start() {
    for (const ev of ['pointermove', 'pointerdown']) this.el.addEventListener(ev, this.move);
    for (const ev of ['pointerleave', 'pointercancel']) this.el.addEventListener(ev, this.leave);
    const tick = (t) => {
      this.raf = requestAnimationFrame(tick);
      if (!this.pos || t - this.lastEmit > HOLD_MS) this.#emit(t);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop() {
    cancelAnimationFrame(this.raf);
    for (const ev of ['pointermove', 'pointerdown']) this.el.removeEventListener(ev, this.move);
    for (const ev of ['pointerleave', 'pointercancel']) this.el.removeEventListener(ev, this.leave);
  }
}
