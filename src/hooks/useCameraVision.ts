import { useCallback, useEffect, useRef, useState } from 'react';
import {
  analyzeMotionZones,
  MOTION_HEIGHT,
  MOTION_WIDTH,
} from '../lib/visionMotion';

export type VisionMode = 'off' | 'camera' | 'screen';

interface UseCameraVisionOptions {
  isLive: boolean;
  isLunaSpeaking: boolean;
  micLevel: number;
  onSendVideoFrame: (base64Jpeg: string, gestureCheck?: boolean) => void;
}

const MOTION_W = MOTION_WIDTH;
const MOTION_H = MOTION_HEIGHT;

export function useCameraVision({
  isLive,
  isLunaSpeaking,
  micLevel,
  onSendVideoFrame,
}: UseCameraVisionOptions) {
  const [visionMode, setVisionMode] = useState<VisionMode>('off');
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);

  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevLumaRef = useRef<Uint8Array | null>(null);
  const startedAtRef = useRef(0);
  const lastGestureCueAtRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  const liveStateRef = useRef({
    isLunaSpeaking,
    micLevel,
    onSendVideoFrame,
  });

  useEffect(() => {
    liveStateRef.current = { isLunaSpeaking, micLevel, onSendVideoFrame };
  }, [isLunaSpeaking, micLevel, onSendVideoFrame]);

  const stopVision = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoElRef.current) {
      videoElRef.current.srcObject = null;
    }
    prevLumaRef.current = null;
    setVideoStream(null);
    setVisionMode('off');
  }, []);

  const attachStream = useCallback(
    (stream: MediaStream, nextMode: Exclude<VisionMode, 'off'>) => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
      }
      streamRef.current = stream;
      prevLumaRef.current = null;
      startedAtRef.current = Date.now();
      setVideoStream(stream);
      setVisionMode(nextMode);
      setVisionError(null);

      const [firstTrack] = stream.getVideoTracks();
      if (firstTrack) {
        firstTrack.onended = () => {
          stopVision();
        };
      }
    },
    [stopVision]
  );

  const toggleCamera = useCallback(async () => {
    if (visionMode === 'camera') {
      stopVision();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      attachStream(stream, 'camera');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not access camera.';
      setVisionError(msg);
    }
  }, [attachStream, stopVision, visionMode]);

  const toggleScreenShare = useCallback(async () => {
    if (visionMode === 'screen') {
      stopVision();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setVisionError('Screen sharing is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 2 },
        audio: false,
      });
      attachStream(stream, 'screen');
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        return;
      }
      const msg =
        err instanceof Error ? err.message : 'Could not share screen.';
      setVisionError(msg);
    }
  }, [attachStream, stopVision, visionMode]);

  useEffect(() => {
    const el = videoElRef.current;
    if (el && videoStream) {
      el.srcObject = videoStream;
      el.play().catch(() => {});
    }
  }, [videoStream]);

  const checkLocalizedGesture = useCallback(
    (video: HTMLVideoElement): boolean => {
      if (!motionCanvasRef.current) {
        const c = document.createElement('canvas');
        c.width = MOTION_W;
        c.height = MOTION_H;
        motionCanvasRef.current = c;
      }
      const mCtx = motionCanvasRef.current.getContext('2d', {
        willReadFrequently: true,
      });
      if (!mCtx) return false;

      mCtx.drawImage(video, 0, 0, MOTION_W, MOTION_H);
      const { data } = mCtx.getImageData(0, 0, MOTION_W, MOTION_H);
      const current = new Uint8Array(MOTION_W * MOTION_H);

      for (let i = 0, p = 0; i < current.length; i++, p += 4) {
        current[i] =
          (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
      }

      const prev = prevLumaRef.current;
      prevLumaRef.current = current;
      if (!prev) return false;

      const analysis = analyzeMotionZones(prev, current, MOTION_W, MOTION_H);
      return analysis.isGestureMotion;
    },
    []
  );

  const captureSnapshot = useCallback(
    (overrideMode?: VisionMode): string | null => {
      const video = videoElRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) {
        return null;
      }

      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }
      const canvas = canvasRef.current;
      const effectiveMode = overrideMode ?? visionMode;
      // Keep camera frames compact (512px) for speed, and VS Code screen shares sharp (1152px)
      const maxW = effectiveMode === 'screen' ? 1152 : 512;
      const quality = effectiveMode === 'screen' ? 0.78 : 0.72;
      const scale = Math.min(1, maxW / video.videoWidth);
      const targetW = Math.max(1, Math.round(video.videoWidth * scale));
      const targetH = Math.max(1, Math.round(video.videoHeight * scale));

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, targetW, targetH);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      return dataUrl.split(',')[1] ?? null;
    },
    [visionMode]
  );

  // Stream JPEG frames at 1 FPS during active live voice calls + detect localized gestures
  useEffect(() => {
    if (!isLive || visionMode === 'off' || !videoStream) return;

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const video = videoElRef.current;
      const frame = captureSnapshot(visionMode);
      if (!frame || !video) return;

      const {
        isLunaSpeaking: speaking,
        micLevel: mic,
        onSendVideoFrame: send,
      } = liveStateRef.current;

      let gestureCheck = false;
      if (visionMode === 'camera') {
        const hasGesture = checkLocalizedGesture(video);
        const now = Date.now();
        if (
          hasGesture &&
          !speaking &&
          mic < 0.22 &&
          now - startedAtRef.current > 1800 &&
          now - lastGestureCueAtRef.current > 6500
        ) {
          gestureCheck = true;
          lastGestureCueAtRef.current = now;
        }
      }

      send(frame, gestureCheck);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [
    captureSnapshot,
    checkLocalizedGesture,
    isLive,
    videoStream,
    visionMode,
  ]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
      }
    };
  }, []);

  return {
    visionMode,
    videoStream,
    visionError,
    videoElRef,
    toggleCamera,
    toggleScreenShare,
    stopVision,
    captureSnapshot,
  };
}
