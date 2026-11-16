export const MIN_CLIP_MS = 1000;
export const MAX_CLIP_MS = 60000;

export interface SelectionRangeMs {
  startMs: number;
  endMs: number;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

export function roundToMs(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.round(seconds * 1000);
}

export function msToSeconds(ms: number): number {
  return Math.round(ms) / 1000;
}

export function clampSelectionMs(
  startMs: number,
  endMs: number,
  durationMs: number,
  minClipMs = MIN_CLIP_MS,
  maxClipMs = MAX_CLIP_MS,
): SelectionRangeMs {
  const safeDuration = Math.max(0, Math.round(durationMs));
  if (safeDuration === 0) {
    return { startMs: 0, endMs: 0 };
  }

  const effectiveMin = Math.min(minClipMs, safeDuration);
  const effectiveMax = Math.min(maxClipMs, safeDuration);

  let s = Math.round(clamp(startMs, 0, Math.max(0, safeDuration - effectiveMin)));
  let e = Math.round(clamp(endMs, s + effectiveMin, safeDuration));

  if (e - s > effectiveMax) {
    e = s + effectiveMax;
  }

  if (e > safeDuration) {
    e = safeDuration;
    s = Math.max(0, e - effectiveMax);
  }

  if (e - s < effectiveMin) {
    s = Math.max(0, e - effectiveMin);
  }

  return { startMs: s, endMs: e };
}

export function getInitialSelectionMs(
  durationSec: number,
  initialTimestampSec?: number,
  minClipMs = MIN_CLIP_MS,
  maxClipMs = MAX_CLIP_MS,
): SelectionRangeMs {
  const durationMs = roundToMs(Math.max(0, durationSec));
  if (durationMs === 0) {
    return { startMs: 0, endMs: 0 };
  }

  const effectiveMin = Math.min(minClipMs, durationMs);
  const effectiveMax = Math.min(maxClipMs, durationMs);

  let startMs = 0;
  if (initialTimestampSec !== undefined && Number.isFinite(initialTimestampSec) && initialTimestampSec > 0) {
    const requestedMs = roundToMs(initialTimestampSec);
    startMs = clamp(requestedMs, 0, Math.max(0, durationMs - effectiveMin));
  }

  const endMs = Math.min(durationMs, startMs + effectiveMax);
  return clampSelectionMs(startMs, endMs, durationMs, minClipMs, maxClipMs);
}

export function moveWindowMs(
  startMs: number,
  endMs: number,
  deltaMs: number,
  durationMs: number,
): SelectionRangeMs {
  const safeDuration = Math.max(0, Math.round(durationMs));
  const length = Math.max(0, Math.round(endMs - startMs));
  if (safeDuration === 0) return { startMs: 0, endMs: 0 };

  const clampedLen = Math.min(length, safeDuration);
  const nextStart = Math.round(clamp(startMs + deltaMs, 0, Math.max(0, safeDuration - clampedLen)));
  return {
    startMs: nextStart,
    endMs: nextStart + clampedLen,
  };
}

export function resizeStartMs(
  targetStartMs: number,
  endMs: number,
  durationMs: number,
  minClipMs = MIN_CLIP_MS,
  maxClipMs = MAX_CLIP_MS,
): SelectionRangeMs {
  const safeDuration = Math.max(0, Math.round(durationMs));
  const safeEnd = clamp(Math.round(endMs), 0, safeDuration);
  const effectiveMin = Math.min(minClipMs, safeDuration);
  const effectiveMax = Math.min(maxClipMs, safeDuration);

  const minAllowedStart = Math.max(0, safeEnd - effectiveMax);
  const maxAllowedStart = Math.max(0, safeEnd - effectiveMin);
  const nextStart = Math.round(clamp(targetStartMs, minAllowedStart, maxAllowedStart));

  return {
    startMs: nextStart,
    endMs: safeEnd,
  };
}

export function resizeEndMs(
  startMs: number,
  targetEndMs: number,
  durationMs: number,
  minClipMs = MIN_CLIP_MS,
  maxClipMs = MAX_CLIP_MS,
): SelectionRangeMs {
  const safeDuration = Math.max(0, Math.round(durationMs));
  const safeStart = clamp(Math.round(startMs), 0, safeDuration);
  const effectiveMin = Math.min(minClipMs, safeDuration);
  const effectiveMax = Math.min(maxClipMs, safeDuration);

  const minAllowedEnd = Math.min(safeDuration, safeStart + effectiveMin);
  const maxAllowedEnd = Math.min(safeDuration, safeStart + effectiveMax);
  const nextEnd = Math.round(clamp(targetEndMs, minAllowedEnd, maxAllowedEnd));

  return {
    startMs: safeStart,
    endMs: nextEnd,
  };
}

export function formatMsToTimecode(ms: number, forceHours = false): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0 || forceHours) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function parseTimecodeToMs(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Support ss, mm:ss, hh:mm:ss (with optional .ms decimal on seconds)
  const parts = trimmed.split(':');
  if (parts.length > 3) return null;

  for (const part of parts) {
    if (!/^\d+(?:\.\d+)?$/.test(part)) {
      return null;
    }
  }

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 1) {
    seconds = Number.parseFloat(parts[0]);
  } else if (parts.length === 2) {
    minutes = Number.parseInt(parts[0], 10);
    seconds = Number.parseFloat(parts[1]);
    if (parts[0].includes('.') || seconds >= 60) return null;
  } else {
    hours = Number.parseInt(parts[0], 10);
    minutes = Number.parseInt(parts[1], 10);
    seconds = Number.parseFloat(parts[2]);
    if (parts[0].includes('.') || parts[1].includes('.') || minutes >= 60 || seconds >= 60) {
      return null;
    }
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  const totalMs = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  return totalMs >= 0 ? totalMs : null;
}
