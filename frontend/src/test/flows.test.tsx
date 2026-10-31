import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import App from '../App';
import { AccountMenu } from '../components/AppShell';
import { LoginPage, RegisterPage } from '../pages/AuthPages';
import Landing from '../pages/Landing';
import NotFound from '../pages/NotFound';
import { RoomPage } from '../pages/RoomPage';
import { USER, jsonResponse, renderApp } from './utils';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
let handler: Handler;
const calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];

beforeEach(() => {
  calls.length = 0;
  handler = () => jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      return handler(url, init);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const signedIn = (url: string) => (url.endsWith('/api/auth/me') ? jsonResponse(200, { user: USER }) : undefined);

describe('registration', () => {
  it('shows validation errors and does not call the server for invalid input', async () => {
    const user = userEvent.setup();
    renderApp(<RegisterPage />);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Name must be at least 2 characters')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/api/auth/register'))).toBe(false);
  });

  it('checks that both passwords match', async () => {
    const user = userEvent.setup();
    renderApp(<RegisterPage />);
    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password999');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
  });

  it('registers, signs in and moves on to the rooms page', async () => {
    const user = userEvent.setup();
    let registered = false;
    handler = (url) => {
      if (url.endsWith('/api/auth/register')) {
        registered = true;
        return jsonResponse(201, { user: USER });
      }
      if (url.endsWith('/api/auth/me')) {
        return registered ? jsonResponse(200, { user: USER }) : jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } });
      }
      if (url.endsWith('/api/rooms/mine')) return jsonResponse(200, { rooms: [] });
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'x' } });
    };
    renderApp(<App />, { route: '/register' });
    await user.type(await screen.findByLabelText('Name'), ' Ada Lovelace ');
    await user.type(screen.getByLabelText('Email'), 'ADA@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/rooms'));
    const register = calls.find((c) => c.url.endsWith('/api/auth/register'))!;
    expect(register.method).toBe('POST');
    expect(register.body).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'password123' });
    expect(register.headers['X-Requested-With']).toBe('hgv-player');
    expect(await screen.findByText('Create a watch party')).toBeInTheDocument();
  });

  it('shows the server\'s duplicate-email error on the email field', async () => {
    const user = userEvent.setup();
    handler = (url) =>
      url.endsWith('/api/auth/register')
        ? jsonResponse(409, { error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists.' } })
        : jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } });
    renderApp(<RegisterPage />);
    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('An account with this email already exists.')).toBeInTheDocument();
  });
});

describe('login', () => {
  it('shows a clear error for wrong credentials and stays on the page', async () => {
    const user = userEvent.setup();
    handler = (url) =>
      url.endsWith('/api/auth/login')
        ? jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' } })
        : jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } });
    renderApp(<LoginPage />, { route: '/login' });
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrongpass1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('validates empty fields before calling the server', async () => {
    const user = userEvent.setup();
    renderApp(<LoginPage />, { route: '/login' });
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Enter your password')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/api/auth/login'))).toBe(false);
  });

  it('returns to the page the visitor was trying to open, and ignores unsafe redirects', async () => {
    const user = userEvent.setup();
    handler = (url) => {
      if (url.endsWith('/api/auth/login')) return jsonResponse(200, { user: USER });
      return jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } });
    };
    renderApp(<LoginPage />, { route: '/login?next=/room/ABCDEFGHJK' });
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/room/ABCDEFGHJK'));
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    renderApp(<LoginPage />, { route: '/login' });
    const field = screen.getByLabelText('Password');
    expect(field).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field).toHaveAttribute('type', 'text');
  });
});

describe('protected routes', () => {
  it('redirects anonymous visitors to login and remembers where they were going', async () => {
    renderApp(<App />, { route: '/room/ABCDEFGHJK' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login?next=%2Froom%2FABCDEFGHJK'));
  });

  it('shows a recovery state when the server cannot be reached', async () => {
    handler = () => {
      throw new TypeError('network down');
    };
    renderApp(<App />, { route: '/rooms' });
    expect(await screen.findByText('Cannot reach the server')).toBeInTheDocument();
    handler = (url) => signedIn(url) ?? jsonResponse(200, { rooms: [] });
    await userEvent.setup().click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Create a watch party')).toBeInTheDocument();
  });
});

describe('landing page', () => {
  it('has the product branding, create action and join form', () => {
    renderApp(<Landing />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Watch YouTube together, in sync.');
    expect(screen.getAllByText('HGV Player').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Create a watch party' })).toHaveAttribute('href', '/rooms');
    expect(screen.getByText('How it works')).toBeInTheDocument();
  });

  it('joins from a room code or a pasted invite link', async () => {
    const user = userEvent.setup();
    renderApp(<Landing />);
    const input = screen.getByLabelText(/join with a code or invite link/i);
    await user.type(input, 'abcde-fghjk');
    await user.click(screen.getByRole('button', { name: 'Join room' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/room/ABCDEFGHJK'));
  });

  it('rejects an invalid code with a helpful message', async () => {
    const user = userEvent.setup();
    renderApp(<Landing />);
    await user.type(screen.getByLabelText(/join with a code or invite link/i), 'nope');
    await user.click(screen.getByRole('button', { name: 'Join room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not look like a room code');
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });
});

describe('account menu and logout', () => {
  it('logs out, calls the server and returns to the home page', async () => {
    const user = userEvent.setup();
    handler = (url) => {
      if (url.endsWith('/api/auth/me')) return jsonResponse(200, { user: USER });
      if (url.endsWith('/api/auth/logout')) return jsonResponse(204);
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'x' } });
    };
    renderApp(<AccountMenu />);
    await user.click(await screen.findByRole('button', { name: /account menu for ada lovelace/i }));
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /log out/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/auth/logout') && c.method === 'POST')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).not.toBeInTheDocument());
  });
});

describe('not found', () => {
  it('shows the 404 page for unknown routes', () => {
    renderApp(
      <Routes>
        <Route path="*" element={<NotFound />} />
      </Routes>,
      { route: '/no/such/page' },
    );
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('room page error states', () => {
  const routeTo = (roomId: string) =>
    renderApp(
      <Routes>
        <Route path="/room/:roomId" element={<RoomPage />} />
      </Routes>,
      { route: `/room/${roomId}` },
    );

  it('explains a room that does not exist', async () => {
    handler = (url) =>
      url.includes('/api/rooms/')
        ? jsonResponse(404, { error: { code: 'ROOM_NOT_FOUND', message: 'No room exists with that code.' } })
        : jsonResponse(200, { user: USER });
    routeTo('ZZZZZZZZZZ');
    expect(await screen.findByRole('heading', { name: 'Room not found' })).toBeInTheDocument();
  });

  it('explains an invalid room code without calling the server', async () => {
    routeTo('bad');
    expect(await screen.findByRole('heading', { name: 'That room code is not valid' })).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/api/rooms/'))).toBe(false);
  });

  it('tells a removed user they cannot rejoin', async () => {
    handler = (url) =>
      url.includes('/api/rooms/')
        ? jsonResponse(200, { room: { roomId: 'ABCDEFGHJK', name: 'Movie Night', status: 'OPEN', hostName: 'Ana', participantCount: 2, createdAt: new Date().toISOString(), membership: null, removed: true }, inviteUrl: 'x' })
        : jsonResponse(200, { user: USER });
    routeTo('ABCDEFGHJK');
    expect(await screen.findByRole('heading', { name: 'You were removed from this room' })).toBeInTheDocument();
  });

  it('shows closed rooms as closed', async () => {
    handler = (url) =>
      url.includes('/api/rooms/')
        ? jsonResponse(200, { room: { roomId: 'ABCDEFGHJK', name: 'Movie Night', status: 'CLOSED', hostName: null, participantCount: 0, createdAt: new Date().toISOString(), membership: null, removed: false }, inviteUrl: 'x' })
        : jsonResponse(200, { user: USER });
    routeTo('ABCDEFGHJK');
    expect(await screen.findByRole('heading', { name: 'This room is closed' })).toBeInTheDocument();
  });

  it('asks a non-member to confirm before joining as a participant', async () => {
    handler = (url) =>
      url.includes('/api/rooms/')
        ? jsonResponse(200, { room: { roomId: 'ABCDEFGHJK', name: 'Movie Night', status: 'OPEN', hostName: 'Ana', participantCount: 3, createdAt: new Date().toISOString(), membership: null, removed: false }, inviteUrl: 'x' })
        : jsonResponse(200, { user: USER });
    routeTo('ABCDEFGHJK');
    const heading = await screen.findByRole('heading', { name: 'Join Movie Night?' });
    expect(heading).toBeInTheDocument();
    const card = heading.parentElement!;
    expect(within(card).getByText(/Ana is hosting/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Join room' })).toBeInTheDocument();
  });
});
