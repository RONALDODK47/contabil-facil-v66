/**
 * Política legada: extrato bancário via leitor-recortador (texto nativo do PDF + recorte visual).
 * Parsers antigos de texto nativo e fallbacks estruturados estão proibidos neste modal.
 */
export const EXTRATO_PARSER_PROIBIDO_MSG =
  'Extrato bancário: use o leitor-recortador (texto nativo do PDF). Extração por parser antigo de texto nativo está desativada.';

export type ExtratoFonteProibida = 'native_pdf' | 'bank_python' | 'vision_parser' | 'pdf_text';

const FONTES_PARSER = new Set<string>([
  'native_pdf',
  'bank_python',
  'vision_parser',
  'pdf_text',
  'pdf-text',
]);

export function extratoFonteEhParser(fonte?: string | null): boolean {
  if (!fonte) return false;
  return FONTES_PARSER.has(String(fonte).trim().toLowerCase());
}

/** Lança se a linha vier de motor proibido (parser / texto nativo). */
export function rejeitarExtratoRowSeFonteParser(row: { _fonteExtrato?: string }): void {
  if (extratoFonteEhParser(row._fonteExtrato)) {
    throw new Error(EXTRATO_PARSER_PROIBIDO_MSG);
  }
}

/** Bloqueia chamadas a motores de parser no runtime da aplicação. */
export function bloquearExtratoParser(motor: string): never {
  throw new Error(`${EXTRATO_PARSER_PROIBIDO_MSG} (motor: ${motor})`);
}
