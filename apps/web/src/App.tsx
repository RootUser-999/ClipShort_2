import { AlertCircle, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatMsToTimecode,
  getInitialSelectionMs,
  moveWindowMs,
  msToSeconds,
  parseYouTubeUrl,
  roundToMs,
  type ClipProgressEvent,
  type FramingMode,
  type PublicAppConfig,
  type SelectionRangeMs,
  type VideoInfo,
} from '../../../packages/shared/src/index.ts';
import {
  ApiClientError,
  createClipJob,
  fetchClipJobStatus,
  fetchPublicConfig,
  fetchVideoMetadata,
  subscribeToClipProgress,
} from './api.ts';
import { ClipJobPanel } from './components/ClipJobPanel.tsx';
import { EditorSkeleton } from './components/EditorSkeleton.tsx';
import { FramingPanel } from './components/FramingPanel.tsx';
import { Header, type LegalPageKind } from './components/Header.tsx';
import { LandingHero } from './components/LandingHero.tsx';
import { LegalModal } from './components/LegalPages.tsx';
import { TimelineEditor } from './components/TimelineEditor.tsx';
import { YouTubePlayer, type YouTubePlayerHandle } from './components/YouTubePlayer.tsx';

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const saved = window.localStorage.getItem('clipshort-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    window.localStorage.setItem('clipshort-theme', theme);
  }, [theme]);

  const [appConfig, setAppConfig] = useState<PublicAppConfig>({
    allowOnlyCcOrOwn: false,
    turnstileEnabled: false,
    turnstileSiteKey: null,
    maxVideoDurationSec: 43200,
    maxClipDurationSec: 60,
    minClipDurationSec: 1,
    dmcaContactEmail: 'dmca@clipshort.example',
  });

  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);

  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [selectionMs, setSelectionMs] = useState<SelectionRangeMs>({ startMs: 0, endMs: 60_000 });
  const [playheadMs, setPlayheadMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopSelection, setLoopSelection] = useState(false);

  const [framing, setFraming] = useState<FramingMode>('center');
  const [cropX, setCropX] = useState(0.5);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const [isSubmittingClip, setIsSubmittingClip] = useState(false);
  const submittingLockRef = useRef(false);
  const [activeJob, setActiveJob] = useState<ClipProgressEvent | null>(null);
  const sseCleanupRef = useRef<(() => void) | null>(null);

  const [legalPage, setLegalPage] = useState<LegalPageKind | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);

  const playerRef = useRef<YouTubePlayerHandle | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastError(msg);
  }, []);

  useEffect(() => {
    if (!toastError) return;
    const timer = window.setTimeout(() => setToastError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toastError]);

  const attachJobSubscription = useCallback(
    (jobId: string) => {
      if (sseCleanupRef.current) {
        sseCleanupRef.current();
        sseCleanupRef.current = null;
      }

      const url = new URL(window.location.href);
      url.searchParams.set('job', jobId);
      window.history.replaceState({}, '', url.toString());

      sseCleanupRef.current = subscribeToClipProgress(
        jobId,
        (evt) => {
          setActiveJob(evt);
        },
        (errMsg) => {
          showToast(errMsg);
        },
      );
    },
    [showToast],
  );

  useEffect(() => {
    void fetchPublicConfig()
      .then(setAppConfig)
      .catch(() => {});

    // Resume an in-progress or completed job if ?job=<uuid> is in the URL
    const params = new URLSearchParams(window.location.search);
    const resumeJobId = params.get('job');
    if (resumeJobId) {
      void fetchClipJobStatus(resumeJobId)
        .then((evt) => {
          setActiveJob(evt);
          if (evt.status === 'queued' || evt.status === 'downloading' || evt.status === 'rendering') {
            attachJobSubscription(resumeJobId);
          }
        })
        .catch((err) => {
          setActiveJob({
            jobId: resumeJobId,
            status: 'expired',
            progress: 0,
            error:
              err instanceof ApiClientError
                ? err.message
                : 'This clip expired, please create it again.',
          });
        });
    }

    return () => {
      sseCleanupRef.current?.();
    };
  }, [attachJobSubscription]);

  const clearActiveJobState = useCallback(() => {
    if (sseCleanupRef.current) {
      sseCleanupRef.current();
      sseCleanupRef.current = null;
    }
    setActiveJob(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has('job')) {
      url.searchParams.delete('job');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const handleLoadVideo = async (overrideUrl?: string) => {
    const raw = (overrideUrl ?? urlInput).trim();
    const parsed = parseYouTubeUrl(raw);
    if (!parsed.valid) {
      setUrlError(parsed.reason);
      return;
    }

    setUrlError(null);
    setIsLoadingVideo(true);
    clearActiveJobState();

    try {
      const info = await fetchVideoMetadata(raw);
      setVideoInfo(info);
      const initial = getInitialSelectionMs(info.duration, info.initialTimestampSec);
      setSelectionMs(initial);
      setPlayheadMs(initial.startMs);
      setFraming('center');
      setCropX(0.5);
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : 'Could not load video metadata. Please check the URL and try again.';
      setUrlError(msg);
      showToast(msg);
    } finally {
      setIsLoadingVideo(false);
    }
  };

  const durationMs = videoInfo ? roundToMs(videoInfo.duration) : 0;

  // Global keyboard shortcuts when editing a loaded video
  useEffect(() => {
    if (!videoInfo) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }
      if (target?.getAttribute('role') === 'slider') {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        playerRef.current?.togglePlayPause();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 5000 : 1000;
        const delta = e.key === 'ArrowRight' ? step : -step;
        setSelectionMs((prev) => {
          const next = moveWindowMs(prev.startMs, prev.endMs, delta, durationMs);
          playerRef.current?.seekToMs(next.startMs);
          return next;
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [videoInfo, durationMs]);

  const handleCreateClip = async () => {
    if (!videoInfo || submittingLockRef.current) return;
    if (!rightsConfirmed) {
      showToast('Please confirm you own or have permission to use this video.');
      return;
    }

    submittingLockRef.current = true;
    setIsSubmittingClip(true);

    try {
      const res = await createClipJob({
        videoId: videoInfo.videoId,
        start: msToSeconds(selectionMs.startMs),
        end: msToSeconds(selectionMs.endMs),
        framing,
        cropX: framing === 'custom' ? cropX : undefined,
        rightsConfirmed: true,
        turnstileToken: turnstileToken || undefined,
      });

      setActiveJob({
        jobId: res.jobId,
        status: res.status,
        progress: 0,
        queuePosition: res.queuePosition,
      });
      attachJobSubscription(res.jobId);
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : 'Could not start clip creation. Please try again.';
      showToast(msg);
      setActiveJob({
        jobId: 'error',
        status: 'failed',
        progress: 0,
        error: msg,
      });
    } finally {
      setIsSubmittingClip(false);
      submittingLockRef.current = false;
    }
  };

  const handleMakeAnother = () => {
    clearActiveJobState();
    if (videoInfo) {
      const initial = getInitialSelectionMs(videoInfo.duration);
      setSelectionMs(initial);
      setPlayheadMs(initial.startMs);
      playerRef.current?.seekToMs(initial.startMs);
    }
  };

  const handleNavigateHome = () => {
    clearActiveJobState();
    setVideoInfo(null);
    setUrlError(null);
    setUrlInput('');
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <Header
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        onNavigateHome={handleNavigateHome}
        onOpenLegal={(kind) => setLegalPage(kind)}
      />

      <main className="flex-1">
        <LandingHero
          urlInput={urlInput}
          onChangeUrl={(next) => {
            setUrlInput(next);
            if (urlError) setUrlError(null);
          }}
          onSubmitUrl={handleLoadVideo}
          isLoading={isLoadingVideo}
          errorMessage={urlError}
          allowOnlyCcOrOwn={appConfig.allowOnlyCcOrOwn}
          compact={Boolean(videoInfo) || isLoadingVideo}
        />

        {isLoadingVideo && <EditorSkeleton />}

        {!isLoadingVideo && !videoInfo && activeJob && (
          <section className="mx-auto max-w-xl px-4 pb-12 sm:px-6">
            <ClipJobPanel
              rightsConfirmed={rightsConfirmed}
              onChangeRightsConfirmed={setRightsConfirmed}
              onOpenTerms={() => setLegalPage('terms')}
              onCreateClip={handleCreateClip}
              isSubmitting={isSubmittingClip}
              activeJob={activeJob}
              onMakeAnother={handleNavigateHome}
              turnstileEnabled={appConfig.turnstileEnabled}
              turnstileSiteKey={appConfig.turnstileSiteKey}
              onTurnstileToken={setTurnstileToken}
            />
          </section>
        )}

        {!isLoadingVideo && videoInfo && (
          <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
            {/* Video Title & Metadata Strip */}
            <div className="mb-5">
              <h1 className="font-display text-xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-2xl">
                {videoInfo.title}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <span>{videoInfo.channel}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{formatMsToTimecode(durationMs, durationMs >= 3600_000)} total</span>
                {videoInfo.availability === 'short' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Under 60s video</span>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
              {/* Left Column: Player & Timeline */}
              <div className="space-y-4 lg:col-span-7">
                <YouTubePlayer
                  ref={playerRef}
                  videoId={videoInfo.videoId}
                  title={videoInfo.title}
                  thumbnail={videoInfo.thumbnail}
                  startMs={selectionMs.startMs}
                  endMs={selectionMs.endMs}
                  loopSelection={loopSelection}
                  onPlayheadChange={setPlayheadMs}
                  onPlayingChange={setIsPlaying}
                />

                <TimelineEditor
                  durationMs={durationMs}
                  startMs={selectionMs.startMs}
                  endMs={selectionMs.endMs}
                  playheadMs={playheadMs}
                  isPlaying={isPlaying}
                  loopSelection={loopSelection}
                  onChangeRange={setSelectionMs}
                  onSeekPlayhead={(ms) => {
                    setPlayheadMs(ms);
                    playerRef.current?.seekToMs(ms);
                  }}
                  onPreviewSelection={() => playerRef.current?.playSelection()}
                  onTogglePlayPause={() => playerRef.current?.togglePlayPause()}
                  onToggleLoop={() => setLoopSelection((prev) => !prev)}
                />
              </div>

              {/* Right Column: Framing & Export */}
              <div className="space-y-4 lg:col-span-5">
                <FramingPanel
                  framing={framing}
                  cropX={cropX}
                  thumbnail={videoInfo.thumbnail}
                  title={videoInfo.title}
                  onChangeFraming={setFraming}
                  onChangeCropX={setCropX}
                />

                <ClipJobPanel
                  rightsConfirmed={rightsConfirmed}
                  onChangeRightsConfirmed={setRightsConfirmed}
                  onOpenTerms={() => setLegalPage('terms')}
                  onCreateClip={handleCreateClip}
                  isSubmitting={isSubmittingClip}
                  activeJob={activeJob}
                  onMakeAnother={handleMakeAnother}
                  turnstileEnabled={appConfig.turnstileEnabled}
                  turnstileSiteKey={appConfig.turnstileSiteKey}
                  onTurnstileToken={setTurnstileToken}
                />
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Clean Minimal Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 text-xs text-zinc-500 dark:text-zinc-400 sm:flex-row sm:items-center sm:px-6">
          <p>
            ClipShort · Temporary files expire automatically after download or 30 minutes.
          </p>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setLegalPage('terms')}
              className="hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4 cursor-pointer"
            >
              Terms
            </button>
            <button
              type="button"
              onClick={() => setLegalPage('privacy')}
              className="hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4 cursor-pointer"
            >
              Privacy
            </button>
            <button
              type="button"
              onClick={() => setLegalPage('dmca')}
              className="hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4 cursor-pointer"
            >
              DMCA
            </button>
          </div>
        </div>
      </footer>

      <LegalModal
        page={legalPage}
        dmcaContactEmail={appConfig.dmcaContactEmail}
        onClose={() => setLegalPage(null)}
      />

      {/* Toast Notification */}
      {toastError && (
        <div
          role="status"
          aria-live="assertive"
          className="fixed bottom-4 right-4 z-50 flex max-w-md items-start gap-3 rounded-xl border border-red-300 dark:border-red-900 bg-white dark:bg-zinc-900 px-4 py-3 text-sm text-zinc-950 dark:text-zinc-50 shadow-lg"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <p className="flex-1 text-xs leading-relaxed">{toastError}</p>
          <button
            type="button"
            onClick={() => setToastError(null)}
            aria-label="Dismiss notification"
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
