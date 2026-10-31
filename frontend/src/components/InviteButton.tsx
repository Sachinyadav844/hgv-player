import { useEffect, useRef, useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { Button } from './ui';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function InviteButton({ url, variant = 'secondary' }: { url: string; variant?: 'primary' | 'secondary' }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = async () => {
    const ok = await copyText(url);
    if (!ok) {
      toast.error('Could not copy automatically. Select the link and copy it manually.');
      return;
    }
    setCopied(true);
    toast.success('Invite link copied');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant={variant} onClick={onClick} aria-live="polite">
      {copied ? <Check className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
      {copied ? 'Copied' : 'Copy invite link'}
    </Button>
  );
}
