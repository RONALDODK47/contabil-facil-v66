/** Detecção de banco para extração IA (espelha scripts/ai-extract-prompts.mjs). */
export type ExtratoBankHint =
  | 'bb'
  | 'itau'
  | 'sicoob'
  | 'bradesco'
  | 'sicredi'
  | 'santander'
  | 'cresol'
  | 'caixa'
  | null;

export function detectExtratoBankHint(fileName?: string, ocrText?: string): ExtratoBankHint {
  const blob = `${fileName ?? ''} ${ocrText ?? ''}`.toLowerCase();
  if (/banco\s*do\s*brasil|sisbb|internet\s+banking\s+empresarial|\bbb\b.*extrato/i.test(blob)) {
    return 'bb';
  }
  if (/ita[uú]|itaú\s+empresas/i.test(blob)) return 'itau';
  if (/sicoob|sisbr/i.test(blob)) return 'sicoob';
  if (/bradesco/i.test(blob)) return 'bradesco';
  if (/sicredi|cooperativa.{0,40}748|associado.{0,80}sicredi/i.test(blob)) return 'sicredi';
  if (/santander|aplicativo\s+santander\s+empresas/i.test(blob)) return 'santander';
  if (/cresol|cooperativa.{0,40}cresol/i.test(blob)) return 'cresol';
  if (/caixa\s+econ/i.test(blob)) return 'caixa';
  return null;
}
