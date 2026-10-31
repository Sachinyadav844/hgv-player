import { useEffect, useState } from 'react';

interface VideoInfo {
  title: string;
  author: string | null;
}

const cache = new Map<string, VideoInfo | null>();

/**
 * Looks up a video's title through YouTube's public oEmbed endpoint. Purely cosmetic and best
 * effort: if it fails (offline, blocked, private video) the UI falls back to the video ID.
 */
export function useVideoInfo(videoId: string | null | undefined): VideoInfo | null {
  const [info, setInfo] = useState<VideoInfo | null>(videoId ? (cache.get(videoId) ?? null) : null);

  useEffect(() => {
    if (!videoId) {
      setInfo(null);
      return;
    }
    if (cache.has(videoId)) {
      setInfo(cache.get(videoId) ?? null);
      return;
    }
    let cancelled = false;
    setInfo(null);
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('oembed failed'))))
      .then((data: { title?: string; author_name?: string }) => {
        const value = data.title ? { title: data.title, author: data.author_name ?? null } : null;
        cache.set(videoId, value);
        if (!cancelled) setInfo(value);
      })
      .catch(() => {
        cache.set(videoId, null);
      });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  return info;
}
