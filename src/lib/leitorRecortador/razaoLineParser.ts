import { isCnpjLike, linhaContemCnpj } from '../cnpjGuard';

const RE_DATA = /\b\d{2}\/\d{2}\/\d{4}\b/;
const RE_MOEDA = /[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+\.[0-9]{2}/;
const RE_CLASSIFICACAO = /^\d+(?:\.\d+){2,6}(?:\.\d{2,5})?$/;

function parseMoney(raw: string | undefined): number {
  if (!raw?.trim()) return 0;
  const s = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function dedupeHistoricoText(text: string): string {
  const parts = text
    .split(/\s{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return text.trim();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(' ').trim();
}

export function linhaEhMetadadoRazaoDominio(texto: string): boolean {
  const t = texto.trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (/sistema\s+licenciado|inov\s+consultoria/i.test(lower)) return true;
  if (/\bemiss[ãa]o\s*:/i.test(lower)) return true;
  if (/^data\s+n[uú]mero\s+hist[oó]rico/i.test(lower.replace(/\s+/g, ' '))) return true;
  if (/^folha\s*:/i.test(lower)) return true;
  if (/saldo-exerc[ií]cio/i.test(lower)) return true;
  // CNPJ como cabeçalho ("C.N.P.J.: 44.854.551/0001-98") nunca é lançamento — mas um
  // lançamento real pode legitimamente CITAR um CNPJ no histórico (ex.: "Pix recebido
  // de EMPRESA LTDA CNPJ 12.345.678/0001-90"). Só trata como cabeçalho quando a linha
  // NÃO tem data nem valor — características que só um lançamento de verdade tem.
  if (linhaContemCnpj(t) && !RE_DATA.test(t) && !RE_MOEDA.test(t)) return true;
  if (/c\.?\s*n\.?\s*p\.?\s*j|empresa\s*:/i.test(lower) && !RE_CLASSIFICACAO.test(t.replace(/\s/g, ''))) {
    return true;
  }
  return false;
}

/**
 * A coluna do Domínio é "Número Histórico": o número do lote fica junto do
 * histórico e, quando o histórico quebra em duas linhas, acaba no meio dele
 * ("PAGAMENTO PIX ... DE 4080 SOUSA QUEIRO"). No razão interessa o histórico,
 * então tokens de lote isolados (4 a 6 dígitos soltos) saem. Números longos
 * como CPF/CNPJ do PIX não têm esse tamanho e são preservados.
 */
function limparHistorico(texto: string): string {
  const semLote = texto.replace(/(^|\s)\d{4,6}(?=\s|$)/g, ' ');
  return dedupeHistoricoText(semLote)
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function mergeRazaoFieldsFromLine(
  fields: Record<string, string>,
  linhaCompleta: string,
  classificacaoConta?: string,
  codigoReduzidoConta?: string,
): Record<string, string> {
  const out = { ...fields };
  const texto = dedupeHistoricoText(linhaCompleta);

  const dataMatch = texto.match(RE_DATA);
  if (dataMatch && !out.data?.trim()) out.data = dataMatch[0];

  if (classificacaoConta?.trim()) {
    out.contaPartida = classificacaoConta.trim();
    out.classificacao = classificacaoConta.trim();
    /**
     * `codigo` alimenta Conta Débito / Conta Crédito, e ali só cabe o código
     * REDUZIDO. Achatar a classificação ("1.1.1.01.00001" → "1110100001")
     * produzia um número que não é conta nenhuma no plano. O reduzido vem do
     * cabeçalho "Conta: 5 - 1.1.1.01.00001"; sem ele, melhor deixar vazio e
     * deixar o plano resolver depois do que gravar a classificação achatada.
     */
    if (!out.codigo?.trim() && codigoReduzidoConta?.trim()) {
      out.codigo = codigoReduzidoConta.trim();
    }
  }

  if (
    !out.contaContrapartida?.trim() &&
    out.codigo?.trim() &&
    (!classificacaoConta?.trim() || out.codigo.trim() !== classificacaoConta.replace(/\./g, ''))
  ) {
    out.contaContrapartida = out.codigo.trim();
  }

  /**
   * O histórico da coluna, quando existe, é a fonte boa. Varrer a linha inteira
   * é FALLBACK — só serve quando o recorte posicional não achou nada. Antes o
   * texto da linha era sempre anexado ao que a coluna já tinha, e o histórico
   * chegava no razão como "SAQUE DINHEIRO ATM SAQUE DINHEIRO ATM 8 1.000,00D
   * 22.540,30D" (o replace de moeda não é global, então sobra resíduo).
   */
  const descColuna = (out.descricao ?? '').trim();
  if (descColuna) {
    out.descricao = limparHistorico(descColuna);
  } else {
    const histFromLine = texto
      .replace(RE_DATA, '')
      .replace(new RegExp(RE_MOEDA.source, 'g'), '')
      .replace(/\b\d{4,6}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (histFromLine.length > 3 && !/^cta\.?c\.?part/i.test(histFromLine)) {
      out.descricao = limparHistorico(histFromLine);
    }
  }

  const deb = parseMoney(out.debito);
  const cred = parseMoney(out.credito);
  if (deb > 0 && cred <= 0) {
    out.debito = deb.toFixed(2).replace('.', ',');
    out.credito = '';
  } else if (cred > 0 && deb <= 0) {
    out.credito = cred.toFixed(2).replace('.', ',');
    out.debito = '';
  }

  const codigoReduzido = (out.codigo || '').trim();
  if (/^\d{3,5}$/.test(codigoReduzido) && classificacaoConta?.trim()) {
    out.codigo = codigoReduzido;
  }

  return out;
}

/**
 * Código REDUZIDO da conta no cabeçalho do razão: "Conta: 5 - 1.1.1.01.00001
 * CAIXA GERAL" → "5". É o número que o Domínio usa em Cta.C.Part. e o único
 * que pode preencher Conta Débito / Conta Crédito. Sem ele o import caía na
 * classificação sem pontos ("1110100001"), que não é código de conta nenhum.
 */
export function extractCodigoReduzidoContaFromCluster(
  items: Array<{ str: string; x: number }>,
): string | null {
  const ordenados = [...items].sort((a, b) => a.x - b.x);
  const idxClassificacao = ordenados.findIndex(
    (it) => RE_CLASSIFICACAO.test(it.str.trim()) && !isCnpjLike(it.str.trim()),
  );
  if (idxClassificacao <= 0) return null;

  // O reduzido é o último token só-dígitos ANTES da classificação.
  for (let i = idxClassificacao - 1; i >= 0; i--) {
    const t = ordenados[i]!.str.trim();
    if (/^\d{1,7}$/.test(t)) return t;
  }
  return null;
}

export function extractClassificacaoContaFromCluster(
  items: Array<{ str: string; x: number }>,
): string | null {
  // Se o texto extraído do PDF (ordenado por x, sem espaços) contém um CNPJ,
  // rejeita o cluster inteiro — o extrator de PDF às vezes separa
  // "44.854.551" e "/0001-98" em runs de texto distintos, e o fragmento
  // pré-barra sozinho bate no regex de classificação abaixo.
  const joined = items
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((it) => it.str)
    .join('');
  if (linhaContemCnpj(joined)) return null;

  for (const it of items) {
    const t = it.str.trim();
    if (it.x >= 55 && it.x <= 130 && RE_CLASSIFICACAO.test(t) && !isCnpjLike(t)) return t;
  }
  return null;
}
