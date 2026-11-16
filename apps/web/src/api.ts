import type {
  ApiErrorResponse,
  ClipProgressEvent,
  CreateClipRequest,
  CreateClipResponse,
  PublicAppConfig,
  VideoInfo,
} from '../../../packages/shared/src/index.ts';

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

async function parseJsonOrThrow<T>(resp: Response): Promise<T> {
  const text = await resp.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiClientError('Server returned an unexpected response.', 'INVALID_RESPONSE', resp.status);
  }

  if (!resp.ok) {
    const errObj = data as Partial<ApiErrorResponse> | null;
    throw new ApiClientError(
      errObj?.error || `Request failed (${resp.status})`,
      errObj?.code || 'REQUEST_FAILED',
      resp.status,
    );
  }

  return data as T;
}

export async function fetchPublicConfig(): Promise<PublicAppConfig> {
  const resp = await fetch('/api/config');
  return parseJsonOrThrow<PublicAppConfig>(resp);
}

export async function fetchVideoMetadata(url: string): Promise<VideoInfo> {
  const resp = await fetch('/api/video/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return parseJsonOrThrow<VideoInfo>(resp);
}

export async function createClipJob(payload: CreateClipRequest): Promise<CreateClipResponse> {
  const resp = await fetch('/api/clips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<CreateClipResponse>(resp);
}

export async function fetchClipJobStatus(jobId: string): Promise<ClipProgressEvent> {
  const resp = await fetch(`/api/clips/${encodeURIComponent(jobId)}`);
  return parseJsonOrThrow<ClipProgressEvent>(resp);
}

export function subscribeToClipProgress(
  jobId: string,
  onEvent: (event: ClipProgressEvent) => void,
  onFatalError: (message: string) => void,
): () => void {
  let closed = false;
  let eventSource: EventSource | null = null;
  let pollTimer: number | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempts = 0;

  const stopAll = () => {
    closed = true;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const isTerminal = (status: ClipProgressEvent['status']) =>
    status === 'ready' || status === 'failed' || status === 'expired';

  const startPollingFallback = () => {
    if (closed || pollTimer !== null) return;
    const pollOnce = async () => {
      if (closed) return;
      try {
        const evt = await fetchClipJobStatus(jobId);
        onEvent(evt);
        if (isTerminal(evt.status)) {
          stopAll();
        }
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 404) {
          onEvent({
            jobId,
            status: 'expired',
            progress: 0,
            error: 'This clip expired, please create it again.',
          });
          stopAll();
        }
      }
    };
    void pollOnce();
    pollTimer = window.setInterval(() => {
      void pollOnce();
    }, 2000);
  };

  const connectSse = () => {
    if (closed) return;
    if (typeof EventSource === 'undefined') {
      startPollingFallback();
      return;
    }

    eventSource = new EventSource(`/api/clips/${encodeURIComponent(jobId)}/events`);

    eventSource.onmessage = (msg) => {
      reconnectAttempts = 0;
      try {
        const parsed = JSON.parse(msg.data) as ClipProgressEvent;
        onEvent(parsed);
        if (isTerminal(parsed.status)) {
          stopAll();
        }
      } catch {
        // Ignore malformed heartbeat
      }
    };

    eventSource.onerror = () => {
      if (closed) return;
      eventSource?.close();
      eventSource = null;
      reconnectAttempts++;

      if (reconnectAttempts <= 3) {
        const delayMs = Math.min(4000, reconnectAttempts * 1000);
        reconnectTimer = window.setTimeout(() => {
          connectSse();
        }, delayMs);
      } else {
        // Fall back seamlessly to HTTP polling after repeated SSE drops
        startPollingFallback();
      }
    };
  };

  connectSse();

  // Safety check in case browser puts tab to sleep
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && !closed) {
      void fetchClipJobStatus(jobId)
        .then((evt) => {
          onEvent(evt);
          if (isTerminal(evt.status)) stopAll();
        })
        .catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    stopAll();
    void onFatalError;
  };
}
