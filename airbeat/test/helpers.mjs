// 合成手部轨迹：从鼓面上方匀速击入，穿过鼓面后抬回。
export function swing({ x = 0, z = 0, plane = 0, tCross, speed = 2, top = 0.2, depth = 0.05, upSpeed = 1.2, vx = 0 }) {
  const tStart = tCross - (top / speed) * 1000;
  const tBottom = tCross + (depth / speed) * 1000;
  const tEnd = tBottom + ((top + depth) / upSpeed) * 1000;
  return {
    tStart,
    tEnd,
    /** @returns {number[]|null} */
    at(t) {
      if (t < tStart || t > tEnd) return null;
      const y = t <= tBottom ? plane + top - (speed * (t - tStart)) / 1000 : plane - depth + (upSpeed * (t - tBottom)) / 1000;
      return [x + (vx * (t - tCross)) / 1000, y, z];
    },
  };
}

/** 把若干段挥击采样成回放日志格式；挥击之间手停在上方 */
export function sampleSwings(swings, { fps = 30, hand = 'R', t0, t1, rest = [0, 0.2, 0], phase = 0, lost = () => false } = {}) {
  const dt = 1000 / fps;
  const start = t0 ?? Math.min(...swings.map((s) => s.tStart)) - 200;
  const end = t1 ?? Math.max(...swings.map((s) => s.tEnd)) + 200;
  const samples = [];
  let last = rest;
  for (let t = start + phase; t <= end; t += dt) {
    if (lost(t)) {
      samples.push({ t, hands: [{ id: hand, valid: false }] });
      continue;
    }
    const active = swings.find((s) => s.at(t));
    const p = active ? active.at(t) : [last[0], rest[1], last[2]];
    last = p;
    samples.push({ t, hands: [{ id: hand, valid: true, p }] });
  }
  return samples;
}
