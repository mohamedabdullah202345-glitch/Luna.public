import { memo, useEffect, useRef } from 'react';
import { RoomScene } from '../types';
import warmLampImg from '../assets/images/scene_warm_lamp_1794531686170.jpg';
import moonlightImg from '../assets/images/scene_moonlight_1794531685438.jpg';
import sakuraDuskImg from '../assets/images/scene_sakura_dusk_1794531687165.jpg';

interface AmbientBackdropProps {
  scene: RoomScene;
  lampOn: boolean;
  isLive: boolean;
  isLunaSpeaking: boolean;
  voiceLevel: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  speed: number;
  kind: 'petal' | 'ember' | 'star';
}

const SCENE_BACKDROPS: Record<Exclude<RoomScene, 'off'>, string> = {
  lamp: warmLampImg,
  moon: moonlightImg,
  dusk: sakuraDuskImg,
};

export const AmbientBackdrop = memo(function AmbientBackdrop({
  scene,
  lampOn,
  isLive,
  isLunaSpeaking,
  voiceLevel,
}: AmbientBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({
    scene,
    lampOn,
    isLive,
    isLunaSpeaking,
    voiceLevel,
  });

  useEffect(() => {
    stateRef.current = { scene, lampOn, isLive, isLunaSpeaking, voiceLevel };
  }, [isLive, isLunaSpeaking, lampOn, scene, voiceLevel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.25);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const particles: Particle[] = [];
    const total = width < 640 ? 34 : 54;
    for (let i = 0; i < total; i++) {
      const r = Math.random();
      const kind: Particle['kind'] =
        r < 0.34 ? 'star' : r < 0.68 ? 'ember' : 'petal';
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy:
          kind === 'star'
            ? 0
            : kind === 'ember'
              ? -(0.14 + Math.random() * 0.25)
              : 0.18 + Math.random() * 0.26,
        size:
          kind === 'star'
            ? 1 + Math.random() * 1.4
            : kind === 'ember'
              ? 1.6 + Math.random() * 2.4
              : 3.5 + Math.random() * 3.5,
        alpha: 0.2 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 1.2,
        kind,
      });
    }

    let rafId = 0;
    let disposed = false;
    let lastDrawAt = 0;
    let smoothLevel = 0;

    const draw = (now: number) => {
      if (disposed) return;
      if (now - lastDrawAt < 32) {
        if (!document.hidden && !reducedMotion) {
          rafId = requestAnimationFrame(draw);
        } else {
          rafId = 0;
        }
        return;
      }
      lastDrawAt = now;
      const t = now / 1000;
      const st = stateRef.current;
      const effectiveLamp = st.lampOn && st.scene !== 'off';
      smoothLevel += (st.voiceLevel - smoothLevel) * 0.16;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Subtle atmospheric aurora glow behind stage center
      const stageX = width >= 1024 ? width * 0.34 : width * 0.5;
      const stageY = height * 0.44;
      const radius = Math.min(width, height) * (0.42 + smoothLevel * 0.12);
      const glow = ctx.createRadialGradient(
        stageX,
        stageY,
        10,
        stageX,
        stageY,
        radius
      );

      if (!effectiveLamp) {
        glow.addColorStop(0, 'rgba(148, 163, 184, 0.08)');
        glow.addColorStop(1, 'rgba(6, 9, 19, 0)');
      } else if (st.scene === 'moon') {
        glow.addColorStop(
          0,
          `rgba(147, 197, 253, ${0.14 + smoothLevel * 0.1})`
        );
        glow.addColorStop(0.55, 'rgba(99, 102, 241, 0.06)');
        glow.addColorStop(1, 'rgba(6, 9, 19, 0)');
      } else if (st.scene === 'dusk') {
        glow.addColorStop(
          0,
          `rgba(244, 143, 177, ${0.18 + smoothLevel * 0.11})`
        );
        glow.addColorStop(0.55, 'rgba(168, 85, 247, 0.07)');
        glow.addColorStop(1, 'rgba(6, 9, 19, 0)');
      } else {
        glow.addColorStop(
          0,
          `rgba(243, 198, 119, ${0.18 + smoothLevel * 0.11})`
        );
        glow.addColorStop(0.55, 'rgba(244, 143, 177, 0.08)');
        glow.addColorStop(1, 'rgba(6, 9, 19, 0)');
      }

      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      if (!reducedMotion) {
        for (const p of particles) {
          if (p.kind === 'star') {
            const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * p.speed + p.phase));
            const starOpacity = (effectiveLamp ? 0.28 : 0.52) * p.alpha * twinkle;
            ctx.fillStyle = `rgba(226, 232, 240, ${starOpacity})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            continue;
          }

          p.x += p.vx + Math.sin(t * 0.6 + p.phase) * 0.18;
          p.y += p.vy * (st.isLunaSpeaking ? 1.25 : 1);

          if (p.y < -20) {
            p.y = height + 20;
            p.x = Math.random() * width;
          } else if (p.y > height + 20) {
            p.y = -20;
            p.x = Math.random() * width;
          }
          if (p.x < -20) p.x = width + 20;
          if (p.x > width + 20) p.x = -20;

          const pulse = 0.65 + 0.35 * Math.sin(t * 1.4 + p.phase);
          const alpha =
            p.alpha * pulse * (effectiveLamp ? 0.72 : 0.25);

          if (p.kind === 'ember') {
            const color =
              st.scene === 'moon'
                ? `rgba(191, 219, 254, ${alpha})`
                : st.scene === 'dusk'
                  ? `rgba(248, 187, 208, ${alpha})`
                  : `rgba(243, 198, 119, ${alpha})`;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(t * 0.4 + p.phase);
            ctx.fillStyle =
              st.scene === 'moon'
                ? `rgba(199, 210, 254, ${alpha * 0.65})`
                : `rgba(244, 143, 177, ${alpha * 0.72})`;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }

      ctx.restore();
      if (!document.hidden && !reducedMotion) {
        rafId = requestAnimationFrame(draw);
      } else {
        rafId = 0;
      }
    };

    const handleVisibility = () => {
      if (!document.hidden && !reducedMotion && rafId === 0 && !disposed) {
        lastDrawAt = 0;
        rafId = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    rafId = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const effectiveLamp = lampOn && scene !== 'off';
  const activeKey: Exclude<RoomScene, 'off'> =
    scene === 'off' ? 'moon' : scene;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#060913]"
    >
      {/* Crossfading illustrated room backdrops */}
      {(Object.keys(SCENE_BACKDROPS) as Array<Exclude<RoomScene, 'off'>>).map(
        (key) => {
          const isActive = key === activeKey;
          const opacityClass = !isActive
            ? 'opacity-0'
            : effectiveLamp
              ? 'opacity-45'
              : 'opacity-15';
          return (
            <img
              key={key}
              src={SCENE_BACKDROPS[key]}
              alt=""
              referrerPolicy="no-referrer"
              className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-1000 ease-out ${
                isActive ? 'animate-scene-drift ' : ''
              }${opacityClass}`}
            />
          );
        }
      )}

      {/* Measured contrast & depth scrim so UI typography stays crisp */}
      <div
        className={`absolute inset-0 transition-colors duration-1000 ${
          effectiveLamp
            ? 'bg-gradient-to-b from-[#060913]/80 via-[#080C18]/55 to-[#050811]/92'
            : 'bg-gradient-to-b from-[#04060D]/90 via-[#050812]/82 to-[#04060D]/96'
        }`}
      />

      {/* Soft side radial vignette for desktop split-screen framing */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_25%,rgba(4,6,13,0.78)_100%)]" />

      {/* Live canvas night stars, drifting petals & warm embers */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
});
