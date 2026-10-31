type Level = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function currentLevel(): Level {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  if (configured && configured in ORDER) return configured;
  return process.env.NODE_ENV === 'test' ? 'silent' : 'info';
}

/** Removes credentials from anything that looks like a connection string. */
export function redact(text: string): string {
  return text.replace(/(mongodb(?:\+srv)?:\/\/)([^@\s/]+)@/gi, '$1***@');
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const base = redact(err.message);
    return process.env.NODE_ENV === 'production' || !err.stack ? base : redact(err.stack);
  }
  return redact(String(err));
}

function emit(level: Exclude<Level, 'silent'>, message: string, err?: unknown) {
  if (ORDER[level] < ORDER[currentLevel()]) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${redact(message)}${
    err === undefined ? '' : ` - ${errorText(err)}`
  }`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

export const log = {
  debug: (m: string, e?: unknown) => emit('debug', m, e),
  info: (m: string, e?: unknown) => emit('info', m, e),
  warn: (m: string, e?: unknown) => emit('warn', m, e),
  error: (m: string, e?: unknown) => emit('error', m, e),
};
