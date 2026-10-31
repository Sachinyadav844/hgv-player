const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);

const PATH_PREFIXES = ['embed', 'shorts', 'live', 'v'];

export function isValidVideoId(value: unknown): value is string {
  return typeof value === 'string' && VIDEO_ID_REGEX.test(value);
}

/**
 * Extracts a YouTube video ID from a bare ID or from a YouTube URL.
 *
 * Supported forms:
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/embed/VIDEO_ID  (also /shorts/, /live/, /v/)
 *
 * Returns null for anything else (other hosts, non-http schemes, malformed IDs,
 * URLs that carry credentials). The hostname is checked against an allowlist; arbitrary
 * iframe URLs are never accepted.
 */
export function parseYouTubeInput(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > 2048) return null;

  if (VIDEO_ID_REGEX.test(raw)) return raw;

  let candidate = raw;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    // Allow pasting "youtube.com/watch?v=..." or "youtu.be/..." without a scheme.
    if (/^(www\.|m\.|music\.)?(youtube(-nocookie)?\.com|youtu\.be)\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    } else {
      return null;
    }
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  let id: string | null = null;

  if (SHORT_HOSTS.has(host)) {
    id = segments[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === 'watch') {
      id = url.searchParams.get('v');
    } else if (segments[0] && PATH_PREFIXES.includes(segments[0])) {
      id = segments[1] ?? null;
    }
  } else {
    return null;
  }

  return isValidVideoId(id) ? id : null;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
