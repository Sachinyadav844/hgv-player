import { Link } from 'react-router-dom';

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#d7191f" />
      <path d="M12 9.5v13l10.5-6.5z" fill="#fff" />
      <path d="M8 12.5v7l5.5-3.5z" fill="#fff" fillOpacity=".55" />
    </svg>
  );
}

export function Logo({ to = '/', className = '' }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={`inline-flex items-center gap-2 text-lg font-bold tracking-tight ${className}`} aria-label="HGV Player home">
      <LogoMark />
      <span>HGV Player</span>
    </Link>
  );
}
