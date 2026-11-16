import { Pause, Play, Repeat } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatMsToTimecode,
  MAX_CLIP_MS,
  MIN_CLIP_MS,
  moveWindowMs,
  parseTimecodeToMs,
  resizeEndMs,
  resizeStartMs,
  type SelectionRangeMs,
} from '../../../../packages/shared/src/index.ts';

interface TimelineEditorProps {
  durationMs: number;
  startMs: number;
  endMs: number;
  playheadMs: number;
  isPlaying: boolean;
  loopSelection: boolean;
  onChangeRange: (next: SelectionRangeMs) => void;
  onSeekPlayhead: (ms: number) => void;
  onPreviewSelection: () => void;
  onTogglePlayPause: () => void;
  onToggleLoop: () => void;
}

type DragMode = 'window' | 'start' | 'end' | null;

export function TimelineEditor({
  durationMs,
  startMs,
  endMs,
  playheadMs,
  isPlaying,
  loopSelection,
  onChangeRange,
  onSeekPlayhead,
  onPreviewSelection,
  onTogglePlayPause,
  onToggleLoop,
}: TimelineEditorProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  const dragRef = useRef<{
    mode: DragMode;
    pointerId: number;
    originX: number;
    initialStartMs: number;
    initialEndMs: number;
  } | null>(null);

  const [draggingMode, setDraggingMode] = useState<DragMode>(null);

  const showHours = durationMs >= 3600_000;
  const [startInput, setStartInput] = useState(() => formatMsToTimecode(startMs, showHours));
  const [endInput, setEndInput] = useState(() => formatMsToTimecode(endMs, showHours));
  const [inputError, setInputError] = useState<string | null>(null);

  useEffect(() => {
    setStartInput(formatMsToTimecode(startMs, showHours));
    setEndInput(formatMsToTimecode(endMs, showHours));
    setInputError(null);
  }, [startMs, endMs, showHours]);

  // Recalculate geometry cleanly on browser resize or phone rotation
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const measure = () => {
      setTrackWidth(el.getBoundingClientRect().width);
    };
    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const msPerPixel = trackWidth > 0 && durationMs > 0 ? durationMs / trackWidth : 1;
  const safeDuration = Math.max(1, durationMs);
  const leftPct = (startMs / safeDuration) * 100;
  const widthPct = Math.max(0.5, ((endMs - startMs) / safeDuration) * 100);
  const playheadPct = Math.min(100, Math.max(0, (playheadMs / safeDuration) * 100));
  const selectedDurationSec = Math.round(((endMs - startMs) / 1000) * 10) / 10;

  const beginDrag = (mode: Exclude<DragMode, null>, e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      pointerId: e.pointerId,
      originX: e.clientX,
      initialStartMs: startMs,
      initialEndMs: endMs,
    };
    setDraggingMode(mode);
  };

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const deltaPx = e.clientX - drag.originX;
      const deltaMs = Math.round(deltaPx * msPerPixel);

      if (drag.mode === 'window') {
        const next = moveWindowMs(drag.initialStartMs, drag.initialEndMs, deltaMs, durationMs);
        onChangeRange(next);
      } else if (drag.mode === 'start') {
        const next = resizeStartMs(
          drag.initialStartMs + deltaMs,
          drag.initialEndMs,
          durationMs,
          MIN_CLIP_MS,
          MAX_CLIP_MS,
        );
        onChangeRange(next);
      } else if (drag.mode === 'end') {
        const next = resizeEndMs(
          drag.initialStartMs,
          drag.initialEndMs + deltaMs,
          durationMs,
          MIN_CLIP_MS,
          MAX_CLIP_MS,
        );
        onChangeRange(next);
      }
    },
    [durationMs, msPerPixel, onChangeRange],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (drag.mode === 'start' || drag.mode === 'window') {
      onSeekPlayhead(startMs);
    }
    dragRef.current = null;
    setDraggingMode(null);
  }, [onSeekPlayhead, startMs]);

  const handleTrackClick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingMode || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const targetMs = Math.round(ratio * durationMs);
    const windowLen = endMs - startMs;
    const centeredStart = targetMs - Math.round(windowLen / 2);
    const next = moveWindowMs(0, windowLen, centeredStart, durationMs);
    onChangeRange(next);
    onSeekPlayhead(next.startMs);
  };

  const commitStartInput = () => {
    const parsed = parseTimecodeToMs(startInput);
    if (parsed === null) {
      setInputError('Enter start time as mm:ss or hh:mm:ss.');
      setStartInput(formatMsToTimecode(startMs, showHours));
      return;
    }
    if (parsed >= endMs - MIN_CLIP_MS && endMs - parsed < MIN_CLIP_MS) {
      // Shift window if user typed a start after current end
      const next = moveWindowMs(0, endMs - startMs, parsed, durationMs);
      onChangeRange(next);
      onSeekPlayhead(next.startMs);
      return;
    }
    const next = resizeStartMs(parsed, endMs, durationMs, MIN_CLIP_MS, MAX_CLIP_MS);
    onChangeRange(next);
    onSeekPlayhead(next.startMs);
  };

  const commitEndInput = () => {
    const parsed = parseTimecodeToMs(endInput);
    if (parsed === null) {
      setInputError('Enter end time as mm:ss or hh:mm:ss.');
      setEndInput(formatMsToTimecode(endMs, showHours));
      return;
    }
    const next = resizeEndMs(startMs, parsed, durationMs, MIN_CLIP_MS, MAX_CLIP_MS);
    onChangeRange(next);
  };

  const handleSliderKeyDown = (target: 'start' | 'end', e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    const stepMs = e.shiftKey ? 5000 : 1000;
    const delta = e.key === 'ArrowRight' ? stepMs : -stepMs;
    if (target === 'start') {
      const next = resizeStartMs(startMs + delta, endMs, durationMs, MIN_CLIP_MS, MAX_CLIP_MS);
      onChangeRange(next);
      onSeekPlayhead(next.startMs);
    } else {
      const next = resizeEndMs(startMs, endMs + delta, durationMs, MIN_CLIP_MS, MAX_CLIP_MS);
      onChangeRange(next);
    }
  };

  // Ensure visual window is at least 32px wide on long videos so center grab remains easy to target
  const minWidthPct = trackWidth > 0 ? Math.min(100, (32 / trackWidth) * 100) : 4;
  const visualWidthPct = Math.max(widthPct, minWidthPct);
  const visualLeftPct = Math.min(leftPct, Math.max(0, 100 - visualWidthPct));

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 sm:p-5">
      {/* Metadata summary bar (unboxed tabular figures) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 font-mono">
          <span>
            Selected <strong className="text-zinc-950 dark:text-zinc-50">{selectedDurationSec}s</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>Max 60s</span>
          <span aria-hidden="true">·</span>
          <span>Video {formatMsToTimecode(durationMs, showHours)}</span>
          <span aria-hidden="true">·</span>
          <span>Playhead {formatMsToTimecode(playheadMs, showHours)}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlayPause}
            className="inline-flex h-10 min-w-[44px] items-center justify-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 text-xs font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          <button
            type="button"
            onClick={onPreviewSelection}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3.5 text-xs font-semibold text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Preview selection</span>
          </button>

          <button
            type="button"
            aria-pressed={loopSelection}
            onClick={onToggleLoop}
            className={`inline-flex h-10 min-w-[44px] items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 ${
              loopSelection
                ? 'border-red-600 bg-red-600/10 text-red-700 dark:text-red-400'
                : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Loop</span>
          </button>
        </div>
      </div>

      {/* Interactive Timeline Track */}
      <div className="mt-5 px-3 select-none">
        <div
          ref={trackRef}
          onPointerDown={handleTrackClick}
          data-testid="timeline-track"
          className="relative h-14 w-full touch-none rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-950 overflow-visible cursor-pointer"
        >
          {/* Subtle tick marks */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex justify-between px-2 items-end pb-1 opacity-30">
            {Array.from({ length: 13 }).map((_, idx) => (
              <span
                key={idx}
                className={`w-px bg-zinc-500 dark:bg-zinc-400 ${idx % 3 === 0 ? 'h-3' : 'h-1.5'}`}
              />
            ))}
          </div>

          {/* Playhead line */}
          <div
            aria-hidden="true"
            style={{ left: `${playheadPct}%` }}
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-zinc-950/60 dark:bg-white/70"
          />

          {/* Draggable Selection Window */}
          <div
            data-testid="timeline-window"
            style={{ left: `${visualLeftPct}%`, width: `${visualWidthPct}%` }}
            onPointerDown={(e) => beginDrag('window', e)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={`absolute top-0 bottom-0 z-20 flex items-center justify-center rounded-md border-2 border-red-600 bg-red-600/20 dark:bg-red-500/25 touch-none ${
              draggingMode === 'window' ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            {visualWidthPct >= 10 && (
              <span className="pointer-events-none hidden sm:inline font-mono text-[11px] font-semibold text-red-900 dark:text-red-100 px-1 truncate">
                {selectedDurationSec}s
              </span>
            )}

            {/* Left Start Handle positioned outward so center window remains unobstructed */}
            <div
              role="slider"
              tabIndex={0}
              aria-label="Clip start time"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, Math.round((endMs - MIN_CLIP_MS) / 1000))}
              aria-valuenow={Math.round(startMs / 1000)}
              aria-valuetext={formatMsToTimecode(startMs, showHours)}
              onKeyDown={(e) => handleSliderKeyDown('start', e)}
              onPointerDown={(e) => beginDrag('start', e)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className="absolute -left-4 top-1/2 -translate-y-1/2 z-30 flex h-12 w-4 items-center justify-center cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 rounded"
            >
              <span className="h-8 w-2 rounded-sm bg-red-600 shadow-sm ring-1 ring-white dark:ring-zinc-950" />
            </div>

            {/* Right End Handle positioned outward so center window remains unobstructed */}
            <div
              role="slider"
              tabIndex={0}
              aria-label="Clip end time"
              aria-valuemin={Math.min(Math.round(durationMs / 1000), Math.round((startMs + MIN_CLIP_MS) / 1000))}
              aria-valuemax={Math.round(durationMs / 1000)}
              aria-valuenow={Math.round(endMs / 1000)}
              aria-valuetext={formatMsToTimecode(endMs, showHours)}
              onKeyDown={(e) => handleSliderKeyDown('end', e)}
              onPointerDown={(e) => beginDrag('end', e)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className="absolute -right-4 top-1/2 -translate-y-1/2 z-30 flex h-12 w-4 items-center justify-center cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 rounded"
            >
              <span className="h-8 w-2 rounded-sm bg-red-600 shadow-sm ring-1 ring-white dark:ring-zinc-950" />
            </div>
          </div>
        </div>
      </div>

      {/* Numeric Start / End Inputs */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:flex sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <label htmlFor="clip-start-input" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Start ({showHours ? 'hh:mm:ss' : 'mm:ss'})
            </label>
            <input
              id="clip-start-input"
              type="text"
              inputMode="numeric"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              onBlur={commitStartInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitStartInput();
                }
              }}
              className="h-10 w-28 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 font-mono text-sm text-zinc-950 dark:text-zinc-50 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-600/20"
            />
          </div>

          <div>
            <label htmlFor="clip-end-input" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              End ({showHours ? 'hh:mm:ss' : 'mm:ss'})
            </label>
            <input
              id="clip-end-input"
              type="text"
              inputMode="numeric"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              onBlur={commitEndInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitEndInput();
                }
              }}
              className="h-10 w-28 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 font-mono text-sm text-zinc-950 dark:text-zinc-50 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-600/20"
            />
          </div>
        </div>

        <p className="col-span-2 text-xs text-zinc-500 dark:text-zinc-400">
          Space: play/pause · Left/Right arrows: nudge 1s · Shift+Arrows: nudge 5s
        </p>
      </div>

      {inputError && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
          {inputError}
        </p>
      )}
    </div>
  );
}
