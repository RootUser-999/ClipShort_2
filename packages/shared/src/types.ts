export type FramingMode = 'center' | 'custom' | 'blur';

export type ClipJobStatus =
  | 'queued'
  | 'downloading'
  | 'rendering'
  | 'ready'
  | 'failed'
  | 'expired';

export type VideoAvailability =
  | 'public'
  | 'unlisted'
  | 'short'
  | 'unavailable'
  | 'private'
  | 'members_only'
  | 'age_restricted'
  | 'region_blocked'
  | 'copyright_blocked'
  | 'embed_disabled'
  | 'live'
  | 'upcoming';

export interface VideoInfo {
  videoId: string;
  title: string;
  duration: number; // seconds
  thumbnail: string;
  channel: string;
  isLive: boolean;
  availability: VideoAvailability;
  initialTimestampSec?: number;
}

export interface CreateClipRequest {
  videoId: string;
  start: number; // seconds (can have ms decimals)
  end: number; // seconds (can have ms decimals)
  framing: FramingMode;
  cropX?: number; // 0..1 horizontal offset for custom crop
  rightsConfirmed: boolean;
  turnstileToken?: string;
}

export interface CreateClipResponse {
  jobId: string;
  status: ClipJobStatus;
  queuePosition?: number;
}

export interface ClipProgressEvent {
  jobId: string;
  status: ClipJobStatus;
  progress: number; // 0..100
  queuePosition?: number;
  error?: string;
  filename?: string;
  fileSizeBytes?: number;
  renderDurationMs?: number;
  durationSec?: number;
  videoTitle?: string;
  createdAt?: number;
  expiresAt?: number;
}

export interface PublicAppConfig {
  allowOnlyCcOrOwn: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  maxVideoDurationSec: number;
  maxClipDurationSec: number;
  minClipDurationSec: number;
  dmcaContactEmail: string;
}

export interface ApiErrorResponse {
  error: string;
  code: string;
}
