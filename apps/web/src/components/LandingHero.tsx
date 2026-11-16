import { AlertTriangle, ArrowRight, Loader2, Scissors } from 'lucide-react';
import type { FormEvent } from 'react';

interface LandingHeroProps {
  urlInput: string;
  onChangeUrl: (next: string) => void;
  onSubmitUrl: (urlOverride?: string) => void;
  isLoading: boolean;
  errorMessage: string | null;
  allowOnlyCcOrOwn: boolean;
  compact?: boolean;
}

const SAMPLE_VIDEOS = [
  {
    label: 'Big Buck Bunny (10m CC)',
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30s',
  },
  {
    label: 'Me at the zoo (19s)',
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  },
];

export function LandingHero({
  urlInput,
  onChangeUrl,
  onSubmitUrl,
  isLoading,
  errorMessage,
  allowOnlyCcOrOwn,
  compact = false,
}: LandingHeroProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmitUrl();
  };

  return (
    <section id="top" className={compact ? 'border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 py-5' : 'py-12 sm:py-16'}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {allowOnlyCcOrOwn && (
          <div
            role="note"
            className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-950 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <p>
              <strong>Rights notice:</strong> Only clip videos that you own, have explicit permission to repurpose, or are licensed under Creative Commons.
            </p>
          </div>
        )}

        {!compact && (
          <div className="max-w-3xl">
            <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl text-balance">
              Turn long YouTube videos into vertical 9:16 clips.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-lg">
              Select up to 60 seconds, frame your subject for TikTok, Reels, or Shorts, and download a crisp 1080×1920 MP4 without installing anything.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className={compact ? '' : 'mt-8 max-w-3xl'} noValidate>
          <label htmlFor="youtube-url-input" className="block text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-2">
            YouTube video URL
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="youtube-url-input"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={urlInput}
              onChange={(e) => onChangeUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              aria-invalid={Boolean(errorMessage)}
              aria-describedby={errorMessage ? 'url-input-error' : undefined}
              className="h-12 flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 text-base text-zinc-950 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-600/20"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex h-12 min-w-[144px] items-center justify-center gap-2 rounded-lg bg-red-600 px-6 text-sm font-semibold text-white hover:bg-red-700 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Loading video</span>
                </>
              ) : (
                <>
                  <Scissors className="h-4 w-4" aria-hidden="true" />
                  <span>Load video</span>
                </>
              )}
            </button>
          </div>

          {errorMessage && (
            <p
              id="url-input-error"
              role="alert"
              className="mt-2.5 text-sm font-medium text-red-600 dark:text-red-400"
            >
              {errorMessage}
            </p>
          )}

          {!compact && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span>Try an example:</span>
              {SAMPLE_VIDEOS.map((sample) => (
                <button
                  key={sample.url}
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    onChangeUrl(sample.url);
                    onSubmitUrl(sample.url);
                  }}
                  className="inline-flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-300 hover:text-red-600 dark:hover:text-red-400 underline underline-offset-4 cursor-pointer disabled:opacity-50"
                >
                  <span>{sample.label}</span>
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </form>

        {!compact && (
          <div id="how-it-works" className="mt-14 border-t border-zinc-200 dark:border-zinc-800 pt-10">
            <h2 className="font-display text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              How it works
            </h2>
            <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-3">
              <div>
                <p className="font-mono text-xs font-medium text-red-600 dark:text-red-400">01</p>
                <h3 className="mt-2 text-base font-semibold text-zinc-950 dark:text-zinc-50">
                  Paste any YouTube link
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Supports standard watch links, Shorts, live VODs, and links with starting timestamps. Only the slice you select is fetched.
                </p>
              </div>
              <div>
                <p className="font-mono text-xs font-medium text-red-600 dark:text-red-400">02</p>
                <h3 className="mt-2 text-base font-semibold text-zinc-950 dark:text-zinc-50">
                  Select up to 60 seconds
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Drag the range across the timeline or type exact timestamps, preview with auto-stop, and nudge by 1s or 5s with arrow keys.
                </p>
              </div>
              <div>
                <p className="font-mono text-xs font-medium text-red-600 dark:text-red-400">03</p>
                <h3 className="mt-2 text-base font-semibold text-zinc-950 dark:text-zinc-50">
                  Frame 9:16 and export
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Choose center crop, custom horizontal crop, or blurred background. Exports 1080×1920 H.264/AAC MP4 ready for mobile.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
