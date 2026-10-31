import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { LogOut, Settings, Tv2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Avatar, Button } from './ui';
import { Logo } from './Logo';

export function AccountMenu() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const onLogout = async () => {
    setOpen(false);
    try {
      await logout();
      toast.success('Logged out');
    } catch {
      toast.info('Logged out on this device. The server could not be reached to end the session.');
    }
    navigate('/');
  };

  const item = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/5';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
        className="rounded-full ring-offset-2 ring-offset-[#071521] transition hover:opacity-90"
      >
        <Avatar name={user.name} seed={user.id} size={36} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-64 rounded-panel border border-white/10 bg-slate-950/95 p-1.5 shadow-2xl shadow-black/30">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold text-white">{user.name}</p>
            <p className="truncate text-xs text-slate-300">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-white/10" />
          <Link role="menuitem" to="/rooms" onClick={() => setOpen(false)} className={item}>
            <Tv2 className="size-4 text-slate-300" aria-hidden /> Your rooms
          </Link>
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)} className={item}>
            <Settings className="size-4 text-slate-300" aria-hidden /> Settings
          </Link>
          <button role="menuitem" type="button" onClick={onLogout} className={item}>
            <LogOut className="size-4 text-slate-300" aria-hidden /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function Header({ showNav = true }: { showNav?: boolean }) {
  const { user, status } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-full px-3 py-1.5 text-sm font-medium transition hover:bg-white/5 ${isActive ? 'bg-white/6 text-white' : 'text-slate-200'}`;
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#071521]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Logo />
        <div className="flex items-center gap-2">
          {showNav && user && (
            <nav aria-label="Main" className="hidden sm:block">
              <NavLink to="/rooms" className={link}>
                Your rooms
              </NavLink>
            </nav>
          )}
          {status === 'loading' ? null : user ? (
            <AccountMenu />
          ) : (
            <>
              <Link to="/login" className="rounded-full px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-white/5">
                Log in
              </Link>
              <Link
                to="/register"
                className="inline-flex h-9 items-center rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 px-4 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:brightness-110"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#071521]/70">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between">
        <Logo className="text-base text-white" />
        <p className="max-w-xl">
          HGV Player is an independent project and is not affiliated with YouTube. Videos play through YouTube's official embedded player, so YouTube's terms and each video's embedding settings apply.
        </p>
      </div>
    </footer>
  );
}

export function AppShell({ children, showFooter = true }: { children: ReactNode; showFooter?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900">
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1 premium-shell">
        {children}
      </main>
      {showFooter && <Footer />}
    </div>
  );
}

export function PageHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-bold text-white">{title}</h1>
      {children && <p className="mt-1 text-slate-300">{children}</p>}
    </div>
  );
}

export { Button };
