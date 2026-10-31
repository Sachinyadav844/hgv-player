import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { extractRoomId } from '@hgv/shared';
import { Button } from './ui';

/** Accepts a room code ("ABCDE-FGHJK") or a pasted invitation link and opens that room. */
export function JoinRoomForm({ id = 'join-code', label = 'Room code or invite link' }: { id?: string; label?: string }) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const roomId = extractRoomId(value);
    if (!roomId) {
      setError(value.trim() ? 'That does not look like a room code. Codes have 10 letters and numbers.' : 'Enter a room code or paste an invite link.');
      return;
    }
    navigate(`/room/${roomId}`);
  };

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={value}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder="ABCDE-FGHJK"
          className={`h-11 min-w-0 flex-1 rounded-lg border bg-paper px-3 font-mono text-base tracking-wider placeholder:text-muted/60 ${error ? 'border-brand' : 'border-line hover:border-muted/60'}`}
        />
        <Button type="submit" variant="secondary" size="lg">
          Join room
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-brand">
          {error}
        </p>
      )}
    </form>
  );
}
