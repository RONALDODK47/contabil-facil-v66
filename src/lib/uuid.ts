/**
 * Gera um UUID v4 simples sem depender de crypto.randomUUID()
 * Compatível com navegadores antigos e ambientes que não têm acesso ao Web Crypto API
 */
export function generateUUID(): string {
  // Polyfill simples para crypto.randomUUID usando Math.random()
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      // Continua com fallback
    }
  }

  // Fallback: gera UUID v4 usando Math.random()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Substitui crypto.randomUUID() por generateUUID() com fallback automático
 */
export function randomUUID(): string {
  return generateUUID();
}

// Adiciona polyfill global se crypto.randomUUID não existir
if (typeof window !== 'undefined' && !window.crypto?.randomUUID) {
  Object.defineProperty(window.crypto, 'randomUUID', {
    value: generateUUID,
    writable: false,
    configurable: true,
  });
}
