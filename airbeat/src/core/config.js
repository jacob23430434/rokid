// 判定层参数。全部是策划案 5.2 的初值，实机到手后用实测数据替换。
export const DEFAULTS = {
  judgeRadiusScale: 1.25, // 判定半径 = 1.25 r
  armHeight: 0.12, // 预备区：鼓面上方 0-12cm
  rearmHeight: 0.03, // 回位高度：鼓面上方 3cm
  vMin: 0.5, // 击入速度门限 m/s，由校准覆盖
  maxAngleDeg: 50, // 速度方向与击入方向夹角上限
  cooldownMs: 80, // 同手同鼓冷却
  maxSampleGapMs: 100, // 规则 6：相邻有效采样间隔上限
  freezeResumeMs: 150, // 丢失短于此值恢复原状态，否则回 IDLE
  maxSpeed: 8, // 超过视为追踪跳变，丢弃
  predict: { enabled: false, leadMs: 30, maxDecel: 0.3 },
  // 合成轨迹上调过：dCutoff 取 1Hz 时滤波滞后会让穿越时刻晚约 15ms，取 20Hz 降到 5ms 内
  oneEuro: { minCutoff: 1.5, beta: 30, dCutoff: 20 },
};

export function mergeConfig(base, patch = {}) {
  return {
    ...base,
    ...patch,
    predict: { ...base.predict, ...(patch.predict || {}) },
    oneEuro: { ...base.oneEuro, ...(patch.oneEuro || {}) },
  };
}
