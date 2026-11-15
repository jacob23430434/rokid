// 回放日志：手部数据带时间戳落盘，可离线逐帧回放调参（策划案 5.1）。
export const REPLAY_VERSION = 1;

export class Recorder {
  constructor(meta = {}) {
    this.meta = meta;
    this.samples = [];
  }
  push(sample) {
    this.samples.push({
      t: Math.round(sample.t * 100) / 100,
      hands: sample.hands.map((h) => (h.valid ? { id: h.id, valid: true, p: h.p.map((c) => Math.round(c * 1e5) / 1e5) } : { id: h.id, valid: false })),
    });
  }
  toJSON() {
    return { version: REPLAY_VERSION, ...this.meta, samples: this.samples };
  }
}

/** 把整份日志一次性喂给判定层，返回全部击打事件 */
export function replayAll(engine, log) {
  const events = [];
  for (const s of log.samples) events.push(...engine.push(s));
  return events;
}
