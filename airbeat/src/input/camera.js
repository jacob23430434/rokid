// 摄像头 + MediaPipe Hands 输入（策划案 5.1：没有实机时用开源手部追踪采集数据）。
// 只能验证逻辑，不能验证手感：普通摄像头没有深度，延迟也远高于眼镜。
const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const TIP_EXTEND = 0.08; // 握拳时判定点前伸 8cm
const HAND_LEN = 0.09; // 腕到中指根的典型长度，用来把 8cm 换算成画面比例

export class CameraInput {
  /**
   * @param {HTMLVideoElement} video
   * @param {{w:number, h:number}} world 画面对应的世界尺寸（米）
   */
  constructor(video, world, onSample) {
    Object.assign(this, { video, world, onSample });
    this.ext = { L: 0, R: 0 };
    this.fist = { L: false, R: false };
    this.running = false;
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
      audio: false,
    });
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    // 画面按 16:9 裁切显示（object-fit: cover），关键点坐标要按同样的裁切换算
    const ratio = this.video.videoWidth / this.video.videoHeight / (this.world.w / this.world.h);
    this.crop = ratio >= 1 ? { x: 1 / ratio, y: 1 } : { x: 1, y: ratio };

    const { FilesetResolver, HandLandmarker } = await import(`${MP_BASE}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate) =>
      HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 2 });
    this.landmarker = await make('GPU').catch(() => make('CPU'));

    this.running = true;
    this.lastTime = -1;
    const useRvfc = 'requestVideoFrameCallback' in this.video;
    const loop = (now, meta) => {
      if (!this.running) return;
      // 有采集时间戳就用它：采样间隔更准，也省掉一部分固定偏移
      this.hasCaptureTime = meta?.captureTime != null;
      this.#frame(meta?.captureTime ?? now);
      useRvfc ? this.video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    };
    useRvfc ? this.video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.landmarker?.close();
  }

  #frame(t) {
    if (this.video.currentTime === this.lastTime) return; // 没有新图像
    this.lastTime = this.video.currentTime;
    const res = this.landmarker.detectForVideo(this.video, t);
    const hands = { L: { id: 'L', valid: false }, R: { id: 'R', valid: false } };
    (res.landmarks || []).forEach((lm, i) => {
      let id = res.handednesses?.[i]?.[0]?.categoryName === 'Left' ? 'L' : 'R';
      if (hands[id].valid) id = id === 'L' ? 'R' : 'L'; // 判定不区分左右手，标签重复时占另一个槽
      hands[id] = { id, valid: true, ...this.#point(id, lm, t) };
    });
    this.onSample({ t, hands: [hands.L, hands.R] });
  }

  /** 关键点 → 判定点（世界坐标）。画面做镜像，玩家像照镜子。 */
  #point(id, lm, t) {
    const { w, h } = this.world;
    const toWorld = (p) => [((0.5 - p.x) / this.crop.x) * w, ((0.5 - p.y) / this.crop.y) * h, 0];
    const wrist = toWorld(lm[0]);
    const mcp = toWorld(lm[9]);
    const palm = [0, 5, 17].map((k) => toWorld(lm[k])).reduce((a, b) => [a[0] + b[0] / 3, a[1] + b[1] / 3, 0], [0, 0, 0]);
    const handLen = Math.hypot(mcp[0] - wrist[0], mcp[1] - wrist[1]) || 1e-6;
    // 握拳：四个指尖都收到手掌附近。半握也算。
    const curl = [8, 12, 16, 20].map((k) => toWorld(lm[k])).reduce((s, tip) => s + Math.hypot(tip[0] - wrist[0], tip[1] - wrist[1]), 0) / 4 / handLen;
    const fist = curl < 1.45;
    this.fist[id] = fist;
    // 前伸量平滑过渡，手型识别抖动时判定点不突跳
    const dt = Math.min(0.1, Math.max(0, (t - (this.lastT ?? t)) / 1000));
    this.ext[id] += ((fist ? 1 : 0) - this.ext[id]) * Math.min(1, dt / 0.15);
    const k = (this.ext[id] * TIP_EXTEND) / HAND_LEN;
    this.lastT = t;
    return {
      p: [palm[0] + (mcp[0] - wrist[0]) * k, palm[1] + (mcp[1] - wrist[1]) * k, 0],
      palm,
      fist,
      outline: lm.map(toWorld),
    };
  }
}
