import { useCallback, useEffect, useRef, useState } from 'react';
import { SYNC, expectedPosition, type PlaybackState } from '@hgv/shared';

/** Minimal typing for the parts of the YouTube IFrame Player API that we use. */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  loadVideoById(args: { videoId: string; startSeconds?: number }): void;
  cueVideoById(args: { videoId: string; startSeconds?: number }): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData(): { video_id?: string };
  getVolume(): number;
  setVolume(v: number): void;
  isMuted(): boolean;
  mute(): void;
  unMute(): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads the official IFrame API script once per page. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiPromise = null; // allow a retry on the next mount
      reject(new Error('Could not load the YouTube player. Check your connection or ad blocker.'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

const ERROR_MESSAGES: Record<number, string> = {
  2: 'YouTube says this video link is not valid.',
  5: 'The YouTube player hit an error. Try loading the video again.',
  100: 'This video was not found or is private.',
  101: 'The owner of this video does not allow it to be played outside YouTube.',
  150: 'The owner of this video does not allow it to be played outside YouTube.',
};

export interface PlayerUi {
  ready: boolean;
  time: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** Seconds this player is ahead (+) or behind (-) the authoritative position. */
  drift: number;
}

interface Options {
  playback: PlaybackState | null;
  getServerNow: () => number;
  /** Called once when the video ends while the room is still marked as playing. */
  onEnded: (position: number) => void;
}

/**
 * Drives one YouTube player from the room's authoritative state.
 *
 * The iframe is created with its own controls disabled and covered by an overlay, so the only way
 * to change playback is through the room (server) - the player itself just obeys. Whenever state
 * arrives, and every two seconds, `reconcile` compares the player with the expected position and
 * only seeks when drift exceeds a threshold and a minimum interval has passed, so clients never
 * fight each other with a stream of seeks.
 */
export function useYouTubePlayer({ playback, getServerNow, onEnded }: Options) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const playbackRef = useRef(playback);
  const nowRef = useRef(getServerNow);
  const onEndedRef = useRef(onEnded);
  const loadedIdRef = useRef<string | null>(null);
  const lastSeekRef = useRef(0);
  const endedSentRef = useRef(false);
  const blockTimerRef = useRef<number | undefined>(undefined);

  const [ui, setUi] = useState<PlayerUi>({ ready: false, time: 0, duration: 0, volume: 100, muted: false, drift: 0 });
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    playbackRef.current = playback;
    nowRef.current = getServerNow;
    onEndedRef.current = onEnded;
  });

  const armBlockCheck = useCallback(() => {
    window.clearTimeout(blockTimerRef.current);
    blockTimerRef.current = window.setTimeout(() => {
      const p = playerRef.current;
      const s = playbackRef.current;
      if (!p || !s?.playing) return;
      const st = p.getPlayerState();
      // The room says "playing" but the browser refused (autoplay policy): ask for a click.
      if (st !== STATE.PLAYING && st !== STATE.BUFFERING) setBlocked(true);
    }, 2200);
  }, []);

  const reconcile = useCallback(() => {
    const p = playerRef.current;
    const s = playbackRef.current;
    if (!p || !readyRef.current || !s || !s.videoId) return;
    const now = Date.now();
    const target = expectedPosition(s, nowRef.current());

    let currentId: string | undefined;
    try {
      currentId = p.getVideoData().video_id;
    } catch {
      return;
    }

    if (currentId !== s.videoId) {
      if (loadedIdRef.current === s.videoId) return; // load already requested, still in flight
      loadedIdRef.current = s.videoId;
      endedSentRef.current = false;
      setError(null);
      lastSeekRef.current = now;
      if (s.playing) {
        p.loadVideoById({ videoId: s.videoId, startSeconds: target });
        armBlockCheck();
      } else {
        // cue, not load: a paused room must not start playing on a new video
        p.cueVideoById({ videoId: s.videoId, startSeconds: target });
      }
      return;
    }

    const st = p.getPlayerState();
    if (st === STATE.ENDED && s.playing) {
      // Do not restart a finished video just because the room clock is still "playing".
      if (!endedSentRef.current) {
        endedSentRef.current = true;
        onEndedRef.current(p.getDuration());
      }
      return;
    }
    if (st !== STATE.ENDED) endedSentRef.current = false;

    const drift = p.getCurrentTime() - target;
    const threshold = s.playing ? SYNC.playingDriftThreshold : SYNC.pausedDriftThreshold;
    if (st !== STATE.BUFFERING && Math.abs(drift) > threshold && now - lastSeekRef.current > SYNC.minSeekIntervalMs) {
      p.seekTo(target, true);
      lastSeekRef.current = now;
    }

    if (s.playing) {
      if (st !== STATE.PLAYING && st !== STATE.BUFFERING) {
        p.playVideo();
        armBlockCheck();
      }
    } else if (st === STATE.PLAYING || st === STATE.BUFFERING) {
      p.pauseVideo();
    }
  }, [armBlockCheck]);

  // Create the player once.
  useEffect(() => {
    let cancelled = false;
    let player: YTPlayer | null = null;
    const host = containerRef.current;
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !host) return;
        const mount = document.createElement('div');
        host.appendChild(mount);
        player = new YT.Player(mount, {
          width: '100%',
          height: '100%',
          playerVars: {
            controls: 0,
            disablekb: 1,
            fs: 0,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              readyRef.current = true;
              setUi((u) => ({ ...u, ready: true }));
              reconcile();
            },
            onStateChange: (e) => {
              if (e.data === STATE.PLAYING) {
                window.clearTimeout(blockTimerRef.current);
                setBlocked(false);
              }
            },
            onError: (e) => setError(ERROR_MESSAGES[e.data] ?? 'The YouTube player could not play this video.'),
          },
        });
        playerRef.current = player;
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(blockTimerRef.current);
      readyRef.current = false;
      loadedIdRef.current = null;
      playerRef.current = null;
      try {
        player?.destroy();
      } catch {
        /* player already gone */
      }
    };
  }, [reconcile]);

  // React to every authoritative state change immediately.
  useEffect(() => {
    if (playback?.videoId) setError((e) => (loadedIdRef.current === playback.videoId ? e : null));
    reconcile();
  }, [playback, reconcile]);

  // Poll for the UI and re-check drift every two seconds.
  useEffect(() => {
    let tick = 0;
    const id = window.setInterval(() => {
      tick += 1;
      const p = playerRef.current;
      if (!p || !readyRef.current) return;
      try {
        const s = playbackRef.current;
        const target = s ? expectedPosition(s, nowRef.current()) : 0;
        const time = p.getCurrentTime();
        setUi({
          ready: true,
          time,
          duration: p.getDuration() || 0,
          volume: p.getVolume(),
          muted: p.isMuted(),
          drift: s?.videoId ? time - target : 0,
        });
        if (tick % Math.round((SYNC.reconcileIntervalMs / 250)) === 0) reconcile();
      } catch {
        /* player is mid-load */
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [reconcile]);

  /** Must be called from a click: browsers only allow sound after a user gesture. */
  const resume = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    p.unMute();
    p.playVideo();
    setBlocked(false);
    reconcile();
  }, [reconcile]);

  const setVolume = useCallback((v: number) => {
    const p = playerRef.current;
    if (!p) return;
    p.setVolume(v);
    if (v > 0 && p.isMuted()) p.unMute();
  }, []);

  const toggleMute = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isMuted()) p.unMute();
    else p.mute();
  }, []);

  const getCurrentTime = useCallback(() => playerRef.current?.getCurrentTime() ?? 0, []);

  return { containerRef, ui, blocked, error, resume, setVolume, toggleMute, getCurrentTime };
}
