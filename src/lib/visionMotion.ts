export const MOTION_WIDTH = 48;
export const MOTION_HEIGHT = 36;

export interface MotionAnalysis {
  globalScore: number;
  peakZoneScore: number;
  centerZoneScore: number;
  isGestureMotion: boolean;
}

/**
 * Analyzes frame-to-frame luminance delta across a 4x3 grid of zones so subtle
 * localized gestures (hand near mouth blowing a kiss, waving, smiling/leaning)
 * trigger reliably while ignoring whole-room exposure jumps or idle stillness.
 */
export function analyzeMotionZones(
  prevLuma: Uint8Array,
  currentLuma: Uint8Array,
  width = MOTION_WIDTH,
  height = MOTION_HEIGHT
): MotionAnalysis {
  if (
    prevLuma.length !== currentLuma.length ||
    prevLuma.length !== width * height
  ) {
    return {
      globalScore: 0,
      peakZoneScore: 0,
      centerZoneScore: 0,
      isGestureMotion: false,
    };
  }

  const cols = 4;
  const rows = 3;
  const zoneWidth = Math.floor(width / cols);
  const zoneHeight = Math.floor(height / rows);
  const zoneSums = new Float64Array(cols * rows);
  const zoneCounts = new Uint16Array(cols * rows);

  let totalDiff = 0;

  for (let y = 0; y < height; y++) {
    const rowIdx = Math.min(rows - 1, Math.floor(y / zoneHeight));
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      const diff = Math.abs(currentLuma[idx] - prevLuma[idx]);
      totalDiff += diff;

      const colIdx = Math.min(cols - 1, Math.floor(x / zoneWidth));
      const zoneIdx = rowIdx * cols + colIdx;
      zoneSums[zoneIdx] += diff;
      zoneCounts[zoneIdx] += 1;
    }
  }

  const globalScore = totalDiff / (currentLuma.length * 255);
  let peakZoneScore = 0;
  let centerSum = 0;
  let centerCount = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const zIdx = r * cols + c;
      const count = zoneCounts[zIdx] || 1;
      const zScore = zoneSums[zIdx] / (count * 255);
      if (zScore > peakZoneScore) {
        peakZoneScore = zScore;
      }
      // Center face & upper chest zones: cols 1..2, rows 0..2
      if (c >= 1 && c <= 2) {
        centerSum += zoneSums[zIdx];
        centerCount += count;
      }
    }
  }

  const centerZoneScore = centerCount > 0 ? centerSum / (centerCount * 255) : 0;

  // Reject global exposure flashes/shakes (> 0.38 across full frame) and dead stillness
  const notExposureFlash = globalScore <= 0.38;
  const localizedGesture =
    peakZoneScore >= 0.068 && peakZoneScore <= 0.48 && globalScore >= 0.01;
  const broadGesture = globalScore >= 0.042 && globalScore <= 0.38;

  return {
    globalScore,
    peakZoneScore,
    centerZoneScore,
    isGestureMotion: notExposureFlash && (localizedGesture || broadGesture),
  };
}
