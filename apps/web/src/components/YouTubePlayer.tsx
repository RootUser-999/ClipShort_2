import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';

interface YTPlayerInstance {
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: () => void;
            onStateChange?: (event: { data: number }) => void;
            onError?: () => void;
          };
        },
      ) => YTPlayerInstance;
      PlayerState?: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YouTubePlayerHandle {
  seekToMs: (ms: number, play?: boolean) => void;
  togglePlayPause: () => void;
  playSelection: () => void;
}

interface YouTubePlayerProps {
  videoId: string;
  title: string;
  thumbnail: string;
  startMs: number;
  endMs: number;
  loopSelection: boolean;
  onPlayheadChange: (ms: number) => void;
  onPlayingChange: (playing: boolean) => void;
}

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    const timeout = window.setTimeout(() => {
      reject(new Error('YouTube Player API load timeout'));
    }, 10000);

    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      prevCallback?.();
      resolve();
    };

    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Failed to load YouTube IFrame API'));
      };
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  function YouTubePlayer(
    { videoId, title, thumbnail, startMs, endMs, loopSelection, onPlayheadChange, onPlayingChange },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const playerRef = useRef<YTPlayerInstance | null>(null);
    const previewActiveRef = useRef(false);
    const startMsRef = useRef(startMs);
    const endMsRef = useRef(endMs);
    const loopRef = useRef(loopSelection);

    const [ready, setReady] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);

    startMsRef.current = startMs;
    endMsRef.current = endMs;
    loopRef.current = loopSelection;

    useEffect(() => {
      let cancelled = false;
      setReady(false);
      setLoadFailed(false);

      loadYouTubeIframeApi()
        .then(() => {
          if (cancelled || !containerRef.current || !window.YT?.Player) return;

          // Clear mount target before constructing player
          containerRef.current.innerHTML = '';
          const targetDiv = document.createElement('div');
          targetDiv.className = 'w-full h-full';
          containerRef.current.appendChild(targetDiv);

          playerRef.current = new window.YT.Player(targetDiv, {
            videoId,
            playerVars: {
              rel: 0,
              modestbranding: 1,
              playsinline: 1,
              enablejsapi: 1,
              origin: window.location.origin,
            },
            events: {
              onReady: () => {
                if (cancelled) return;
                setReady(true);
                if (startMsRef.current > 0) {
                  playerRef.current?.seekTo(startMsRef.current / 1000, true);
                }
              },
              onStateChange: (event) => {
                if (cancelled) return;
                const playing = event.data === 1;
                onPlayingChange(playing);
                if (event.data === 2 || event.data === 0) {
                  if (event.data === 0 && previewActiveRef.current && loopRef.current) {
                    playerRef.current?.seekTo(startMsRef.current / 1000, true);
                    playerRef.current?.playVideo();
                  } else {
                    previewActiveRef.current = false;
                  }
                }
              },
              onError: () => {
                if (!cancelled) setLoadFailed(true);
              },
            },
          });
        })
        .catch(() => {
          if (!cancelled) setLoadFailed(true);
        });

      return () => {
        cancelled = true;
        previewActiveRef.current = false;
        try {
          playerRef.current?.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      };
    }, [videoId, onPlayingChange]);

    // Poll playhead smoothly while mounted to enforce selection auto-pause / loop
    useEffect(() => {
      const interval = window.setInterval(() => {
        const player = playerRef.current;
        if (!player || !ready) return;
        try {
          const currentSec = player.getCurrentTime();
          if (typeof currentSec === 'number' && Number.isFinite(currentSec)) {
            const currentMs = Math.round(currentSec * 1000);
            onPlayheadChange(currentMs);

            const state = player.getPlayerState();
            if (state === 1 && previewActiveRef.current && currentMs >= endMsRef.current) {
              if (loopRef.current) {
                player.seekTo(startMsRef.current / 1000, true);
              } else {
                previewActiveRef.current = false;
                player.pauseVideo();
                player.seekTo(endMsRef.current / 1000, true);
              }
            }
          }
        } catch {
          // ignore transient YT player state errors
        }
      }, 150);

      return () => window.clearInterval(interval);
    }, [ready, onPlayheadChange]);

    useImperativeHandle(
      ref,
      () => ({
        seekToMs(ms: number, play = false) {
          previewActiveRef.current = false;
          if (!playerRef.current || !ready) return;
          playerRef.current.seekTo(ms / 1000, true);
          if (play) playerRef.current.playVideo();
        },
        togglePlayPause() {
          if (!playerRef.current || !ready) return;
          const state = playerRef.current.getPlayerState();
          if (state === 1) {
            previewActiveRef.current = false;
            playerRef.current.pauseVideo();
          } else {
            playerRef.current.playVideo();
          }
        },
        playSelection() {
          if (!playerRef.current || !ready) return;
          previewActiveRef.current = true;
          playerRef.current.seekTo(startMsRef.current / 1000, true);
          playerRef.current.playVideo();
        },
      }),
      [ready],
    );

    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950">
        {loadFailed ? (
          <div key="player-fallback" className="relative flex h-full w-full items-center justify-center bg-zinc-950">
            <img
              src={thumbnail}
              alt={title}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover opacity-35"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/75 p-4 text-center text-white">
              <p className="text-sm font-medium">Embedded YouTube player unavailable in this browser session.</p>
              <p className="mt-1 text-xs text-zinc-300">You can still select timestamps and create your clip normally.</p>
            </div>
          </div>
        ) : (
          <div key="player-iframe-host" ref={containerRef} className="h-full w-full" />
        )}
      </div>
    );
  },
);
