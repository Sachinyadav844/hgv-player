import { Link } from 'react-router-dom';
import { Link2, ListChecks, Play, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { JoinRoomForm } from '../components/JoinRoomForm';
import { Avatar } from '../components/ui';
import type { Role } from '@hgv/shared';

const LANES: { name: string; role: Role; from: string }[] = [
  { name: 'Maya', role: 'HOST', from: '38%' },
  { name: 'Dev', role: 'MODERATOR', from: '9%' },
  { name: 'Sam', role: 'PARTICIPANT', from: '71%' },
  { name: 'Lena', role: 'PARTICIPANT', from: '22%' },
];

function SyncIllustration() {
  return (
    <figure className="premium-panel relative overflow-hidden rounded-[24px] bg-[#0a1320] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(124,92,255,0.32),transparent_44%)]" />
      <div className="relative grid aspect-video place-items-center bg-[linear-gradient(135deg,rgba(19,27,40,0.9),rgba(12,17,25,0.96))]">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=1200&q=80')] bg-cover bg-center opacity-25" />
        <div className="relative grid size-20 place-items-center rounded-full bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 shadow-[0_0_40px_rgba(124,92,255,0.55)]">
          <svg viewBox="0 0 24 24" className="ml-1 size-8" fill="#fff" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
      <div className="relative space-y-3 px-4 py-4">
        {LANES.map((lane) => (
          <div key={lane.name} className="flex items-center gap-3">
            <div className="flex w-28 shrink-0 items-center gap-2">
              <Avatar name={lane.name} size={22} />
              <span className="truncate text-xs text-slate-200">{lane.name}</span>
            </div>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="playhead-fill relative h-full rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-400"
                style={{ ['--from' as string]: lane.from }}
              >
                <span className="absolute top-1/2 right-0 size-3 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-white bg-violet-500" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <figcaption className="relative flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 px-4 py-3 text-xs text-slate-300">
        <span>Everyone lands on the host's playback position.</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold">
          <span className="rounded-full bg-violet-500/90 px-2 py-0.5 text-white">Host</span>
          <span className="rounded-full border border-white/25 px-2 py-0.5 text-white">Moderator</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-white">Participant</span>
        </span>
      </figcaption>
    </figure>
  );
}

const FEATURES = [
  {
    icon: RefreshCw,
    title: 'Playback that stays together',
    text: 'Play, pause and seek through the server so everyone follows the same moment. Late joiners land on the correct position automatically.',
  },
  {
    icon: ShieldCheck,
    title: 'You decide who holds the remote',
    text: 'The host and moderators control playback while the room keeps everyone else in sync and blocks unauthorized takeover.',
  },
  {
    icon: ListChecks,
    title: 'Suggest, then approve',
    text: 'Participants can propose a video, and the host or moderator decides what the room plays next without losing the session flow.',
  },
  {
    icon: Link2,
    title: 'One link to invite',
    text: 'Share one QR-free room link and keep the party private. Remove anyone who should not be there and they cannot rejoin.',
  },
];

const STEPS = [
  { title: 'Create a room', text: 'Sign up, name your room, and you become its host.' },
  { title: 'Share the invite link', text: 'Friends open the link, sign in and join as participants.' },
  { title: 'Paste a YouTube link and press play', text: 'Everyone sees the same video at the same moment.' },
];

export default function Landing() {
  return (
    <AppShell>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 lg:grid-cols-[1fr_1.05fr] lg:py-20">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-sm font-medium text-violet-200">
            <Sparkles className="size-3.5" aria-hidden />
            Shared viewing, reimagined
          </div>
          <h1 className="mt-5 text-4xl font-black tracking-[-0.06em] text-white sm:text-5xl lg:text-6xl">
            Watch YouTube together, in sync.
          </h1>
          <p className="mt-3 max-w-xl text-lg font-medium text-violet-200">
            Your Videos. Your People. One Shared Experience.
          </p>
          <p className="mt-5 max-w-xl text-lg text-slate-300">
            Create a room, invite your friends, and watch YouTube together with synchronized playback, simple controls, and a premium shared-room experience.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/rooms"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 px-6 text-base font-semibold text-white shadow-[0_18px_40px_rgba(124,92,255,0.35)] transition hover:brightness-110"
              aria-label="Create a watch party"
            >
              <Play className="size-4 fill-current" aria-hidden />
              Create a watch party
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex h-12 items-center rounded-full border border-white/15 bg-white/3 px-6 text-base font-semibold text-slate-100 transition hover:bg-white/6"
            >
              Explore How It Works
            </a>
          </div>
          <div className="mt-8 max-w-md border-t border-white/10 pt-6">
            <JoinRoomForm id="landing-join" label="Already have a room? Join with a code or invite link" />
          </div>
        </div>
        <SyncIllustration />
      </section>

      <section id="features" className="border-t border-white/10 bg-[#091722]/70 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Built for watch parties that feel premium</h2>
          <ul className="mt-8 grid gap-x-12 gap-y-8 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                <div className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-200">
                  <Icon className="size-5" aria-hidden />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">{title}</h3>
                  <p className="mt-1 max-w-md text-slate-300">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-bold text-white sm:text-3xl">How it works</h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-sm font-semibold text-violet-200">Step {i + 1}</p>
              <h3 className="mt-2 text-lg font-bold text-white">{step.title}</h3>
              <p className="mt-2 text-slate-300">{step.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 max-w-2xl text-sm text-slate-300">
          Good to know: sync depends on each person's connection, and some videos do not allow embedding. Browsers can also block autoplay, so you may be asked to click once to join playback.
        </p>
      </section>
    </AppShell>
  );
}
