export const YOUTUBE_VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

export interface ParsedYouTubeUrl {
  valid: true;
  videoId: string;
  canonicalUrl: string;
  initialTimestampSec?: number;
}

export interface InvalidYouTubeUrl {
  valid: false;
  reason: string;
}

export type ParseYouTubeUrlResult = ParsedYouTubeUrl | InvalidYouTubeUrl;

export function parseTimestampParam(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return undefined;

  // Pure integer or decimal seconds: "90" or "90s"
  if (/^\d+(?:\.\d+)?s?$/.test(trimmed)) {
    const val = Number.parseFloat(trimmed.replace(/s$/, ''));
    return Number.isFinite(val) && val >= 0 ? Math.floor(val) : undefined;
  }

  // Compound format: "1h2m3s", "2m30s", "1h30m"
  const compoundMatch = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (compoundMatch && (compoundMatch[1] || compoundMatch[2] || compoundMatch[3])) {
    const hours = Number.parseInt(compoundMatch[1] ?? '0', 10);
    const minutes = Number.parseInt(compoundMatch[2] ?? '0', 10);
    const seconds = Number.parseInt(compoundMatch[3] ?? '0', 10);
    const total = hours * 3600 + minutes * 60 + seconds;
    return Number.isFinite(total) && total >= 0 ? total : undefined;
  }

  return undefined;
}

export function isValidYouTubeVideoId(id: string): boolean {
  return YOUTUBE_VIDEO_ID_REGEX.test(id);
}

export function buildCanonicalYouTubeUrl(videoId: string): string {
  if (!isValidYouTubeVideoId(videoId)) {
    throw new Error('Invalid YouTube video ID');
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function parseYouTubeUrl(rawInput: string): ParseYouTubeUrlResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Please enter a YouTube video URL.' };
  }

  // Reject dangerous or non-web schemes explicitly before adding https://
  const lower = trimmed.toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:/.test(lower)) {
    if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
      return {
        valid: false,
        reason: 'Unsupported URL scheme. Please paste an https:// YouTube link.',
      };
    }
  }

  // Reject whitespace inside the URL
  if (/\s/.test(trimmed)) {
    return { valid: false, reason: 'Invalid URL: unexpected spaces found.' };
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { valid: false, reason: 'That does not look like a valid URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only http and https URLs are supported.' };
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    return {
      valid: false,
      reason: 'Please enter a valid YouTube URL (youtube.com or youtu.be).',
    };
  }

  let candidateId: string | null = null;
  const pathSegments = parsed.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    // https://youtu.be/<id>
    candidateId = pathSegments[0] ?? null;
  } else {
    // youtube.com / m.youtube.com / music.youtube.com / youtube-nocookie.com
    const first = pathSegments[0]?.toLowerCase();

    if (parsed.pathname === '/watch' || parsed.pathname === '/watch/' || first === 'watch') {
      candidateId = parsed.searchParams.get('v');
    } else if (first === 'shorts' || first === 'embed' || first === 'live' || first === 'v') {
      candidateId = pathSegments[1] ?? null;
    } else if (first === 'playlist' || first === 'channel' || first === 'c' || first === 'user' || first?.startsWith('@')) {
      // Check if watch v= was somehow passed, otherwise reject playlist/channel
      const vParam = parsed.searchParams.get('v');
      if (!vParam) {
        return {
          valid: false,
          reason: 'Playlists and channels without a specific video cannot be clipped. Paste a direct video URL.',
        };
      }
      candidateId = vParam;
    } else if (parsed.searchParams.has('v')) {
      candidateId = parsed.searchParams.get('v');
    }
  }

  if (!candidateId) {
    return {
      valid: false,
      reason: 'Could not find a YouTube video ID in that URL.',
    };
  }

  if (!YOUTUBE_VIDEO_ID_REGEX.test(candidateId)) {
    return {
      valid: false,
      reason: 'The YouTube video ID in this URL is malformed.',
    };
  }

  // Extract optional start timestamp (?t=90s, &start=45, #t=1m30s)
  let initialTimestampSec =
    parseTimestampParam(parsed.searchParams.get('t')) ??
    parseTimestampParam(parsed.searchParams.get('start'));

  if (initialTimestampSec === undefined && parsed.hash) {
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    initialTimestampSec =
      parseTimestampParam(hashParams.get('t')) ??
      parseTimestampParam(parsed.hash.replace(/^#t=/i, ''));
  }

  return {
    valid: true,
    videoId: candidateId,
    canonicalUrl: buildCanonicalYouTubeUrl(candidateId),
    initialTimestampSec,
  };
}
