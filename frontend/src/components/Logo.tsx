import { Link } from 'react-router-dom';

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="hgv-logo-gradient" x1="4" x2="28" y1="5" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF78C8" />
          <stop offset="42%" stopColor="#7C5CFF" />
          <stop offset="100%" stopColor="#5AD4FF" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="10" fill="#0B1220" />
      <path d="M7 23.5V8.5C7 7.12 8.12 6 9.5 6H11.6C12.7 6 13.7 6.58 14.2 7.58L20.65 20.1C21.08 21 20.52 22 19.52 22H17.1C16.52 22 15.97 21.76 15.63 21.34L10.5 15.5H11.5V23.5C11.5 24.33 10.83 25 10 25H9.5C8.67 25 8 24.33 8 23.5H7Z" fill="url(#hgv-logo-gradient)" />
      <path d="M16 9.8C17.6 9.8 19.13 10.53 20.25 11.8L23.5 15.2C24.35 16.1 24.35 17.5 23.5 18.4L20.2 21.9C19.12 23.1 17.55 23.77 15.95 23.7L13.4 23.6C12.55 23.6 12 22.8 12.25 22.05L13.9 17.4C14.2 16.6 14.9 16.03 15.76 15.93L18.5 15.7C19.18 15.64 19.7 15.11 19.7 14.45V14.32C19.7 13.68 19.22 13.16 18.56 13.16H17.4C16.45 13.16 15.56 12.79 14.9 12.12L13.3 10.53C13.02 10.24 12.65 10.1 12.3 10.1H11.64C10.28 10.1 9.17 11.22 9.17 12.58V13.68C9.17 14.38 9.72 14.95 10.42 14.95H12.05C12.85 14.95 13.57 15.47 13.85 16.22L14.4 17.7C14.82 18.86 15.97 19.46 17.12 19.08L18.8 18.47C19.65 18.17 20.38 17.52 20.77 16.7L21.67 14.87C21.84 14.52 22.27 14.35 22.62 14.5C23.1 14.72 23.42 15.2 23.42 15.72V16.3C23.42 17.16 22.96 17.96 22.2 18.35L20.6 19.25C19.76 19.7 18.77 19.94 17.78 19.94H16.54C15.68 19.94 14.83 19.7 14.05 19.23L12.32 18.12C11.36 17.51 10.7 16.42 10.7 15.25V12.9C10.7 11.58 11.74 10.5 13.05 10.5H15.82C15.99 10.5 16.15 10.55 16.3 10.66L16 9.8Z" fill="white" opacity="0.88" />
    </svg>
  );
}

export function Logo({ to = '/', className = '' }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={`inline-flex items-center gap-2 text-lg font-bold tracking-tight ${className}`} aria-label="HGV Player home">
      <LogoMark />
      <span className="bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">HGV Player</span>
    </Link>
  );
}
