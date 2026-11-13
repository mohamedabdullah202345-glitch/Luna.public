import { memo } from 'react';
import { motion } from 'motion/react';
import { CallStatus } from '../hooks/useLiveCall';
import { RoomScene } from '../types';
import { LunaCharacter } from './LunaCharacter';

interface VoiceOrbProps {
  status: CallStatus;
  micLevel: number;
  lunaLevel: number;
  isLunaSpeaking: boolean;
  muted: boolean;
  scene: RoomScene;
  lampOn: boolean;
  showCaptions: boolean;
  latestUserLine?: string;
  latestCaption?: string;
  onPress: () => void;
}

const EQ_WEIGHTS = [
  0.22, 0.36, 0.54, 0.72, 0.9, 1, 0.88, 0.96, 0.78, 0.62, 0.44, 0.28, 0.2,
  0.34, 0.56, 0.78, 0.95, 0.86, 0.68, 0.48, 0.3,
];

function formatLiveSubtitle(raw: string, maxChars = 190): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const sliced = clean.slice(-maxChars);
  const firstSpace = sliced.indexOf(' ');
  const tail = firstSpace > 0 && firstSpace < 28 ? sliced.slice(firstSpace + 1) : sliced;
  return `…${tail.trimStart()}`;
}

export const VoiceOrb = memo(function VoiceOrb({
  status,
  micLevel,
  lunaLevel,
  isLunaSpeaking,
  muted,
  scene,
  lampOn,
  showCaptions,
  latestUserLine,
  latestCaption,
  onPress,
}: VoiceOrbProps) {
  const isLive = status === 'live';
  const isConnecting = status === 'connecting';
  const effectiveLamp = lampOn && scene !== 'off';

  const activeVoice = isLunaSpeaking
    ? Math.max(0.24, lunaLevel)
    : isLive && !muted
      ? micLevel
      : 0;

  const haloScale =
    isLunaSpeaking || (isLive && !muted)
      ? 1 + Math.min(0.14, activeVoice * 0.18)
      : isConnecting
        ? 1.04
        : 1;

  const ringStroke =
    scene === 'moon'
      ? 'rgba(147, 197, 253, 0.36)'
      : scene === 'dusk'
        ? 'rgba(244, 143, 177, 0.38)'
        : 'rgba(243, 198, 119, 0.38)';

  const secondaryRingStroke =
    scene === 'moon'
      ? 'rgba(165, 180, 252, 0.18)'
      : 'rgba(244, 143, 177, 0.18)';

  return (
    <div className="relative w-full flex flex-col items-center justify-center select-none">
      <button
        type="button"
        onClick={onPress}
        aria-label={
          isLive || isConnecting
            ? 'End call with Luna'
            : 'Start voice call with Luna'
        }
        className="relative group w-full max-w-[460px] h-[305px] sm:h-[365px] lg:h-[400px] flex items-end justify-center overflow-visible focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#F48FB1] rounded-3xl"
      >
        {/* Orbital harmonic rings framing Luna cleanly */}
        <motion.div
          aria-hidden="true"
          animate={{
            scale: haloScale,
            opacity: effectiveLamp ? (isLive ? 0.92 : 0.62) : 0.25,
          }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <motion.svg
            viewBox="0 0 400 400"
            className="w-[295px] h-[295px] sm:w-[355px] sm:h-[355px] lg:w-[385px] lg:h-[385px] overflow-visible"
            animate={{ rotate: 360 }}
            transition={{ duration: 64, repeat: Infinity, ease: 'linear' }}
          >
            <circle
              cx="200"
              cy="200"
              r="168"
              fill="none"
              stroke={secondaryRingStroke}
              strokeWidth="1"
              strokeDasharray="3 9"
            />
            <circle
              cx="200"
              cy="200"
              r="146"
              fill="none"
              stroke={ringStroke}
              strokeWidth={isLive ? '1.35' : '0.9'}
              strokeDasharray="110 22 18 22"
            />
          </motion.svg>
        </motion.div>

        {/* Secondary counter-rotating delicate arc */}
        <motion.div
          aria-hidden="true"
          animate={{
            rotate: -360,
            scale: isLunaSpeaking ? 1.03 : 1,
            opacity: isLive || isConnecting ? 0.85 : 0.35,
          }}
          transition={{
            rotate: { duration: 48, repeat: Infinity, ease: 'linear' },
            scale: { duration: 0.25 },
            opacity: { duration: 0.4 },
          }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <svg
            viewBox="0 0 400 400"
            className="w-[260px] h-[260px] sm:w-[310px] sm:h-[310px] lg:w-[340px] lg:h-[340px]"
          >
            <circle
              cx="200"
              cy="200"
              r="158"
              fill="none"
              stroke={secondaryRingStroke}
              strokeWidth="0.9"
              strokeDasharray="60 180 40 120"
            />
          </svg>
        </motion.div>

        {/* Subtle interactive hover ring affordance */}
        <span
          aria-hidden="true"
          className="absolute inset-x-12 bottom-6 top-6 rounded-full bg-radial from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        />

        {/* Frameless Animated Anime Character */}
        <motion.div
          animate={{
            y: isLunaSpeaking ? -3 : 0,
            scale: isConnecting ? [1, 1.015, 1] : 1,
          }}
          transition={
            isConnecting
              ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }
          }
          style={{
            maskImage:
              'linear-gradient(to bottom, rgba(0,0,0,1) 82%, rgba(0,0,0,0) 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, rgba(0,0,0,1) 82%, rgba(0,0,0,0) 100%)',
          }}
          className={`relative z-10 w-[285px] sm:w-[345px] lg:w-[375px] h-[295px] sm:h-[355px] lg:h-[390px] flex items-end justify-center transition-[filter] duration-700 ${
            effectiveLamp ? 'brightness-100' : 'brightness-75 contrast-105'
          }`}
        >
          <LunaCharacter
            status={status}
            lunaLevel={lunaLevel}
            micLevel={micLevel}
            isLunaSpeaking={isLunaSpeaking}
            muted={muted}
            scene={scene}
            lampOn={lampOn}
          />
        </motion.div>

        {/* Precision harmonic acoustic waveform */}
        <div
          aria-hidden="true"
          className="absolute bottom-1 z-30 flex items-center gap-[3px] h-7 pointer-events-none"
        >
          {EQ_WEIGHTS.map((weight, idx) => {
            const barScale =
              isLunaSpeaking || (isLive && !muted)
                ? 0.16 + activeVoice * weight * 1.05
                : isConnecting
                  ? 0.28 + ((idx % 3) * 0.15)
                  : 0.14;
            return (
              <span
                key={idx}
                style={{
                  transform: `scaleY(${Math.min(1.18, Math.max(0.14, barScale))})`,
                }}
                className={`w-[3px] h-5 rounded-full origin-center transition-transform duration-75 ${
                  isLunaSpeaking
                    ? 'bg-gradient-to-t from-[#F48FB1] to-[#F3C677]'
                    : isLive && !muted
                      ? 'bg-[#F3C677]/90'
                      : 'bg-white/20'
                }`}
              />
            );
          })}
        </div>
      </button>

      {/* Real-time non-flickering subtitles directly beneath Luna */}
      {showCaptions && (
        <div
          aria-live="polite"
          className="mt-2 px-4 w-full max-w-lg text-center space-y-1.5 min-h-[60px] flex flex-col justify-center"
        >
          {latestUserLine && isLive && (
            <p
              dir="auto"
              className="text-xs text-[#A6B0C9] truncate"
            >
              You: {latestUserLine}
            </p>
          )}

          {latestCaption ? (
            <p
              dir="auto"
              className="text-[15px] sm:text-base text-[#F8F4F6] leading-relaxed text-balance"
            >
              “{formatLiveSubtitle(latestCaption)}”
            </p>
          ) : isConnecting ? (
            <p className="text-sm text-[#A6B0C9]">Connecting to Luna...</p>
          ) : null}
        </div>
      )}
    </div>
  );
});
