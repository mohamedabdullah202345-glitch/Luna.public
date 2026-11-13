import { memo, useEffect, useRef, useState } from 'react';
import { CallStatus } from '../hooks/useLiveCall';
import { RoomScene } from '../types';

interface LunaCharacterProps {
  status: CallStatus;
  lunaLevel: number;
  micLevel: number;
  isLunaSpeaking: boolean;
  muted: boolean;
  scene?: RoomScene;
  lampOn?: boolean;
}

const AVATAR_SRC = '/luna-avatar.png';
const GRID = 14;

// Exact normalized coordinates measured from luna-avatar.png (2500x2500)
const LEFT_EYE = { u: 0.426, v: 0.453, rw: 0.044, rh: 0.042 };
const RIGHT_EYE = { u: 0.593, v: 0.453, rw: 0.044, rh: 0.042 };
const MOUTH = { u: 0.51, v: 0.5455 };
const LEFT_CHEEK = { u: 0.396, v: 0.518 };
const RIGHT_CHEEK = { u: 0.622, v: 0.518 };

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

interface RigState {
  isLive: boolean;
  isConnecting: boolean;
  isLunaSpeaking: boolean;
  muted: boolean;
  lunaLevel: number;
  micLevel: number;
  scene: RoomScene;
  lampOn: boolean;
}

export const LunaCharacter = memo(function LunaCharacter({
  status,
  lunaLevel,
  micLevel,
  isLunaSpeaking,
  muted,
  scene = 'lamp',
  lampOn = true,
}: LunaCharacterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const rigRef = useRef<RigState>({
    isLive: status === 'live',
    isConnecting: status === 'connecting',
    isLunaSpeaking,
    muted,
    lunaLevel,
    micLevel,
    scene,
    lampOn,
  });

  useEffect(() => {
    rigRef.current = {
      isLive: status === 'live',
      isConnecting: status === 'connecting',
      isLunaSpeaking,
      muted,
      lunaLevel,
      micLevel,
      scene,
      lampOn,
    };
  }, [isLunaSpeaking, lampOn, lunaLevel, micLevel, muted, scene, status]);

  useEffect(() => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      imgRef.current = img;
      setImgLoaded(true);
    };
    img.onerror = () => {
      setImgFailed(true);
    };
    img.src = AVATAR_SRC;
  }, []);

  useEffect(() => {
    if (!imgLoaded || !imgRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = imgRef.current;
    if (!ctx) return;

    let rafId = 0;
    let blinkTimer = 0;
    let blinkPhase = 0;
    let nextBlinkAt = performance.now() + 2100;
    let doubleBlinkPending = false;

    let earTimer = 0;
    let nextEarAt = performance.now() + 3200;
    let earImpulse = 0;
    let earSide = 1;

    let smoothLuna = 0;
    let smoothMic = 0;
    let smoothHeadTilt = 0;
    let smoothHeadNod = 0;

    const size = 560;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    // Pre-scale the 2500x2500 PNG once into a cached texture matching the canvas resolution
    // so 392 clipped triangle draw calls per frame don't resample a massive 2500x2500 bitmap.
    const texCanvas = document.createElement('canvas');
    const texSize = Math.round(size * dpr);
    texCanvas.width = texSize;
    texCanvas.height = texSize;
    const texCtx = texCanvas.getContext('2d');
    if (texCtx) {
      texCtx.drawImage(img, 0, 0, texSize, texSize);
    }
    const textureSource: CanvasImageSource = texCtx ? texCanvas : img;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let disposed = false;

    const renderFrame = (now: number) => {
      if (disposed) return;
      const t = now / 1000;
      const rig = rigRef.current;
      const listening =
        rig.isLive && !rig.muted && !rig.isLunaSpeaking && rig.micLevel > 0.05;

      smoothLuna += (rig.lunaLevel - smoothLuna) * 0.34;
      smoothMic += (rig.micLevel - smoothMic) * 0.25;

      // Natural blinking scheduler
      if (now >= nextBlinkAt && blinkPhase === 0) {
        blinkPhase = 0.001;
        blinkTimer = now;
        doubleBlinkPending = Math.random() < 0.24;
      }
      let blinkAmount = 0;
      if (blinkPhase > 0) {
        const elapsed = now - blinkTimer;
        const duration = 190;
        if (elapsed < duration) {
          const p = elapsed / duration;
          blinkAmount = Math.sin(p * Math.PI);
        } else {
          blinkPhase = 0;
          if (doubleBlinkPending) {
            doubleBlinkPending = false;
            nextBlinkAt = now + 95;
          } else {
            nextBlinkAt = now + 2400 + Math.random() * 2600;
          }
        }
      }

      // Independent fox ear twitch scheduler + reactive ear perk when listening
      if (now >= nextEarAt && earTimer === 0) {
        earTimer = now;
        earSide = Math.random() > 0.5 ? 1 : -1;
      }
      if (earTimer > 0) {
        const eElapsed = now - earTimer;
        if (eElapsed < 320) {
          earImpulse = Math.sin((eElapsed / 320) * Math.PI);
        } else {
          earImpulse = 0;
          earTimer = 0;
          nextEarAt = now + 3000 + Math.random() * 4500;
        }
      }

      const targetTilt = rig.isLunaSpeaking
        ? Math.sin(t * 2.8) * (0.02 + smoothLuna * 0.026)
        : listening
          ? -0.034 + Math.sin(t * 1.4) * 0.006
          : Math.sin(t * 0.85) * 0.012;
      const targetNod = rig.isLunaSpeaking
        ? -smoothLuna * 0.013 + Math.sin(t * 5.2) * smoothLuna * 0.006
        : Math.sin(t * 1.65) * 0.0035;

      smoothHeadTilt += (targetTilt - smoothHeadTilt) * 0.1;
      smoothHeadNod += (targetNod - smoothHeadNod) * 0.14;

      const breath = Math.sin(t * 1.75);
      const tailWave = Math.sin(
        t * (rig.isLunaSpeaking ? 4.5 : rig.isLive ? 2.9 : 1.9)
      );
      const hairWave = Math.sin(t * 2.1 + 0.8);

      const deformPoint = (u: number, v: number): [number, number] => {
        let du = 0;
        let dv = 0;

        const torsoWeight = smoothstep(0.55, 0.9, v);
        dv += breath * -0.0048 * torsoWeight;
        du += (u - 0.5) * breath * 0.004 * torsoWeight;

        const headWeight = 1 - smoothstep(0.54, 0.72, v);
        const rx = u - 0.51;
        const ry = v - 0.62;
        const cosA = Math.cos(smoothHeadTilt);
        const sinA = Math.sin(smoothHeadTilt);
        const rotU = rx * cosA - ry * sinA - rx;
        const rotV = rx * sinA + ry * cosA - ry;
        du += rotU * headWeight;
        dv += (rotV + smoothHeadNod) * headWeight;

        const earHeight = 1 - smoothstep(0.06, 0.31, v);
        const isLeftEar = 1 - smoothstep(0.36, 0.48, u);
        const isRightEar = smoothstep(0.54, 0.66, u);
        const leftTwitch =
          (earSide < 0 ? earImpulse * 0.024 : 0) +
          (listening ? smoothMic * 0.016 : 0) +
          Math.sin(t * 2.4) * 0.003;
        const rightTwitch =
          (earSide > 0 ? earImpulse * 0.024 : 0) +
          (listening ? smoothMic * 0.016 : 0) +
          Math.cos(t * 2.2) * 0.003;
        du +=
          -leftTwitch * earHeight * isLeftEar +
          rightTwitch * earHeight * isRightEar;
        dv +=
          (leftTwitch * isLeftEar + rightTwitch * isRightEar) *
          earHeight *
          0.45;

        const tailU = smoothstep(0.7, 0.94, u);
        const tailV =
          smoothstep(0.35, 0.52, v) * (1 - smoothstep(0.75, 0.92, v));
        const tailWeight = tailU * tailV;
        du += tailWave * 0.02 * tailWeight;
        dv +=
          Math.cos(t * (rig.isLunaSpeaking ? 4.4 : 2.1)) *
          0.015 *
          tailWeight;

        const hairLeft =
          (1 - smoothstep(0.22, 0.36, u)) * smoothstep(0.48, 0.88, v);
        const hairRight =
          smoothstep(0.66, 0.76, u) *
          (1 - smoothstep(0.78, 0.9, u)) *
          smoothstep(0.48, 0.88, v);
        du += hairWave * 0.009 * hairLeft - hairWave * 0.009 * hairRight;

        const pad = 0.04;
        const scale = 1 - pad * 2;
        return [
          (pad + (u + du) * scale) * size,
          (pad + (v + dv) * scale) * size,
        ];
      };

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      // Soft ambient rim aura right behind Luna's silhouette
      const effectiveLamp = rig.lampOn && rig.scene !== 'off';
      const auraGrad = ctx.createRadialGradient(
        size * 0.5,
        size * 0.48,
        size * 0.08,
        size * 0.5,
        size * 0.5,
        size * 0.44
      );
      if (!effectiveLamp) {
        auraGrad.addColorStop(0, 'rgba(148, 163, 184, 0.14)');
      } else if (rig.scene === 'moon') {
        auraGrad.addColorStop(
          0,
          `rgba(147, 197, 253, ${0.22 + smoothLuna * 0.16})`
        );
      } else if (rig.scene === 'dusk') {
        auraGrad.addColorStop(
          0,
          `rgba(244, 143, 177, ${0.24 + smoothLuna * 0.16})`
        );
      } else {
        auraGrad.addColorStop(
          0,
          `rgba(243, 198, 119, ${0.24 + smoothLuna * 0.16})`
        );
      }
      auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = auraGrad;
      ctx.fillRect(0, 0, size, size);

      const pts: Array<Array<[number, number]>> = [];
      for (let iy = 0; iy <= GRID; iy++) {
        const row: Array<[number, number]> = [];
        const v = iy / GRID;
        for (let ix = 0; ix <= GRID; ix++) {
          const u = ix / GRID;
          row.push(deformPoint(u, v));
        }
        pts.push(row);
      }

      const drawTexturedTriangle = (
        sx0: number,
        sy0: number,
        sx1: number,
        sy1: number,
        sx2: number,
        sy2: number,
        dx0: number,
        dy0: number,
        dx1: number,
        dy1: number,
        dx2: number,
        dy2: number
      ) => {
        const denom =
          sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
        if (Math.abs(denom) < 1e-4) return;

        const cx = (dx0 + dx1 + dx2) / 3;
        const cy = (dy0 + dy1 + dy2) / 3;
        const expand = (x: number, y: number): [number, number] => {
          const vx = x - cx;
          const vy = y - cy;
          const len = Math.hypot(vx, vy) || 1;
          return [x + (vx / len) * 0.75, y + (vy / len) * 0.75];
        };
        const [ex0, ey0] = expand(dx0, dy0);
        const [ex1, ey1] = expand(dx1, dy1);
        const [ex2, ey2] = expand(dx2, dy2);

        const a =
          (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / denom;
        const b =
          (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / denom;
        const c =
          (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / denom;
        const d =
          (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / denom;
        const e =
          (dx0 * (sx1 * sy2 - sx2 * sy1) +
            dx1 * (sx2 * sy0 - sx0 * sy2) +
            dx2 * (sx0 * sy1 - sx1 * sy0)) /
          denom;
        const f =
          (dy0 * (sx1 * sy2 - sx2 * sy1) +
            dy1 * (sx2 * sy0 - sx0 * sy2) +
            dy2 * (sx0 * sy1 - sx1 * sy0)) /
          denom;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(ex0, ey0);
        ctx.lineTo(ex1, ey1);
        ctx.lineTo(ex2, ey2);
        ctx.closePath();
        ctx.clip();
        ctx.transform(a, b, c, d, e, f);
        ctx.drawImage(textureSource, 0, 0);
        ctx.restore();
      };

      const iw = texCtx ? texSize : img.naturalWidth || img.width;
      const ih = texCtx ? texSize : img.naturalHeight || img.height;

      for (let iy = 0; iy < GRID; iy++) {
        for (let ix = 0; ix < GRID; ix++) {
          const u0 = ix / GRID;
          const u1 = (ix + 1) / GRID;
          const v0 = iy / GRID;
          const v1 = (iy + 1) / GRID;

          const sx0 = u0 * iw;
          const sx1 = u1 * iw;
          const sy0 = v0 * ih;
          const sy1 = v1 * ih;

          const [dx00, dy00] = pts[iy][ix];
          const [dx10, dy10] = pts[iy][ix + 1];
          const [dx01, dy01] = pts[iy + 1][ix];
          const [dx11, dy11] = pts[iy + 1][ix + 1];

          drawTexturedTriangle(
            sx0,
            sy0,
            sx1,
            sy0,
            sx0,
            sy1,
            dx00,
            dy00,
            dx10,
            dy10,
            dx01,
            dy01
          );
          drawTexturedTriangle(
            sx1,
            sy0,
            sx1,
            sy1,
            sx0,
            sy1,
            dx10,
            dy10,
            dx11,
            dy11,
            dx01,
            dy01
          );
        }
      }

      const [lcx, lcy] = deformPoint(LEFT_EYE.u, LEFT_EYE.v);
      const [rcx, rcy] = deformPoint(RIGHT_EYE.u, RIGHT_EYE.v);
      const faceAngle = Math.atan2(rcy - lcy, rcx - lcx);
      const eyeDist = Math.hypot(rcx - lcx, rcy - lcy);
      const faceScale = eyeDist / ((RIGHT_EYE.u - LEFT_EYE.u) * size);

      // 1) Warm blush glow when speaking or listening
      const blushBoost = rig.isLunaSpeaking
        ? 0.15 + smoothLuna * 0.24
        : listening
          ? 0.17
          : 0.05;
      if (blushBoost > 0.05) {
        for (const cheek of [LEFT_CHEEK, RIGHT_CHEEK]) {
          const [cx, cy] = deformPoint(cheek.u, cheek.v);
          const rad = 16 * faceScale;
          const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, rad);
          grad.addColorStop(0, `rgba(244, 143, 177, ${blushBoost})`);
          grad.addColorStop(1, 'rgba(244, 143, 177, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(
            cx,
            cy,
            rad * 1.25,
            rad * 0.72,
            faceAngle,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      }

      // 2) Subtle iris catchlight shimmer & organic gaze drift when active/speaking
      if (blinkAmount < 0.2) {
        const gazeDriftX = (rig.isLunaSpeaking ? Math.sin(t * 1.4) * 1.1 : Math.sin(t * 0.7) * 0.7) * faceScale;
        const gazeDriftY = (rig.isLunaSpeaking ? Math.cos(t * 1.9) * 0.6 : Math.cos(t * 0.5) * 0.4) * faceScale;
        const glintAlpha =
          (rig.isLive || rig.isLunaSpeaking
            ? 0.34 + 0.24 * Math.sin(t * 3.1) + smoothLuna * 0.28
            : 0.22 + 0.1 * Math.sin(t * 1.6)) *
          (1 - blinkAmount * 4);
        for (const eye of [LEFT_EYE, RIGHT_EYE]) {
          const [ex, ey] = deformPoint(eye.u, eye.v);
          ctx.fillStyle = `rgba(255, 250, 238, ${clamp(glintAlpha, 0, 0.68)})`;
          ctx.beginPath();
          ctx.arc(
            ex - 4.2 * faceScale + gazeDriftX,
            ey - 4.4 * faceScale + gazeDriftY,
            1.75 * faceScale,
            0,
            Math.PI * 2
          );
          ctx.fill();

          if (rig.isLunaSpeaking || listening) {
            ctx.fillStyle = `rgba(255, 245, 230, ${clamp(glintAlpha * 0.65, 0, 0.42)})`;
            ctx.beginPath();
            ctx.arc(
              ex + 3.4 * faceScale + gazeDriftX * 0.7,
              ey + 3.2 * faceScale + gazeDriftY * 0.7,
              1.05 * faceScale,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
        }
      }

      // 3) Real blinking anime eyelids calibrated to exact PNG eye coordinates
      if (blinkAmount > 0.03) {
        for (const [eye, isLeft] of [
          [LEFT_EYE, true],
          [RIGHT_EYE, false],
        ] as const) {
          const [ex, ey] = deformPoint(eye.u, eye.v);
          const ew = eye.rw * size * faceScale;
          const eh = eye.rh * size * faceScale;

          ctx.save();
          ctx.translate(ex, ey);
          ctx.rotate(faceAngle);

          const coverH = eh * 2.08 * blinkAmount;
          const topY = -eh * 1.04;

          ctx.beginPath();
          ctx.ellipse(0, 0, ew * 1.06, eh * 1.06, 0, 0, Math.PI * 2);
          ctx.clip();

          const lidGrad = ctx.createLinearGradient(0, topY, 0, topY + coverH + 4);
          lidGrad.addColorStop(0, '#FFF4DE');
          lidGrad.addColorStop(0.84, '#FFF4DE');
          lidGrad.addColorStop(1, '#FCE7CC');
          ctx.fillStyle = lidGrad;
          ctx.fillRect(-ew * 1.2, topY - 4, ew * 2.4, coverH + 4);

          const lashY = topY + coverH - 1.5;
          const curvePull = blinkAmount > 0.75 ? 4.5 : -3.5;
          ctx.strokeStyle = '#330D0C';
          ctx.lineWidth = Math.max(2.2, 3.0 * faceScale);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-ew * 0.92, lashY - (isLeft ? 1 : 0));
          ctx.quadraticCurveTo(
            0,
            lashY + curvePull,
            ew * 0.92,
            lashY - (isLeft ? 0 : 1)
          );
          ctx.stroke();

          ctx.restore();
        }
      }

      // 4) Real-time audio-driven anime mouth lip-sync calibrated to exact PNG mouth
      const syllableEnv = rig.isLunaSpeaking
        ? 0.62 + 0.38 * Math.sin(t * 23) * Math.cos(t * 10.5)
        : 0;
      const mouthOpen = rig.isLunaSpeaking
        ? clamp(Math.max(0.14, smoothLuna * 1.25) * syllableEnv, 0, 1)
        : 0;

      if (mouthOpen > 0.06) {
        const [mx, my] = deformPoint(MOUTH.u, MOUTH.v);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(faceAngle);

        const mw = (8.2 + mouthOpen * 3.4) * faceScale;
        const mh = (1.8 + mouthOpen * 7.6) * faceScale;

        const patchGrad = ctx.createRadialGradient(0, 1, 2, 0, 1, mw * 1.65);
        patchGrad.addColorStop(0, 'rgba(255, 244, 222, 1)');
        patchGrad.addColorStop(0.68, 'rgba(255, 244, 222, 0.98)');
        patchGrad.addColorStop(1, 'rgba(255, 244, 222, 0)');
        ctx.fillStyle = patchGrad;
        ctx.beginPath();
        ctx.ellipse(
          0,
          1,
          mw * 1.65,
          Math.max(10 * faceScale, mh * 1.75),
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(-mw, -mh * 0.35);
        ctx.quadraticCurveTo(0, -mh * 0.65, mw, -mh * 0.35);
        ctx.quadraticCurveTo(mw * 0.92, mh * 1.15, 0, mh * 1.15);
        ctx.quadraticCurveTo(-mw * 0.92, mh * 1.15, -mw, -mh * 0.35);
        ctx.closePath();

        const mouthGrad = ctx.createLinearGradient(0, -mh * 0.6, 0, mh * 1.2);
        mouthGrad.addColorStop(0, '#6F2029');
        mouthGrad.addColorStop(1, '#A93848');
        ctx.fillStyle = mouthGrad;
        ctx.fill();

        if (mouthOpen > 0.25) {
          ctx.save();
          ctx.clip();
          ctx.fillStyle = '#F28B9E';
          ctx.beginPath();
          ctx.ellipse(0, mh * 0.95, mw * 0.68, mh * 0.52, 0, 0, Math.PI * 2);
          ctx.fill();

          if (mouthOpen > 0.42) {
            ctx.fillStyle = '#FFF9FA';
            ctx.fillRect(-mw * 0.55, -mh * 0.72, mw * 1.1, mh * 0.42);
          }
          ctx.restore();
        }

        ctx.strokeStyle = '#53211D';
        ctx.lineWidth = Math.max(1.4, 1.8 * faceScale);
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.restore();
      }

      ctx.restore();
      if (!document.hidden && !prefersReducedMotion) {
        rafId = requestAnimationFrame(renderFrame);
      } else {
        rafId = 0;
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden && !prefersReducedMotion && rafId === 0 && !disposed) {
        rafId = requestAnimationFrame(renderFrame);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [imgLoaded]);

  if (imgFailed) {
    return (
      <span className="mb-16 font-display text-5xl font-semibold text-[#F48FB1]">
        Luna
      </span>
    );
  }

  return (
    <div className="relative w-full h-full flex items-end justify-center">
      {!imgLoaded && (
        <span className="mb-20 text-sm text-[#A6B0C9]">Loading Luna...</span>
      )}
      <canvas
        ref={canvasRef}
        aria-label="Animated Luna character"
        className={`w-full h-full object-contain pointer-events-none transition-opacity duration-500 ${
          imgLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
});
