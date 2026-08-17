import { describe, it, expect } from 'vitest';
import { encryptSensitive, decryptSensitive } from '../server-security';

/**
 * createCipher/createDecipher foram removidos no Node 22 — o código não
 * compilava. A troca para createCipheriv exige IV, que agora viaja junto do
 * cifrado.
 */
describe('Encriptação de dados sensíveis', () => {
  it('faz ida e volta do texto', () => {
    const original = 'senha-do-banco-123';
    const cifrado = encryptSensitive(original);

    expect(cifrado).not.toBe('');
    expect(cifrado).not.toContain(original);
    expect(decryptSensitive(cifrado)).toBe(original);
  });

  it('gera cifrados diferentes para o mesmo texto', () => {
    // Sem IV aleatório, dois iguais cifram igual e isso vaza informação.
    const a = encryptSensitive('mesmo-texto');
    const b = encryptSensitive('mesmo-texto');

    expect(a).not.toBe(b);
    expect(decryptSensitive(a)).toBe('mesmo-texto');
    expect(decryptSensitive(b)).toBe('mesmo-texto');
  });

  it('preserva acentuação e caracteres especiais', () => {
    const original = 'Conciliação · R$ 1.292,99 — açaí';
    expect(decryptSensitive(encryptSensitive(original))).toBe(original);
  });

  it('devolve vazio para entrada corrompida, sem lançar', () => {
    expect(decryptSensitive('lixo-sem-iv')).toBe('');
    expect(decryptSensitive('')).toBe('');
    expect(decryptSensitive('aa:zz')).toBe('');
  });
});
