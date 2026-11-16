import { AlertCircle, CheckCircle2, Download, Loader2, RotateCcw, Scissors } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ClipProgressEvent } from '../../../../packages/shared/src/index.ts';

interface ClipJobPanelProps {
  rightsConfirmed: boolean;
  onChangeRightsConfirmed: (next: boolean) => void;
  onOpenTerms: () => void;
  onCreateClip: () => void;
  isSubmitting: boolean;
  activeJob: ClipProgressEvent | null;
  onMakeAnother: () => void;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  onTurnstileToken: (token: string | null) => void;
}

const STAGES: Array<{ key: ClipProgressEvent['status']; label: string }> = [
  { key: 'queued', label: 'Queued' },
  { key: 'downloading', label: 'Downloading' },
  { key: 'rendering', label: 'Rendering' },
  { key: 'ready', label: 'Ready' },
];

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDurationMs(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ClipJobPanel({
  rightsConfirmed,
  onChangeRightsConfirmed,
  onOpenTerms,
  onCreateClip,
  isSubmitting,
  activeJob,
  onMakeAnother,
  turnstileEnabled,
  turnstileSiteKey,
  onTurnstileToken,
}: ClipJobPanelProps) {
  const turnstileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!turnstileEnabled || !turnstileSiteKey || !turnstileRef.current) return;
    const scriptId = 'cf-turnstile-script';
    const renderWidget = () => {
      const win = window as unknown as {
        turnstile?: {
          render: (
            el: HTMLElement,
            opts: {
              sitekey: string;
              callback: (token: string) => void;
              'expired-callback': () => void;
            },
          ) => void;
        };
      };
      if (win.turnstile && turnstileRef.current) {
        turnstileRef.current.innerHTML = '';
        win.turnstile.render(turnstileRef.current, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => onTurnstileToken(token),
          'expired-callback': () => onTurnstileToken(null),
        });
      }
    };

    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = renderWidget;
      document.head.appendChild(script);
    } else {
      renderWidget();
    }
  }, [turnstileEnabled, turnstileSiteKey, onTurnstileToken]);

  const isWorking =
    isSubmitting ||
    activeJob?.status === 'queued' ||
    activeJob?.status === 'downloading' ||
    activeJob?.status === 'rendering';

  const currentStageIdx = activeJob
    ? STAGES.findIndex((s) => s.key === activeJob.status)
    : -1;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 sm:p-5">
      {/* Legal Rights Confirmation Checkbox */}
      {(!activeJob || activeJob.status === 'failed' || activeJob.status === 'expired') && (
        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(e) => onChangeRightsConfirmed(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-zinc-300 dark:border-zinc-700 text-red-600 focus:ring-red-600 cursor-pointer"
            />
            <span className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              I own this video or have permission to use it, and I accept the{' '}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenTerms();
                }}
                className="font-medium text-zinc-950 dark:text-zinc-50 underline underline-offset-2 hover:text-red-600 cursor-pointer"
              >
                Terms of Use
              </button>
              .
            </span>
          </label>

          {turnstileEnabled && <div ref={turnstileRef} className="min-h-[65px]" />}

          <button
            type="button"
            disabled={!rightsConfirmed || isWorking}
            onClick={onCreateClip}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-700 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900"
          >
            {isWorking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Starting clip...</span>
              </>
            ) : (
              <>
                <Scissors className="h-4 w-4" aria-hidden="true" />
                <span>Create clip</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Progress Tracker */}
      {activeJob && (activeJob.status === 'queued' || activeJob.status === 'downloading' || activeJob.status === 'rendering') && (
        <div className="space-y-4" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              {activeJob.status === 'queued'
                ? activeJob.queuePosition && activeJob.queuePosition > 0
                  ? `Queued (position ${activeJob.queuePosition})`
                  : 'Queued for render'
                : activeJob.status === 'downloading'
                  ? 'Downloading selected range...'
                  : 'Rendering 9:16 MP4...'}
            </span>
            <span className="font-mono text-sm font-semibold text-red-600 dark:text-red-400">
              {Math.round(activeJob.progress)}%
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(activeJob.progress)}
            className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          >
            <div
              style={{ width: `${Math.min(100, Math.max(2, activeJob.progress))}%` }}
              className="h-full bg-red-600 transition-[width] duration-300"
            />
          </div>

          <ol className="grid grid-cols-4 gap-2 pt-1">
            {STAGES.map((stage, idx) => {
              const reached = currentStageIdx >= idx;
              const isCurrent = currentStageIdx === idx;
              return (
                <li key={stage.key} className="text-center">
                  <div
                    className={`h-1 w-full rounded-full mb-1.5 ${
                      reached ? 'bg-red-600' : 'bg-zinc-200 dark:bg-zinc-800'
                    }`}
                  />
                  <span
                    className={`text-[11px] font-medium ${
                      isCurrent
                        ? 'text-zinc-950 dark:text-zinc-50'
                        : reached
                          ? 'text-zinc-600 dark:text-zinc-300'
                          : 'text-zinc-400 dark:text-zinc-600'
                    }`}
                  >
                    {stage.label}
                  </span>
                </li>
              );
            })}
          </ol>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            You can keep this tab open or return via the URL later—your clip stays available for 30 minutes.
          </p>
        </div>
      )}

      {/* Ready Result View */}
      {activeJob?.status === 'ready' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="text-sm font-semibold">Clip ready</span>
            </div>
            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
              1080×1920 · {formatBytes(activeJob.fileSizeBytes)} · {formatDurationMs(activeJob.renderDurationMs)}
            </span>
          </div>

          <div className="flex justify-center rounded-lg bg-zinc-950 p-2">
            <video
              controls
              playsInline
              preload="metadata"
              src={`/api/clips/${encodeURIComponent(activeJob.jobId)}/download?preview=1`}
              className="aspect-[9/16] max-h-[400px] w-auto rounded-md bg-black"
            />
          </div>

          {activeJob.filename && (
            <p className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400 text-center">
              {activeJob.filename}
            </p>
          )}

          <div className="space-y-2.5">
            <a
              href={`/api/clips/${encodeURIComponent(activeJob.jobId)}/download`}
              download={activeJob.filename || 'clip.mp4'}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Download MP4</span>
            </a>

            <button
              type="button"
              onClick={onMakeAnother}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>Make another clip from the same video</span>
            </button>
          </div>
        </div>
      )}

      {/* Failed / Expired Error Banner */}
      {activeJob && (activeJob.status === 'failed' || activeJob.status === 'expired') && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-300 dark:border-red-900/70 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {activeJob.error ||
              (activeJob.status === 'expired'
                ? 'This clip expired, please create it again.'
                : 'Clip creation failed. Please try again.')}
          </span>
        </div>
      )}
    </div>
  );
}
