// 布局模板（策划案 5.3.5）。位置以胸前为原点：x 左右，z 向前的水平距离，y 相对校准高度。
const UP = [0, 1, 0];
const F = { A3: 220.0, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0, C5: 523.25, D5: 587.33 };
const COLORS = { C4: '#ff8a3d', E4: '#ffd23d', G4: '#3dffb0', C5: '#3db8ff', A3: '#ff5a5a', D4: '#ffb03d', A4: '#6dff3d', D5: '#b07dff' };

const drum = (id, note, x, z, r = 0.08) => ({ id, note, freq: F[note], color: COLORS[note], center: [x, 0, z], normal: UP, r });

/** 4 鼓入门（田字）：实机用。 */
export const LAYOUT_4 = [
  drum('nl', 'C4', -0.095, 0.42),
  drum('nr', 'E4', 0.095, 0.42),
  drum('fl', 'G4', -0.095, 0.6),
  drum('fr', 'C5', 0.095, 0.6),
];

/** 8 鼓标准：中间 4 面与入门布局完全相同。 */
export const LAYOUT_8 = [
  ...LAYOUT_4,
  drum('nlo', 'A3', -0.28, 0.4),
  drum('nro', 'D4', 0.28, 0.4),
  drum('flo', 'A4', -0.3, 0.58),
  drum('fro', 'D5', 0.3, 0.58),
];

/**
 * 摄像头原型用的一字排开布局。
 * 普通摄像头没有可靠深度，前后两排无法区分，所以把田字的 4 面鼓摊成一排，间距不变（19cm）。
 */
export const LAYOUT_ROW4 = [
  drum('d0', 'C4', -0.285, 0),
  drum('d1', 'E4', -0.095, 0),
  drum('d2', 'G4', 0.095, 0),
  drum('d3', 'C5', 0.285, 0),
];

/** 把模板放到校准高度上 */
export const placeLayout = (layout, height) => layout.map((d) => ({ ...d, center: [d.center[0], height, d.center[2]] }));
