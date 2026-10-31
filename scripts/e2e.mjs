/**
 * Two-browser end-to-end check of the main watch-party flow.
 *
 * Needs: the backend and the frontend running (for example `npm run dev`, or the built server plus
 * `npm run preview -w frontend`), MongoDB reachable by the backend, and Playwright with Chromium.
 *
 *   E2E_BASE_URL=http://localhost:5173 node scripts/e2e.mjs
 *
 * IMPORTANT: this replaces the YouTube IFrame API with a small in-page stub that records the
 * commands it receives. It therefore verifies that every browser is *told* to load, play, pause and
 * seek correctly through the server, and that permissions hold. It does not prove that real
 * YouTube video plays - check that manually in a normal browser.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const VIDEO_A = 'dQw4w9WgXcQ';
const VIDEO_B = '9bZkp7q19f0';
const stamp = Date.now();

const YT_STUB = `
(() => {
  window.__yt = { calls: [] };
  const log = (c) => window.__yt.calls.push(c);
  window.YT = {
    Player: function (el, opts) {
      let vid = null, state = -1, base = 0, since = 0, muted = false, volume = 100;
      const now = () => base + (state === 1 ? (Date.now() - since) / 1000 : 0);
      const set = (s, t) => { base = t ?? now(); state = s; since = Date.now(); };
      this.getVideoData = () => ({ video_id: vid });
      this.loadVideoById = (a) => { vid = a.videoId; set(1, a.startSeconds || 0); log('load:' + vid); };
      this.cueVideoById = (a) => { vid = a.videoId; set(5, a.startSeconds || 0); log('cue:' + vid); };
      this.playVideo = () => { set(1); log('play'); };
      this.pauseVideo = () => { set(2); log('pause'); };
      this.seekTo = (t) => { base = t; since = Date.now(); log('seek:' + Math.round(t)); };
      this.getCurrentTime = () => now();
      this.getDuration = () => 300;
      this.getPlayerState = () => state;
      this.getVolume = () => volume;
      this.setVolume = (v) => { volume = v; };
      this.isMuted = () => muted;
      this.mute = () => { muted = true; };
      this.unMute = () => { muted = false; };
      this.destroy = () => {};
      setTimeout(() => opts.events && opts.events.onReady && opts.events.onReady(), 30);
    },
  };
  setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 0);
})();
`;

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  -> ${detail}` : ''}`);
}

async function newUser(browser, label) {
  const context = await browser.newContext();
  await context.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: YT_STUB }),
  );
  await context.route('https://www.youtube.com/oembed**', (route) => route.fulfill({ status: 404, body: '{}' }));
  await context.route('https://i.ytimg.com/**', (route) => route.fulfill({ status: 204 }));
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${label}] page error: ${e.message}`));
  return { context, page, label };
}

async function register(user, next = '/rooms') {
  const { page, label } = user;
  await page.goto(`${BASE}/register?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Name', { exact: true }).fill(label);
  await page.getByLabel('Email').fill(`${label.toLowerCase()}.${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByLabel('Confirm password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
}

const calls = (user) => user.page.evaluate(() => (window.__yt ? window.__yt.calls.slice() : []));
async function waitForCall(user, predicate, what, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const list = await calls(user);
    if (predicate(list)) return true;
    await user.page.waitForTimeout(150);
  }
  console.log(`   (${user.label} calls: ${JSON.stringify(await calls(user))})`);
  return false;
}

const browser = await chromium.launch();
try {
  const host = await newUser(browser, 'Hostess');
  const guest = await newUser(browser, 'Guesty');

  // 1. Host registers and creates a room.
  await register(host);
  await host.page.getByLabel('Room name').fill('E2E Movie Night');
  await host.page.getByRole('button', { name: 'Create room' }).click();
  await host.page.waitForURL(/\/room\/[A-Z2-9]{10}$/);
  const roomUrl = host.page.url();
  const code = roomUrl.split('/room/')[1];
  const visible = (locator, timeout = 8000) => locator.waitFor({ state: 'visible', timeout }).then(() => true, () => false);
  check('Host creates a room and lands in it', await visible(host.page.getByRole('heading', { name: 'E2E Movie Night' })));
  check('Host sees the Host badge', await visible(host.page.getByText('You are').locator('..').getByText('Host', { exact: true })));

  // 2. Guest joins through the invite link.
  await register(guest, `/room/${code}`);
  await guest.page.getByRole('button', { name: 'Join room' }).click();
  await guest.page.getByRole('heading', { name: 'E2E Movie Night' }).waitFor();
  check('Guest joins via the invite link', true);
  await host.page.getByText('2 in room').waitFor({ timeout: 8000 }).catch(() => undefined);
  check('Host sees the guest appear in the participant list', await host.page.getByRole('list', { name: 'Participants' }).getByText('Guesty').isVisible());

  // 3. Host loads a video: the guest's player is told to load it.
  await host.page.getByLabel('Video link').fill(`https://youtu.be/${VIDEO_A}`);
  await host.page.getByRole('button', { name: 'Load video' }).click();
  check('Video change reaches the guest player', await waitForCall(guest, (c) => c.includes(`cue:${VIDEO_A}`), 'guest cue'));
  check('Video change reaches the host player', await waitForCall(host, (c) => c.includes(`cue:${VIDEO_A}`), 'host cue'));

  // 4. Play / seek / pause propagate.
  await host.page.getByRole('button', { name: 'Play for everyone' }).click();
  check('Play reaches the guest player', await waitForCall(guest, (c) => c.includes('play'), 'guest play'));
  const slider = host.page.getByRole('slider', { name: 'Seek' });
  await slider.focus();
  await slider.press('PageUp');
  check('Seek reaches the guest player', await waitForCall(guest, (c) => c.some((x) => x.startsWith('seek:')), 'guest seek'));
  await host.page.getByRole('button', { name: 'Pause for everyone' }).click();
  check('Pause reaches the guest player', await waitForCall(guest, (c) => c.lastIndexOf('pause') > c.indexOf('play'), 'guest pause'));

  // 5. A participant cannot control playback from the UI.
  const guestPlay = guest.page.getByRole('button', { name: 'Play for everyone' });
  check('Participant play button is disabled', await guestPlay.isDisabled());
  check('Participant sees a request form, not the direct video form', (await guest.page.getByLabel('Video link').count()) === 0 && (await guest.page.getByLabel('Suggest a video').count()) === 1);

  // 6. Participant submits a request; the Host approves it; everyone switches video.
  await guest.page.getByLabel('Suggest a video').fill(`https://youtu.be/${VIDEO_B}`);
  await guest.page.getByRole('button', { name: 'Send request' }).click();
  await guest.page.getByText('Waiting for approval').waitFor({ timeout: 8000 });
  check('Guest sees the request as waiting for approval', true);
  await host.page.getByRole('tab', { name: /Requests/ }).click();
  await host.page.getByRole('button', { name: /Approve/ }).click();
  check('Approved request switches the guest player', await waitForCall(guest, (c) => c.includes(`cue:${VIDEO_B}`), 'guest cue B'));
  check('Approved request switches the host player', await waitForCall(host, (c) => c.includes(`cue:${VIDEO_B}`), 'host cue B'));
  await guest.page.getByText('Approved by Hostess').waitFor({ timeout: 8000 });
  check('Guest is told the request was approved', true);

  // 7. Host promotes the guest to Moderator; the guest can now control playback.
  await host.page.getByRole('tab', { name: /People/ }).click();
  await host.page.getByRole('button', { name: 'Manage Guesty' }).click();
  await host.page.getByRole('menuitem', { name: 'Make moderator' }).click();
  await guestPlay.waitFor({ state: 'visible' });
  await guest.page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Play for everyone');
    return b && !b.disabled;
  }, undefined, { timeout: 8000 });
  check('Moderator play button becomes enabled', true);
  const before = (await calls(host)).length;
  await guestPlay.click();
  check('Moderator can start playback for the room', await waitForCall(host, (c) => c.slice(before).includes('play'), 'host play after mod'));
  check('Guest now sees the direct video form', (await guest.page.getByLabel('Video link').count()) === 1);

  // 8. Host removes the guest: the guest is cut off and cannot return.
  await host.page.getByRole('button', { name: 'Manage Guesty' }).click();
  await host.page.getByRole('menuitem', { name: 'Remove from room' }).click();
  await host.page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await guest.page.getByRole('heading', { name: 'You were removed from this room' }).waitFor({ timeout: 8000 });
  check('Removed guest sees the removal screen', true);
  await guest.page.goto(roomUrl);
  check('Removed guest cannot rejoin', await visible(guest.page.getByRole('heading', { name: 'You were removed from this room' })));
  await host.page.waitForFunction(() => !document.body.innerText.includes('Guesty'), undefined, { timeout: 8000 }).catch(() => undefined);
  check('Host list no longer shows the removed guest', (await host.page.getByRole('list', { name: 'Participants' }).getByText('Guesty').count()) === 0);

  // 9. Logout.
  await host.page.getByRole('button', { name: /Account menu/ }).click();
  await host.page.getByRole('menuitem', { name: 'Log out' }).click();
  await host.page.waitForURL(`${BASE}/`);
  await host.page.goto(roomUrl);
  await host.page.waitForURL(/\/login/);
  check('After logout, room pages require login again', true);
} catch (err) {
  failures += 1;
  console.log(`FAIL  unexpected error: ${err.message}`);
} finally {
  await browser.close();
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
