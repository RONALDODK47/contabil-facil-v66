import { describe, expect, it } from 'vitest';
import { assertValidGooglePayload, decodeGoogleCredential } from '../googleIdentity';

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

describe('googleIdentity', () => {
  it('decodifica credencial e valida e-mail verificado', () => {
    const jwt = makeJwt({
      sub: 'abc',
      email: 'a@b.com',
      email_verified: true,
      aud: 'client-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'https://accounts.google.com',
      name: 'Ana',
    });
    const payload = decodeGoogleCredential(jwt);
    expect(payload.email).toBe('a@b.com');
    expect(() => assertValidGooglePayload(payload, 'client-1')).not.toThrow();
  });

  it('rejeita e-mail não verificado', () => {
    const payload = {
      sub: 'abc',
      email: 'a@b.com',
      email_verified: false,
      aud: 'client-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'https://accounts.google.com',
    };
    expect(() => assertValidGooglePayload(payload, 'client-1')).toThrow(/não verificado/i);
  });
});
