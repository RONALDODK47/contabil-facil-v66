/**
 * Detecta se um campo que deveria ser código/classificação de conta é, na
 * verdade, um CNPJ (ou fragmento de CNPJ) — vazamento comum de cabeçalhos de
 * TXT/PDF ("C.N.P.J.: 44.854.551/0001-98") que passam pelos parsers de razão
 * e acabam virando "contas fantasma" no balancete.
 *
 * Deve ser chamado sobre o valor BRUTO (antes de qualquer strip de
 * pontuação), pois o CNPJ costuma ser truncado no primeiro caractere não
 * numérico/ponto (`/` ou `-`) por regex sem âncora, e o fragmento resultante
 * (ex.: "44.854.551") passa despercebido pelos guards que só olham dígitos.
 */
export function isCnpjLike(raw: string | undefined | null): boolean {
  const t = String(raw ?? '').trim();
  if (!t) return false;

  // CNPJ formatado, completo ou parcial: XX.XXX.XXX/XXXX-XX
  if (/\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}/.test(t)) return true;

  // Qualquer "/" dentro do valor é suspeito — códigos de conta nunca usam barra.
  if (t.includes('/')) return true;

  // CNPJ sem formatação: exatamente 14 dígitos seguidos.
  const digits = t.replace(/\D/g, '');
  if (digits.length === 14) return true;

  return false;
}

/** Mesma checagem, mas para linhas inteiras de texto (cabeçalho "C.N.P.J.: ..."). */
export function linhaContemCnpj(texto: string | undefined | null): boolean {
  const t = String(texto ?? '');
  if (/c\.?\s*n\.?\s*p\.?\s*j/i.test(t)) return true;
  if (/\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}/.test(t)) return true;
  return false;
}
