import { useState, type FormEvent } from 'react';
import { Send, Play } from 'lucide-react';
import { parseYouTubeInput } from '@hgv/shared';
import { Button } from './ui';

interface Props {
  /** "direct" loads the video for the whole room. "request" asks the host to approve it. */
  mode: 'direct' | 'request';
  onSubmit: (url: string) => Promise<unknown>;
  disabled?: boolean;
}

export function VideoUrlForm({ mode, onSubmit, disabled }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Paste a YouTube link first.');
      return;
    }
    if (!parseYouTubeInput(trimmed)) {
      setError('That is not a YouTube link. Use youtube.com/watch?v=..., youtu.be/... or youtube.com/embed/...');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(trimmed);
      setValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const label = mode === 'direct' ? 'Video link' : 'Suggest a video';
  return (
    <form onSubmit={submit} noValidate className="w-full">
      <label htmlFor={`video-url-${mode}`} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={`video-url-${mode}`}
          type="url"
          inputMode="url"
          autoComplete="off"
          value={value}
          disabled={disabled || busy}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `video-url-${mode}-error` : undefined}
          placeholder="https://www.youtube.com/watch?v=..."
          className={`h-10 min-w-0 flex-1 rounded-lg border bg-paper px-3 text-sm placeholder:text-muted/70 disabled:bg-wash ${error ? 'border-brand' : 'border-line hover:border-muted/60'}`}
        />
        <Button type="submit" loading={busy} disabled={disabled}>
          {mode === 'direct' ? <Play className="size-4" aria-hidden /> : <Send className="size-4" aria-hidden />}
          {mode === 'direct' ? 'Load video' : 'Send request'}
        </Button>
      </div>
      {error && (
        <p id={`video-url-${mode}-error`} role="alert" className="mt-1.5 text-sm text-brand">
          {error}
        </p>
      )}
    </form>
  );
}
