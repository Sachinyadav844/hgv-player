/** Accepts only same-site paths such as "/room/ABC". Blocks "//evil.com" and absolute URLs. */
export function safeNext(value: string | null | undefined, fallback = '/rooms'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
