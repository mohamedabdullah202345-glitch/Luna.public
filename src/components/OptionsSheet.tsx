import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Code2,
  Copy,
  Download,
  Lock,
  Moon,
  Sparkles,
  Sun,
  Sunset,
  Volume2,
  X,
} from 'lucide-react';
import { RoomScene, VoiceName } from '../types';
import warmLampImg from '../assets/images/scene_warm_lamp_1794531686170.jpg';
import moonlightImg from '../assets/images/scene_moonlight_1794531685438.jpg';
import sakuraDuskImg from '../assets/images/scene_sakura_dusk_1794531687165.jpg';

interface OptionsSheetProps {
  open: boolean;
  voiceName: VoiceName;
  scene: RoomScene;
  lampOn: boolean;
  showCaptions: boolean;
  speakTextReplies: boolean;
  isCallActive: boolean;
  authRequired: boolean;
  onClose: () => void;
  onChangeVoice: (voice: VoiceName) => void;
  onChangeScene: (scene: RoomScene) => void;
  onToggleLamp: () => void;
  onToggleCaptions: () => void;
  onToggleSpeakReplies: () => void;
  onLockSession: () => void;
}

const VOICES: Array<{ name: VoiceName; note: string }> = [
  { name: 'Sulafat', note: 'Warm & sweet' },
  { name: 'Aoede', note: 'Expressive' },
  { name: 'Leda', note: 'Soft & calm' },
  { name: 'Kore', note: 'Clear tone' },
  { name: 'Zephyr', note: 'Light & airy' },
];

const SCENES: Array<{
  value: RoomScene;
  label: string;
  swatch: string;
  image?: string;
}> = [
  {
    value: 'lamp',
    label: 'Warm Lamp',
    swatch: 'from-[#F3C677] to-[#E879A0]',
    image: warmLampImg,
  },
  {
    value: 'moon',
    label: 'Moonlight',
    swatch: 'from-[#93C5FD] to-[#6366F1]',
    image: moonlightImg,
  },
  {
    value: 'dusk',
    label: 'Sakura Dusk',
    swatch: 'from-[#F48FB1] to-[#7E57C2]',
    image: sakuraDuskImg,
  },
  {
    value: 'off',
    label: 'Lights Off',
    swatch: 'from-[#334155] to-[#0F172A]',
  },
];

const PYTHON_CAM_SCRIPT = `"""Luna Camera Bridge — Run in VS Code to stream your webcam to Luna."""
import argparse, asyncio, base64, json, sys
import cv2
import websockets

def encode_jpeg(frame, max_width=512, quality=72):
    h, w = frame.shape[:2]
    if w > max_width:
        frame = cv2.resize(frame, (max_width, int(h * (max_width / float(w)))))
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    return base64.b64encode(buf.tobytes()).decode("ascii") if ok else ""

async def main(url: str, camera: int):
    cap = cv2.VideoCapture(camera)
    if not cap.isOpened():
        print("Could not open camera", file=sys.stderr)
        return
    sep = "&" if "?" in url else "?"
    async with websockets.connect(f"{url}{sep}role=camera") as ws:
        print("Connected to Luna! Press Q in the preview window to stop.")
        loop = asyncio.get_running_loop()
        started_at, last, last_gesture, prev_gray = loop.time(), 0.0, 0.0, None
        while True:
            ok, frame = cap.read()
            if not ok:
                await asyncio.sleep(0.05)
                continue
            cv2.imshow("Luna Camera (VS Code)", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
            now = loop.time()
            if now - last >= 1.0:
                last = now
                small_gray = cv2.cvtColor(cv2.resize(frame, (48, 36)), cv2.COLOR_BGR2GRAY)
                gesture = False
                if prev_gray is not None:
                    abs_diff = cv2.absdiff(small_gray, prev_gray)
                    global_score = float(abs_diff.mean()) / 255.0
                    peak_zone = max(
                        float(abs_diff[r * 12 : (r + 1) * 12, c * 12 : (c + 1) * 12].mean()) / 255.0
                        for r in range(3)
                        for c in range(4)
                    )
                    is_gesture = global_score <= 0.38 and (
                        (0.068 <= peak_zone <= 0.48 and global_score >= 0.01)
                        or global_score >= 0.042
                    )
                    if is_gesture and now - started_at > 1.8 and now - last_gesture > 6.5:
                        gesture = True
                        last_gesture = now
                prev_gray = small_gray
                b64 = encode_jpeg(frame)
                if b64:
                    payload = {"video": b64, "mimeType": "image/jpeg"}
                    if gesture:
                        payload["gestureCheck"] = True
                    await ws.send(json.dumps(payload))
            await asyncio.sleep(0.02)
    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--camera", type=int, default=0)
    args = p.parse_args()
    asyncio.run(main(args.url, args.camera))
`;

export function OptionsSheet({
  open,
  voiceName,
  scene,
  lampOn,
  showCaptions,
  speakTextReplies,
  isCallActive,
  authRequired,
  onClose,
  onChangeVoice,
  onChangeScene,
  onToggleLamp,
  onToggleCaptions,
  onToggleSpeakReplies,
  onLockSession,
}: OptionsSheetProps) {
  const [copiedCmd, setCopiedCmd] = useState(false);

  const wsProto =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? 'wss:'
      : 'ws:';
  const wsHost =
    typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
  const runCommand = `pip install opencv-python websockets && python luna_cam.py --url ${wsProto}//${wsHost}/live`;

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(runCommand);
      setCopiedCmd(true);
      window.setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      // Ignore clipboard errors
    }
  };

  const handleDownloadPython = () => {
    const blob = new Blob([PYTHON_CAM_SCRIPT], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'luna_cam.py';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Customize Luna"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#040711]/75 backdrop-blur-sm sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg max-h-[88dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[#0D1324]/95 border border-white/12 overflow-hidden pb-safe shadow-2xl"
          >
            <div className="sm:hidden pt-3 pb-1 flex justify-center shrink-0">
              <span className="w-10 h-1.5 rounded-full bg-white/20" />
            </div>

            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
              <div>
                <h2 className="font-display text-lg font-medium text-[#F8F4F6]">
                  Room &amp; Voice
                </h2>
                <p className="text-xs text-[#A6B0C9]">
                  Room lighting, Luna&apos;s voice, audio, and VS Code camera
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close options"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#A6B0C9] hover:text-[#F8F4F6] hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto luna-scroll p-5 space-y-6">
              {/* Room Lamp & Scene */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[#F8F4F6]">
                    Room Scene
                  </h3>
                  <button
                    type="button"
                    onClick={onToggleLamp}
                    className={`min-h-[40px] px-3.5 rounded-xl text-xs font-medium inline-flex items-center gap-2 border transition-colors whitespace-nowrap shrink-0 ${
                      lampOn && scene !== 'off'
                        ? 'bg-[#F3C677]/15 border-[#F3C677]/40 text-[#F3C677]'
                        : 'bg-white/5 border-white/10 text-[#A6B0C9] hover:text-[#F8F4F6]'
                    }`}
                  >
                    {lampOn && scene !== 'off' ? (
                      <Sun className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>
                      {lampOn && scene !== 'off' ? 'Lamp On' : 'Lamp Off'}
                    </span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {SCENES.map((item) => {
                    const active = scene === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => onChangeScene(item.value)}
                        className={`relative overflow-hidden min-h-[60px] px-3.5 py-2.5 rounded-2xl border text-left flex items-center gap-3 transition-all ${
                          active
                            ? 'bg-white/12 border-[#F3C677]/55 text-[#F8F4F6]'
                            : 'bg-[#080C18]/80 border-white/10 text-[#A6B0C9] hover:text-[#F8F4F6] hover:border-white/20'
                        }`}
                      >
                        {item.image ? (
                          <img
                            src={item.image}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-xl object-cover shrink-0 border border-white/10"
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className={`w-9 h-9 rounded-xl bg-gradient-to-br ${item.swatch} shrink-0 border border-white/10`}
                          />
                        )}
                        <span className="text-xs font-medium whitespace-nowrap">
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Voice Selection */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[#F8F4F6]">
                    Luna&apos;s Voice
                  </h3>
                  {isCallActive && (
                    <span className="text-[11px] text-[#A6B0C9]">
                      End call to switch
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {VOICES.map((v) => {
                    const active = voiceName === v.name;
                    return (
                      <button
                        key={v.name}
                        type="button"
                        disabled={isCallActive}
                        onClick={() => onChangeVoice(v.name)}
                        className={`min-h-[54px] px-3 py-2 rounded-2xl border text-left flex flex-col justify-center transition-all disabled:opacity-50 ${
                          active
                            ? 'bg-[#F3C677]/15 border-[#F3C677]/50 text-[#F8F4F6]'
                            : 'bg-[#080C18]/80 border-white/10 text-[#A6B0C9] hover:text-[#F8F4F6]'
                        }`}
                      >
                        <span className="text-xs font-semibold">{v.name}</span>
                        <span className="text-[11px] text-[#A6B0C9]">
                          {v.note}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* VS Code Python Camera Bridge */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[#F8F4F6] flex items-center gap-2">
                    <Code2
                      className="w-4 h-4 text-[#F3C677]"
                      aria-hidden="true"
                    />
                    <span>VS Code Python Camera</span>
                  </h3>
                </div>
                <p className="text-xs text-[#A6B0C9] leading-relaxed">
                  Use the Camera or Screen Share button on the stage, or run this
                  Python OpenCV script in VS Code to stream your webcam to Luna.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadPython}
                    className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[#080C18]/80 hover:bg-white/10 border border-white/10 text-xs font-medium text-[#F8F4F6] inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
                  >
                    <Download
                      className="w-3.5 h-3.5 text-[#F48FB1]"
                      aria-hidden="true"
                    />
                    <span>Download luna_cam.py</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCommand}
                    className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[#080C18]/80 hover:bg-white/10 border border-white/10 text-xs font-medium text-[#F8F4F6] inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
                  >
                    {copiedCmd ? (
                      <Check
                        className="w-3.5 h-3.5 text-[#F3C677]"
                        aria-hidden="true"
                      />
                    ) : (
                      <Copy
                        className="w-3.5 h-3.5 text-[#A6B0C9]"
                        aria-hidden="true"
                      />
                    )}
                    <span>{copiedCmd ? 'Copied' : 'Copy Run Command'}</span>
                  </button>
                </div>
              </section>

              {/* Playback & Captions */}
              <section className="space-y-2.5">
                <h3 className="text-sm font-semibold text-[#F8F4F6]">
                  Audio &amp; Display
                </h3>

                <button
                  type="button"
                  onClick={onToggleCaptions}
                  className="w-full min-h-[48px] px-4 py-2.5 rounded-2xl bg-[#080C18]/80 border border-white/10 flex items-center justify-between gap-3 text-left hover:border-white/20 transition-colors"
                >
                  <span className="flex items-center gap-2.5 text-xs font-medium text-[#F8F4F6]">
                    <Sparkles
                      className="w-4 h-4 text-[#F48FB1]"
                      aria-hidden="true"
                    />
                    <span>Live subtitles under Luna</span>
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      showCaptions ? 'text-[#F3C677]' : 'text-[#7C88A6]'
                    }`}
                  >
                    {showCaptions ? 'On' : 'Off'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onToggleSpeakReplies}
                  className="w-full min-h-[48px] px-4 py-2.5 rounded-2xl bg-[#080C18]/80 border border-white/10 flex items-center justify-between gap-3 text-left hover:border-white/20 transition-colors"
                >
                  <span className="flex items-center gap-2.5 text-xs font-medium text-[#F8F4F6]">
                    <Volume2
                      className="w-4 h-4 text-[#F3C677]"
                      aria-hidden="true"
                    />
                    <span>Speak replies in text chat</span>
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      speakTextReplies ? 'text-[#F3C677]' : 'text-[#7C88A6]'
                    }`}
                  >
                    {speakTextReplies ? 'On' : 'Off'}
                  </span>
                </button>

                {authRequired && (
                  <button
                    type="button"
                    onClick={onLockSession}
                    className="w-full min-h-[48px] px-4 py-2.5 rounded-2xl bg-[#080C18]/80 border border-white/10 flex items-center justify-between gap-3 text-left hover:border-[#F48FB1]/40 transition-colors"
                  >
                    <span className="flex items-center gap-2.5 text-xs font-medium text-[#F8F4F6]">
                      <Lock
                        className="w-4 h-4 text-[#F48FB1]"
                        aria-hidden="true"
                      />
                      <span>Lock private session</span>
                    </span>
                    <Sunset
                      className="w-4 h-4 text-[#7C88A6]"
                      aria-hidden="true"
                    />
                  </button>
                )}
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
