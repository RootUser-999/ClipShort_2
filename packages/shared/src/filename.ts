const MAX_TITLE_SLUG_LENGTH = 60;

export function sanitizeFilenameSegment(raw: string): string {
  // Strip emoji / extended pictographics, control chars, path separators, reserved symbols
  const cleaned = raw
    .normalize('NFKD')
    // Remove combining diacritics
    .replace(/[\u0300-\u036f]/g, '')
    // Remove emojis and non-ASCII symbols
    .replace(/[^\x20-\x7E]/g, '')
    // Remove control characters and reserved filesystem characters
    .replace(/[<>:"/\\|?*\x00-\x1F\x7F]/g, ' ')
    // Collapse whitespace and punctuation runs into single dashes
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, MAX_TITLE_SLUG_LENGTH)
    .replace(/[._-]+$/g, '');

  return cleaned || 'clip';
}

export function formatFilenameTimestamp(secondsInput: number): string {
  const totalSeconds = Math.max(0, Math.round(secondsInput));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}h${pad(minutes)}m${pad(seconds)}s`;
  }
  return `${pad(minutes)}m${pad(seconds)}s`;
}

export function buildClipFilename(title: string, startSec: number, endSec: number): string {
  const slug = sanitizeFilenameSegment(title);
  const startLabel = formatFilenameTimestamp(startSec);
  const endLabel = formatFilenameTimestamp(endSec);
  return `${slug}_${startLabel}-${endLabel}.mp4`;
}
