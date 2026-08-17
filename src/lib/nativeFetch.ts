/** `fetch` original, antes do patch do browserConsoleBridge (health-checks silenciosos). */
let nativeFetch: typeof fetch | null = null;

export function registerNativeFetch(fn: typeof fetch): void {
  if (!nativeFetch) nativeFetch = fn;
}

export function getNativeFetch(): typeof fetch {
  return nativeFetch ?? fetch;
}
