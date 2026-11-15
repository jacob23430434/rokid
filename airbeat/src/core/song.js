// 首曲《初光》：原创，伴奏由规则生成，没有授权风险（策划案 7.4）。
export const SONG = {
  id: 'first-light',
  title: '初光',
  bpm: 88,
  beatsPerBar: 4,
  bars: 22, // 60 秒
  playFromBar: 2,
  playToBar: 20, // 第 20 小节第 1 拍是收尾音
};

export const songDurationMs = (song) => (song.bars * song.beatsPerBar * 60000) / song.bpm;

// C - Am - F - G，五声音阶鼓组在任意和弦上都不刺耳
const CHORDS = [
  { bass: 65.41, pad: [130.81, 164.81, 196.0] },
  { bass: 55.0, pad: [110.0, 130.81, 164.81] },
  { bass: 87.31, pad: [174.61, 220.0, 261.63] },
  { bass: 98.0, pad: [196.0, 246.94, 293.66] },
];

/** 伴奏事件表，按时间排序。t、dur 单位秒，相对曲首。 */
export function buildBacking(song) {
  const beat = 60 / song.bpm;
  const ev = [];
  for (let bar = 0; bar < song.bars; bar++) {
    const t0 = bar * song.beatsPerBar * beat;
    const outro = bar >= song.playToBar;
    const chord = outro ? CHORDS[0] : CHORDS[bar % 4];
    if (bar === 0) {
      // 预备拍
      for (let b = 0; b < song.beatsPerBar; b++) ev.push({ t: t0 + b * beat, type: 'click', accent: b === 0 });
      continue;
    }
    if (outro) {
      if (bar === song.playToBar) {
        ev.push({ t: t0, type: 'pad', freqs: chord.pad, dur: 2 * song.beatsPerBar * beat });
        ev.push({ t: t0, type: 'bass', freq: chord.bass, dur: 4 * beat });
      }
      continue;
    }
    ev.push({ t: t0, type: 'pad', freqs: chord.pad, dur: song.beatsPerBar * beat });
    for (let b = 0; b < song.beatsPerBar; b++) {
      ev.push({ t: t0 + b * beat, type: 'tick', accent: b === 0 });
      if (bar >= song.playFromBar && b % 2 === 0) ev.push({ t: t0 + b * beat, type: 'bass', freq: chord.bass, dur: 1.6 * beat });
    }
  }
  return ev.sort((a, b) => a.t - b.t);
}
