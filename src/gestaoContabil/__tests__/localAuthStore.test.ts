/**
 * Autenticação local da equipa — testes de registo, senha e token.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('../../lib/safeLocalStorage', () => ({
  safeLocalStorageGetItem: (key: string) => store.get(key) ?? null,
  safeLocalStorageSetItem: (key: string, value: string) => {
    store.set(key, value);
  },
  safeLocalStorageRemoveItem: (key: string) => {
    store.delete(key);
  },
}));

import {
  AUTH_USERS_KEY,
  findAuthUserByEmailOrUsername,
  isValidCompanyAccessToken,
  readAuthUsers,
  upsertGoogleAuthUser,
  writeAuthUsers,
} from '../localAuthStore';

describe('localAuthStore', () => {
  beforeEach(() => {
    store.clear();
  });

  it('grava e lê utilizadores com senha', () => {
    writeAuthUsers({
      'a@b.com': { email: 'a@b.com', password: 'segredo1', display_name: 'Ana' },
    });
    const users = readAuthUsers();
    expect(users['a@b.com']?.password).toBe('segredo1');
    expect(findAuthUserByEmailOrUsername(users, 'Ana')?.email).toBe('a@b.com');
  });

  it('rejeita senha diferente', () => {
    writeAuthUsers({
      'a@b.com': { email: 'a@b.com', password: 'segredo1', display_name: 'Ana' },
    });
    const user = findAuthUserByEmailOrUsername(readAuthUsers(), 'a@b.com');
    expect(user?.password === 'qualquer').toBe(false);
    expect(user?.password === 'segredo1').toBe(true);
  });

  it('aceita qualquer token válido (independente do token)', () => {
    expect(isValidCompanyAccessToken('CL-FAKE-XXXX')).toBe(false); // FAKE é sempre rejeitado
    expect(isValidCompanyAccessToken('ADM-AAAA-BBBB')).toBe(true);
    expect(isValidCompanyAccessToken('office_1')).toBe(true);
    expect(isValidCompanyAccessToken('INOV')).toBe(true);
    expect(isValidCompanyAccessToken('AB')).toBe(false); // muito curto
  });

  it('grava conta Google sem palavra-passe', () => {
    upsertGoogleAuthUser({
      email: 'pessoa@gmail.com',
      displayName: 'Pessoa',
      googleSub: 'google-sub-123',
    });
    const users = readAuthUsers();
    expect(users['pessoa@gmail.com']?.provider).toBe('google');
    expect(users['pessoa@gmail.com']?.password).toBe('');
    expect(users['pessoa@gmail.com']?.google_sub).toBe('google-sub-123');
  });

  it('preserva senha local em conta ligada ao Google', () => {
    upsertGoogleAuthUser({
      email: 'pessoa@gmail.com',
      displayName: 'Pessoa',
      googleSub: 'google-sub-123',
      password: 'senhaLocal1',
    });
    const users = readAuthUsers();
    expect(users['pessoa@gmail.com']?.provider).toBe('google');
    expect(users['pessoa@gmail.com']?.password).toBe('senhaLocal1');
    expect(users['pessoa@gmail.com']?.google_sub).toBe('google-sub-123');
  });

  it('persiste no mesmo storage key', () => {
    writeAuthUsers({
      'x@y.com': { email: 'x@y.com', password: 'abcdef', display_name: 'X' },
    });
    expect(store.get(AUTH_USERS_KEY)).toContain('abcdef');
  });
});
