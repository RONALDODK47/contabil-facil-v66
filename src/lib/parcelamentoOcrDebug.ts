/** Ativo em `npm run dev` ou com `localStorage.setItem('parcelamentoOcrDebug','1')` no console. */
export function isParcelamentoOcrDebug(): boolean {
  try {
    if (import.meta.env?.DEV) return true;
    return localStorage.getItem('parcelamentoOcrDebug') === '1';
  } catch {
    return false;
  }
}

export function logParcelamentoOcr(label: string, payload?: unknown): void {
  if (!isParcelamentoOcrDebug()) return;
  if (payload === undefined) {
    console.log(`[Parcelamento OCR] ${label}`);
    return;
  }
  console.log(`[Parcelamento OCR] ${label}`, payload);
}

export function groupParcelamentoOcr(label: string): void {
  if (!isParcelamentoOcrDebug()) return;
  console.groupCollapsed(`[Parcelamento OCR] ${label}`);
}

export function endGroupParcelamentoOcr(): void {
  if (!isParcelamentoOcrDebug()) return;
  console.groupEnd();
}
