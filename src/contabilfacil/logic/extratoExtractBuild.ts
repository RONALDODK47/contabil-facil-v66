/** Identificador visível no F12/UI — confirma que o bundle atual carregou. */
export const EXTRATO_EXTRACT_BUILD_ID = '2026-07-11-scanner-ia-sicredi';

/** Build da extração scanner/imagem — IA pura, sem interface de colunas. */
export const EXTRATO_SCANNER_PURE_AI_BUILD_ID = EXTRATO_EXTRACT_BUILD_ID;

export function logExtratoExtractBuild(motor?: string): void {
  if (typeof console === 'undefined') return;
  console.info('[extrato-extract]', {
    build: EXTRATO_EXTRACT_BUILD_ID,
    motor: motor ?? '—',
    dica: 'Se build não bater, faça Ctrl+Shift+R ou reinicie npm run dev',
  });
}
