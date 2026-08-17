/**
 * Filtro de linhas de ruído (cabeçalho/rodapé/impressão/SAC/subtotal) de extratos bancários —
 * portado do motor de referência (extratoVision/utils/parser.ts). Complementa a checagem local
 * de "isHeaderOrBannerOrBalance" já existente em cropper.ts (que cobre poucos casos específicos)
 * com uma lista bem maior de padrões observados em extratos reais de vários bancos.
 */

export const BANK_HEADER_PATTERNS: RegExp[] = [
  /^Extrato\s+(de\s+)?Conta/i,
  /^Extrato$/i,
  /^Per[íi]odo\s+de/i,
  /^Ag[êe]ncia\s*:/i,
  /^Conta\s*:/i,
  /^Nome\s*:/i,
  /^CPF\s*\/\s*CNPJ/i,
  /^(CPF|CNPJ)\s*[:\d]/i,
  /^P[áa]gina\s+\d+/i,
  /^Folha\s+\d+/i,
  /^Demonstrativo\s+de/i,
  /^SAC\s*:/i,
  /^Ouvidoria\s*:/i,
  /^Central\s+de\s+Atendimento/i,
  /^Para\s+uso\s+do\s+banco/i,
  /^Rendimento\s+l[íi]quido$/i,
  /^Movimentaç[õo]es$/i,
  /^Aviso\s+de\s+Privacidade$/i,
  /^Termos\s+de\s+Uso$/i,
  /^Internet\s+Banking$/i,
  /^Banco\s+[A-Z\s]+S\.A\.$/i,
  /^Data\s+d[eo]\s+Extrato/i,
  /^Data\s+de\s+Emiss[ãa]o/i,
  /^Cheque\s+Especial$/i,
  /^Resumo$/i,
  /^Data\s+Hist[óo]rico\s+Valor$/i,
  /^Descri[çc][ãa]o\s+Valor$/i,
  /^Data\s+Movimentaç[ãa]o\s+Tipo\s+Documento\s+Valor$/i,
  /^Tribanco\s+Online$/i,
  /^Data\s+da\s+Impress[ãa]o/i,
  /^Usu[áa]rio\s*:/i,
  /^Lan[çc]amentos\s+da\s+CONTA\s+DIGITAL/i,
  /^https?:\/\//i,
  /^\d{2}\/\d{2}\/\d{4},?\s+\d{2}:\d{2}(:\d{2})?$/,
  /^Lan[çc]amentos\s+Futuros$/i,
  /^N[ãa]o\s+h[áa]\s+lan[çc]amentos$/i,
  /^Posi[çc][ãa]o\s+da\s+CONTA$/i,
  /^Sujeito\s+a\s+altera[çc][õo]es$/i,
  /^Informa[çc][õo]es\s+do\s+dia$/i,
  /^Tem\s+alguma\s+d[uú]vida/i,
  /^Caso\s+a\s+solu[çc][ãa]o\s+fornecida/i,
  /^Mande\s+uma\s+mensagem\s+para/i,
  /^Extrato\s+gerado\s+(dia|em)/i,
  /^\d{1,3}\s+de\s+\d{1,3}$/i,
  /^VALORES\s+EM\s+R\$$/i,
  /^Ag[êe]ncia\s+\d+\s*Conta$/i,
  /^\d{1,2}\s+DE\s+[A-ZÇÀ-Ú]+\s+DE\s+\d{4}\s+a\s+\d{1,2}\s+DE\s+[A-ZÇÀ-Ú]+\s+DE\s+\d{4}$/i,
  /^Atendimento\s+\d{1,2}h/i,
  /^Atendimento\s+das\s+\d{1,2}h/i,
  /^\d{4}\s+\d{4}$/,
  /^0800\s+\d/,
  /^\d[\d.]{4,}-\d{1,2}$/,
];

/** Número de página estilo impressão ("1 / 6"), sem confundir com data DD/MM inteira. */
function isBrowserPrintPageFraction(s: string): boolean {
  const m = /^\s*(\d{1,4})\s*\/\s*(\d{1,4})\s*$/.exec(s);
  if (!m) return false;
  const cur = Number(m[1]);
  const tot = Number(m[2]);
  if (!Number.isFinite(cur) || !Number.isFinite(tot)) return false;
  if (tot < 1 || tot > 800) return false;
  return cur <= tot;
}

/** Linhas de SUBTOTAL/SALDO do dia — carregam um valor, mas não são um lançamento individual. */
export function isDailySummaryOrTotalLine(raw: string): boolean {
  const s = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return (
    /^(saldo|total)\b/.test(s) ||
    /total\s+de\s+entradas/.test(s) ||
    /total\s+de\s+sa[i]?das/.test(s) ||
    /saldo\s+do\s+dia/.test(s) ||
    /saldo\s+inicial/.test(s) ||
    /saldo\s+final/.test(s) ||
    /saldo\s+anterior/.test(s) ||
    /saldo\s+atual/.test(s) ||
    /saldo\s+dispon[ií]vel/.test(s) ||
    /saldo\s+em\s+conta/.test(s) ||
    /rendimento\s+l[i]?quido/.test(s)
  );
}

/** Texto de rodapé de "fale conosco" / ouvidoria / SAC — usa CONTAINS, não âncora. */
export function isCustomerServiceFooterNoise(raw: string): boolean {
  const s = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return (
    /ouvidoria/.test(s) ||
    /atendimento\s+24\s*h/.test(s) ||
    /demais\s+localidades/.test(s) ||
    /metropolitanas/.test(s) ||
    /dias\s+uteis/.test(s) ||
    /chat\s+do\s+app/.test(s) ||
    /nosso\s+time\s+de\s+atendimento/.test(s) ||
    /canais\s+de\s+atendimento/.test(s) ||
    /solucao\s+fornecida/.test(s) ||
    /contatos\s*#\s*ouvidoria/.test(s)
  );
}

/** Cabeçalho/rodapé de impressão/SAC/banner institucional — sempre ignorar como transação. */
export function isBankStatementNoiseLine(raw: string): boolean {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return true;

  if (isCustomerServiceFooterNoise(s)) return true;

  for (const p of BANK_HEADER_PATTERNS) {
    if (p.test(s)) return true;
  }

  if (/https?:\/\/[^\s]*autoatendimento\.bb\.com\.br/i.test(raw)) return true;
  if (/https?:\/\/[^\s]*\.bb\.com\.br[^\s]*#\//i.test(raw)) return true;
  if (/https?:\/\/[^\s]+\/apf-apj-autoatendimento\//i.test(raw)) return true;
  if (/autoatendimento\.bb\.com\.br/i.test(s)) return true;
  if (/\/apf-apj-autoatendimento\//i.test(s)) return true;
  if (/\/index\.html\?[^\s#/]*#\//i.test(s)) return true;
  if (/~2[Ff]consultas/i.test(s) || /#\/template\//i.test(s)) return true;

  if (isBrowserPrintPageFraction(s)) return true;

  const printStampStrict = /^\d{2}\/\d{2}\/\d{4}\s*,\s*\d{1,2}:\d{2}(:\d{2})?\s*$/;
  if (printStampStrict.test(s)) return true;

  const printStampRest = /^\d{2}\/\d{2}\/\d{4}\s*,\s*\d{1,2}:\d{2}(?::\d{2})?\s+(.+)$/i.exec(s);
  if (printStampRest && printStampRest[1]) {
    const suffix = printStampRest[1].trim();
    if (suffix.length < 52 && /^banco\s+do\s+brasil$/i.test(suffix)) return true;
    if (suffix.length < 44 && /^(banco\s+)?bradesco(\s+bank)?$/i.test(suffix)) return true;
    if (suffix.length < 44 && /^it[aá]u(\s+unibanco)?$/i.test(suffix)) return true;
    if (suffix.length < 44 && /^santander$/i.test(suffix)) return true;
    if (suffix.length < 52 && /^caixa(\s+econ[oô]mica(\s+federal)?)?$/i.test(suffix)) return true;
  }

  if (s.length < 72 && /^banco\s+do\s+brasil\s*$/i.test(s)) return true;

  return false;
}
