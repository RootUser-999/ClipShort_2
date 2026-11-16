import { useRef, useState } from 'react';
import type { FramingMode } from '../../../../packages/shared/src/index.ts';

interface FramingPanelProps {
  framing: FramingMode;
  cropX: number; // 0..1
  thumbnail: string;
  title: string;
  onChangeFraming: (mode: FramingMode) => void;
  onChangeCropX: (nextCropX: number) => void;
}

const FRAMING_OPTIONS: Array<{
  id: FramingMode;
  label: string;
  description: string;
}> = [
  {
    id: 'center',
    label: 'Fill (center crop)',
    description: 'Fills 9:16 from the center.',
  },
  {
    id: 'custom',
    label: 'Fill (custom crop)',
    description: 'Drag horizontally to track subject.',
  },
  {
    id: 'blur',
    label: 'Fit with blurred background',
    description: '16:9 centered over blurred copy.',
  },
];

// A 9:16 rectangle inside a 16:9 container occupies (9/16)/(16/9) = 81/256 ≈ 31.64% width
const CROP_BOX_WIDTH_PCT = (81 / 256) * 100;

export function FramingPanel({
  framing,
  cropX,
  thumbnail,
  title,
  onChangeFraming,
  onChangeCropX,
}: FramingPanelProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [draggingCrop, setDraggingCrop] = useState(false);

  const updateCropFromClientX = (clientX: number) => {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const boxWidthPx = (CROP_BOX_WIDTH_PCT / 100) * rect.width;
    const travelPx = Math.max(1, rect.width - boxWidthPx);
    const leftEdgePx = clientX - rect.left - boxWidthPx / 2;
    const ratio = Math.min(1, Math.max(0, leftEdgePx / travelPx));
    onChangeCropX(Math.round(ratio * 1000) / 1000);
  };

  const cropLeftPct = cropX * (100 - CROP_BOX_WIDTH_PCT);
  const objectPosPct = framing === 'custom' ? Math.round(cropX * 100) : 50;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
          9:16 Framing
        </h2>
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          1080×1920 · {framing === 'center' ? 'Center' : framing === 'custom' ? `Pan ${objectPosPct}%` : 'Blur fit'}
        </span>
      </div>

      {/* Side-by-side layout on sm+ keeps Create clip above the desktop fold */}
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] items-start">
        <div className="space-y-2" role="radiogroup" aria-label="9:16 framing mode">
          {FRAMING_OPTIONS.map((opt) => {
            const selected = framing === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChangeFraming(opt.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 ${
                  selected
                    ? 'border-red-600 bg-red-600/5 dark:bg-red-500/10'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    {opt.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 rounded-full border flex items-center justify-center ${
                      selected
                        ? 'border-red-600 bg-red-600'
                        : 'border-zinc-400 dark:border-zinc-600'
                    }`}
                  >
                    {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                  {opt.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* Live Phone-Shaped 9:16 Preview Box */}
        <div className="flex flex-col items-center">
          <div
            data-testid="phone-preview-frame"
            className="relative aspect-[9/16] w-28 overflow-hidden rounded-[18px] border-2 border-zinc-800 dark:border-zinc-700 bg-zinc-950 shadow-sm"
          >
            {framing === 'blur' ? (
              <>
                <img
                  src={thumbnail}
                  alt=""
                  aria-hidden="true"
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 h-full w-full scale-110 object-cover blur-md opacity-70"
                />
                <div className="relative z-10 flex h-full w-full items-center justify-center">
                  <img
                    src={thumbnail}
                    alt={`${title} blurred background preview`}
                    referrerPolicy="no-referrer"
                    className="w-full aspect-video object-cover shadow-md"
                  />
                </div>
              </>
            ) : (
              <img
                src={thumbnail}
                alt={`${title} vertical crop preview`}
                referrerPolicy="no-referrer"
                style={{ objectPosition: `${objectPosPct}% 50%` }}
                className="h-full w-full object-cover transition-[object-position] duration-75"
              />
            )}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-1.5 left-1/2 -translate-x-1/2 z-20 h-1 w-7 rounded-full bg-white/30"
            />
          </div>
          <span className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            9:16 preview
          </span>
        </div>
      </div>

      {/* Interactive 16:9 Cropper when Custom Crop is active */}
      {framing === 'custom' && (
        <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400 mb-1.5">
            <span>Drag crop position</span>
            <span className="font-mono">{Math.round(cropX * 100)}%</span>
          </div>
          <div
            ref={frameRef}
            data-testid="custom-crop-frame"
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              setDraggingCrop(true);
              updateCropFromClientX(e.clientX);
            }}
            onPointerMove={(e) => {
              if (!draggingCrop) return;
              updateCropFromClientX(e.clientX);
            }}
            onPointerUp={(e) => {
              if (!draggingCrop) return;
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              } catch {
                // ignore
              }
              setDraggingCrop(false);
            }}
            onPointerCancel={() => setDraggingCrop(false)}
            className="relative aspect-video w-full max-h-40 overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-950 touch-none select-none cursor-ew-resize"
          >
            <img
              src={thumbnail}
              alt={`${title} crop reference`}
              referrerPolicy="no-referrer"
              draggable={false}
              className="h-full w-full object-cover opacity-75 pointer-events-none"
            />
            <div
              aria-hidden="true"
              style={{ width: `${cropLeftPct}%` }}
              className="pointer-events-none absolute inset-y-0 left-0 bg-black/55"
            />
            <div
              aria-hidden="true"
              style={{ left: `${cropLeftPct + CROP_BOX_WIDTH_PCT}%` }}
              className="pointer-events-none absolute inset-y-0 right-0 bg-black/55"
            />
            <div
              role="slider"
              tabIndex={0}
              aria-label="Horizontal crop position"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(cropX * 100)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  onChangeCropX(Math.max(0, Math.round((cropX - 0.05) * 100) / 100));
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  onChangeCropX(Math.min(1, Math.round((cropX + 0.05) * 100) / 100));
                }
              }}
              style={{
                left: `${cropLeftPct}%`,
                width: `${CROP_BOX_WIDTH_PCT}%`,
              }}
              className="absolute inset-y-0 border-2 border-red-500 bg-transparent shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <span className="sr-only">9:16 Crop Region</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
