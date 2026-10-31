import { useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Lock, Maximize, Pause, Play, Volume2, VolumeX, Loader2 } from 'lucide-react';
import type { PlaybackState } from '@hgv/shared';
import { useYouTubePlayer } from '../hooks/useYouTubePlayer';
import { formatTime } from '../utils/format';
import { Button } from './ui';

interface Props {
  playback: PlaybackState | null;
  getServerNow: () => number;
  /** Host and Moderators. Everyone else sees a read-only player. */
  canControl: boolean;
  onPlay: (position: number) => Promise<unknown>;
  onPause: (position: number) => Promise<unknown>;
  onSeek: (position: number) => Promise<unknown>;
  onError: (message: string) => void;
  emptyHint: ReactNode;
}

export function PlayerStage({ playback, getServerNow, canControl, onPlay, onPause, onSeek, onError, emptyHint }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const player = useYouTubePlayer({
    playback,
    getServerNow,
    onEnded: (duration) => {
      if (canControl) onPause(duration).catch(() => undefined);
    },
  });
  const { ui } = player;

  const hasVideo = Boolean(playback?.videoId);
  const playing = Boolean(playback?.playing);
  const controllable = canControl && hasVideo;

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'That did not work.');
    }
  };

  const togglePlay = () => {
    if (!controllable) return;
    const position = ui.time;
    void guard(() => (playing ? onPause(position) : onPlay(position)));
  };

  const commitSeek = () => {
    if (drag === null) return;
    const target = Math.max(0, Math.min(drag, ui.duration || drag));
    setDrag(null);
    if (controllable) void guard(() => onSeek(target));
  };

  const fullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const shownTime = drag ?? ui.time;
  const pct = ui.duration > 0 ? Math.min(100, (shownTime / ui.duration) * 100) : 0;
  const inSync = Math.abs(ui.drift) <= 2.5;

  return (
    <div ref={wrapperRef} className="overflow-hidden rounded-panel bg-black text-white">
      <div className="relative aspect-video">
        <div ref={player.containerRef} className="absolute inset-0 [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:size-full" />

        {/* This layer covers the iframe so nobody can interact with YouTube's own controls. */}
        <div
          className="absolute inset-0 z-10 grid place-items-center"
          onClick={togglePlay}
          style={{ cursor: controllable ? 'pointer' : 'default' }}
        >
          {!hasVideo && (
            <div className="absolute inset-0 grid place-items-center bg-[#151515] p-6 text-center">
              <div className="max-w-sm">
                <p className="text-lg font-semibold">No video yet</p>
                <div className="mt-1 text-sm text-white/70">{emptyHint}</div>
              </div>
            </div>
          )}
          {hasVideo && player.error && (
            <div role="alert" className="absolute inset-0 grid place-items-center bg-[#151515]/95 p-6 text-center">
              <div className="max-w-sm">
                <AlertTriangle className="mx-auto mb-2 size-7 text-brand" aria-hidden />
                <p className="font-semibold">This video cannot be played here</p>
                <p className="mt-1 text-sm text-white/70">{player.error}</p>
                {canControl && <p className="mt-2 text-sm text-white/70">Load a different video to continue.</p>}
              </div>
            </div>
          )}
          {hasVideo && !player.error && !ui.ready && (
            <div className="absolute inset-0 grid place-items-center bg-[#151515]">
              <span role="status" className="inline-flex items-center gap-2 text-sm text-white/80">
                <Loader2 className="size-5 animate-spin" aria-hidden /> Loading player...
              </span>
            </div>
          )}
          {hasVideo && !player.error && player.blocked && (
            <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center">
              <div>
                <p className="font-semibold">The room is playing</p>
                <p className="mt-1 mb-4 text-sm text-white/75">Your browser blocked automatic playback. Click once to join in with sound.</p>
                <Button
                  size="lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    player.resume();
                  }}
                >
                  <Play className="size-5" aria-hidden /> Join playback
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-3 pt-1 pb-2.5">
        <input
          type="range"
          className="scrubber"
          aria-label="Seek"
          min={0}
          max={ui.duration || 1}
          step={0.1}
          value={Math.min(shownTime, ui.duration || 1)}
          disabled={!controllable}
          style={{ ['--pct' as string]: `${pct}%` }}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commitSeek}
          onKeyUp={commitSeek}
          onBlur={commitSeek}
        />
        <div className="mt-0.5 flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!controllable}
            aria-label={playing ? 'Pause for everyone' : 'Play for everyone'}
            className="rounded-full p-2 hover:bg-white/15 disabled:text-white/40 disabled:hover:bg-transparent"
          >
            {playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={player.toggleMute}
            aria-label={ui.muted ? 'Unmute' : 'Mute'}
            className="rounded-full p-2 hover:bg-white/15"
          >
            {ui.muted || ui.volume === 0 ? <VolumeX className="size-5" aria-hidden /> : <Volume2 className="size-5" aria-hidden />}
          </button>
          <input
            type="range"
            aria-label="Volume"
            min={0}
            max={100}
            value={ui.muted ? 0 : ui.volume}
            onChange={(e) => player.setVolume(Number(e.target.value))}
            className="scrubber hidden w-20 sm:block"
            style={{ ['--pct' as string]: `${ui.muted ? 0 : ui.volume}%` }}
          />
          <p className="ml-1 text-xs tabular-nums text-white/80" aria-label="Playback position">
            {formatTime(shownTime)} / {formatTime(ui.duration)}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {hasVideo && (
              <span className={`hidden items-center gap-1.5 text-xs sm:inline-flex ${player.blocked ? 'text-white' : 'text-white/70'}`}>
                <span className={`size-2 rounded-full ${player.blocked ? 'bg-brand' : inSync ? 'bg-[#3fb96b]' : 'bg-[#f0a020]'}`} aria-hidden />
                {player.blocked ? 'Click to join' : inSync ? 'In sync' : 'Catching up'}
              </span>
            )}
            {!canControl && (
              <span className="inline-flex items-center gap-1 text-xs text-white/70" title="Only the host and moderators can control playback">
                <Lock className="size-3.5" aria-hidden /> Host controls playback
              </span>
            )}
            <button type="button" onClick={fullscreen} aria-label="Toggle fullscreen" className="rounded-full p-2 hover:bg-white/15">
              <Maximize className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
