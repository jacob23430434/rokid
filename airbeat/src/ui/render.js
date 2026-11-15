// 表现层：黑底加发光线条（策划案 7.1）。Canvas 2D，无后处理。
import { particleCount, brightness } from '../core/velocity.js';
import { ENERGY_MAX } from '../core/judge.js';

const MAX_PARTICLES = 300;
const NOTE_LEAD_MS = 1600;
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const JUDGE_STYLE = { perfect: ['PERFECT', '#ffe066'], good: ['GOOD', '#7de0ff'], miss: ['MISS', '#ff6b6b'], protect: ['保护', '#aaaaaa'] };

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.particles = [];
    this.ripples = [];
    this.texts = [];
    this.flash = new Map(); // drumIndex → {t, vel}
    this.pulse = 0;
    this.resize();
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.W = r.width;
    this.H = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.S = this.W / this.world.w; // 像素每米
  }
  toScreen(p) {
    return [(p[0] / this.world.w + 0.5) * this.W, (0.5 - p[1] / this.world.h) * this.H];
  }
  toWorld(px, py) {
    return [(px / this.W - 0.5) * this.world.w, (0.5 - py / this.H) * this.world.h, 0];
  }

  /** 命中反馈：粒子、涟漪、鼓面下沉、鼓组脉冲（相机不动） */
  hit(drumIndex, drum, vel, now) {
    const [x, y] = this.toScreen(drum.center);
    const n = Math.min(particleCount(vel), MAX_PARTICLES - this.particles.length);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.25 + Math.random() * 0.6) * (0.6 + vel) * this.S;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a)) * sp * 0.9, t: now, life: 350 + Math.random() * 300, color: drum.color });
    }
    this.ripples.push({ drum: drumIndex, t: now, vel });
    this.flash.set(drumIndex, { t: now, vel });
    this.pulse = now;
  }
  judgeText(drum, result, now) {
    const [x, y] = this.toScreen(drum.center);
    const [text, color] = JUDGE_STYLE[result];
    this.texts.push({ x, y: y - 0.07 * this.S, text, color, t: now });
  }

  draw(st, now) {
    const { ctx, W, H, S } = this;
    ctx.clearRect(0, 0, W, H);
    // 鼓组整体缩放 1.5% 的脉冲，持续 60ms
    const pulse = now - this.pulse < 60 ? 1.015 : 1;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(pulse, pulse);
    ctx.translate(-W / 2, -H / 2);

    if (st.mode === 'calib') this.#calibDrum(st, now);
    st.drums.forEach((d, i) => this.#drum(d, i, st, now));
    if (st.mode === 'song') this.#notes(st);
    this.#ripples(st, now);
    ctx.restore();

    this.#particles(now);
    for (const id of ['L', 'R']) this.#hand(st.hands[id], now);
    this.#texts(now);
    if (st.mode === 'song') this.#hud(st);
  }

  #drum(d, i, st, now) {
    const { ctx, S } = this;
    const [x, y0] = this.toScreen(d.center);
    const f = this.flash.get(i);
    const age = f ? now - f.t : Infinity;
    const sink = age < 80 ? (1 - age / 80) * 0.01 * S : 0; // 下沉 1cm，80ms 弹回
    const glow = age < 400 ? (1 - age / 400) * (brightness(f.vel) - 0.5) : 0;
    const dim = st.usedDrums && !st.usedDrums.has(i) ? 0.3 : 1;
    const y = y0 + sink;
    const rx = d.r * S;
    const ry = rx * 0.32;
    ctx.save();
    ctx.globalAlpha = dim;
    ctx.shadowColor = d.color;
    ctx.shadowBlur = 12 + glow * 18;
    ctx.lineWidth = 2.5 + glow * 2;
    ctx.strokeStyle = d.color;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.globalAlpha = dim * Math.min(0.85, 0.12 + glow * 0.3);
    ctx.fillStyle = d.color;
    ctx.fill();
    ctx.globalAlpha = dim;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = dim * 0.75;
    ctx.font = `600 ${Math.max(11, rx * 0.2)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${d.note}${st.keys ? ' · ' + st.keys[i] : ''}`, x, y + ry + Math.max(16, rx * 0.3));
    ctx.restore();
  }

  #calibDrum(st, now) {
    const { ctx, S } = this;
    const [x, y] = this.toScreen([0, st.calibY ?? -0.05, 0]);
    const k = 0.5 + 0.5 * Math.sin(now / 280);
    ctx.save();
    ctx.shadowColor = '#ffd23d';
    ctx.shadowBlur = 20 + 25 * k;
    ctx.strokeStyle = '#ffd23d';
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.5 + 0.5 * k;
    ctx.beginPath();
    ctx.ellipse(x, y, 0.13 * S, 0.045 * S, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.12 + 0.12 * k;
    ctx.fillStyle = '#ffd23d';
    ctx.fill();
    ctx.restore();
  }

  #notes(st) {
    const { ctx, S, H } = this;
    for (const n of st.notes) {
      if (n.result) continue;
      const dt = n.tMs - st.songMs;
      if (dt > NOTE_LEAD_MS) break;
      if (dt < -160) continue;
      const d = st.drums[n.drum];
      const [x, yd] = this.toScreen(d.center);
      const k = Math.max(0, dt / NOTE_LEAD_MS);
      const y = yd - k * (yd + 20);
      const r = (n.accent ? 0.034 : 0.026) * S;
      ctx.save();
      ctx.shadowColor = d.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 收拢的光圈：到鼓边时正好是击打时刻
      ctx.globalAlpha = 0.55 * (1 - k);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(x, yd, d.r * S * (1 + 1.2 * k), d.r * S * 0.32 * (1 + 1.2 * k), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  #ripples(st, now) {
    const { ctx, S } = this;
    this.ripples = this.ripples.filter((r) => now - r.t < 450 && st.drums[r.drum]);
    for (const r of this.ripples) {
      const d = st.drums[r.drum];
      const [x, y] = this.toScreen(d.center);
      const k = (now - r.t) / 450;
      const rx = d.r * S * (1 + k * (0.5 + r.vel));
      ctx.save();
      ctx.globalAlpha = (1 - k) * (0.4 + 0.6 * r.vel);
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 1.5 + 2.5 * r.vel;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, rx * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  #particles(now) {
    const { ctx } = this;
    this.particles = this.particles.filter((p) => now - p.t < p.life);
    for (const p of this.particles) {
      const age = (now - p.t) / 1000;
      const k = (now - p.t) / p.life;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x + p.vx * age - 2, p.y + p.vy * age + 600 * age * age - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  #hand(h, now) {
    if (!h) return;
    const { ctx } = this;
    h.trail = (h.trail || []).filter((q) => now - q.t < 180);
    if (!h.valid) return;
    const [x, y] = this.toScreen(h.p);
    h.trail.push({ x, y, t: now });
    ctx.save();
    ctx.lineCap = 'round';
    if (h.outline) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of BONES) {
        ctx.moveTo(...this.toScreen(h.outline[a]));
        ctx.lineTo(...this.toScreen(h.outline[b]));
      }
      ctx.stroke();
    }
    if (h.fist && h.palm) {
      // 握拳：手前方出现光棒
      ctx.strokeStyle = '#fff';
      ctx.shadowColor = '#9fe8ff';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(...this.toScreen(h.palm));
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    // 光迹：让玩家确认"看到我的手了"
    ctx.shadowColor = '#9fe8ff';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(159,232,255,0.7)';
    for (let i = 1; i < h.trail.length; i++) {
      ctx.lineWidth = 1 + (7 * i) / h.trail.length;
      ctx.beginPath();
      ctx.moveTo(h.trail[i - 1].x, h.trail[i - 1].y);
      ctx.lineTo(h.trail[i].x, h.trail[i].y);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  #texts(now) {
    const { ctx } = this;
    this.texts = this.texts.filter((t) => now - t.t < 500);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 20px system-ui, sans-serif';
    for (const t of this.texts) {
      const k = (now - t.t) / 500;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y - 24 * k);
    }
    ctx.restore();
  }

  // 连击和能量贴在鼓组上方，与鼓同屏
  #hud(st) {
    const { ctx, W, H } = this;
    const j = st.judge;
    const cad = j.inCadenza(st.songMs);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.fillText(String(j.score), W / 2, 40);
    if (j.combo >= 2) {
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillStyle = '#ffe066';
      ctx.fillText(`${j.combo} 连击 ×${j.multiplier().toFixed(1)}`, W / 2, 62);
    }
    const bw = Math.min(260, W * 0.4);
    const k = cad ? Math.max(0, (j.cadenzaUntil - st.songMs) / (8 * j.beatMs)) : j.energy / ENERGY_MAX;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(W / 2 - bw / 2, 74, bw, 6);
    ctx.fillStyle = cad ? '#ff8a3d' : '#3dffb0';
    ctx.fillRect(W / 2 - bw / 2, 74, bw * k, 6);
    if (cad) {
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillStyle = '#ff8a3d';
      ctx.fillText('自由华彩 · 分数翻倍', W / 2, 100);
    }
    const prog = Math.min(1, Math.max(0, st.songMs / st.durationMs));
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(0, H - 3, W * prog, 3);
    ctx.restore();
  }
}
