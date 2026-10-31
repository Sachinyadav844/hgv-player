import { Link } from 'react-router-dom';
import { Link2, ListChecks, RefreshCw, ShieldCheck } from 'lucide-react';
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

/** The hero: four playback bars that start out of step and settle on the host's position. */
function SyncIllustration() {
  return (
    <figure className="overflow-hidden rounded-panel bg-black text-white">
      <div className="grid aspect-video place-items-center bg-[#151515]">
        <div className="grid size-16 place-items-center rounded-full bg-brand">
          <svg viewBox="0 0 24 24" className="ml-1 size-7" fill="#fff" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
      <div className="space-y-2.5 px-4 py-4">
        {LANES.map((lane) => (
          <div key={lane.name} className="flex items-center gap-3">
            <div className="flex w-28 shrink-0 items-center gap-2">
              <Avatar name={lane.name} size={22} />
              <span className="truncate text-xs text-white/85">{lane.name}</span>
            </div>
            <div className="relative h-1 flex-1 rounded-full bg-white/25">
              <div
                className="playhead-fill relative h-1 rounded-full bg-brand"
                style={{ ['--from' as string]: lane.from }}
              >
                <span className="absolute top-1/2 right-0 size-3 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-white bg-brand" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/15 px-4 py-3 text-xs text-white/70">
        <span>Illustration: everyone's position settles on the host's.</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold">
          <span className="rounded-full bg-brand px-2 py-0.5 text-white">Host</span>
          <span className="rounded-full border border-white/70 px-2 py-0.5 text-white">Moderator</span>
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-white">Participant</span>
        </span>
      </figcaption>
    </figure>
  );
}

const FEATURES = [
  {
    icon: RefreshCw,
    title: 'Playback that stays together',
    text: 'Play, pause and seek go through the server, so every player follows the same position. People who join late or drop and reconnect start at the right moment.',
  },
  {
    icon: ShieldCheck,
    title: 'You decide who holds the remote',
    text: 'The host and moderators control the video. Everyone else watches, and the server rejects any attempt to take over.',
  },
  {
    icon: ListChecks,
    title: 'Suggest, then approve',
    text: 'Participants send a video suggestion. The host or a moderator approves it or turns it down, and the room switches for everyone.',
  },
  {
    icon: Link2,
    title: 'One link to invite',
    text: 'Copy the invite link or share the room code. Remove anyone who should not be there and they cannot rejoin.',
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
          <h1 className="text-4xl font-extrabold sm:text-5xl lg:text-6xl">Watch YouTube together, in sync.</h1>
          <p className="mt-5 max-w-lg text-lg text-muted">
            Make a room, send the link, and every player plays, pauses and seeks at the same moment. You decide who holds the remote.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/rooms"
              className="inline-flex h-12 items-center rounded-full bg-brand px-6 text-base font-semibold text-white hover:bg-brand-dark"
            >
              Create a watch party
            </Link>
          </div>
          <div className="mt-8 max-w-md border-t border-line pt-6">
            <JoinRoomForm id="landing-join" label="Already have a room? Join with a code or invite link" />
          </div>
        </div>
        <SyncIllustration />
      </section>

      <section id="features" className="border-t border-line bg-wash">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-bold sm:text-3xl">What a watch party gives you</h2>
          <ul className="mt-8 grid gap-x-12 gap-y-8 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <Icon className="mt-1 size-6 shrink-0 text-brand" aria-hidden />
                <div>
                  <h3 className="text-lg font-bold">{title}</h3>
                  <p className="mt-1 max-w-md text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-bold sm:text-3xl">How it works</h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="border-t-2 border-ink pt-4">
              <p className="text-sm font-semibold text-brand">Step {i + 1}</p>
              <h3 className="mt-1 text-lg font-bold">{step.title}</h3>
              <p className="mt-1 text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 max-w-2xl text-sm text-muted">
          Good to know: sync depends on each person's connection, and some videos do not allow embedding. Browsers can also block autoplay, so you may be asked to click once to join playback.
        </p>
      </section>
    </AppShell>
  );
}
