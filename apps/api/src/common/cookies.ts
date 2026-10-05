/** Minimal cookie header parsing — one small function beats a dependency. */
export function parseCookies(header: string | undefined): Record<string, string> {
  if (header === undefined || header === '') return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name !== '') out[name] = decodeURIComponent(value);
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
    secure?: boolean;
    path?: string;
    maxAge?: number;
  } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path !== undefined) parts.push(`Path=${options.path}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  if (options.httpOnly === true) parts.push('HttpOnly');
  if (options.secure === true) parts.push('Secure');
  if (options.sameSite !== undefined) {
    const value = options.sameSite;
    parts.push(`SameSite=${value.charAt(0).toUpperCase()}${value.slice(1)}`);
  }
  return parts.join('; ');
}
