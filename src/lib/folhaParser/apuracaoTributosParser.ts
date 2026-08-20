/**
 * Parser do "Apuração de Tributos Federais" (Domínio)
 * ---------------------------------------------------------------------------
 * Traz os ENCARGOS DA EMPRESA sobre a folha — INSS patronal/RAT e, nas entidades imunes e
 * isentas, o PIS sobre a folha de pagamento. Esses valores não aparecem no "Resumo da Folha"
 * como despesa da empresa, então sem este relatório eles ficariam de fora da contabilização.
 *
 * Layout de cada página (uma competência por página):
 *
 *   Competência: 02/2026
 *   (-)Retenções (-)Compensação DCOMP Saldo a recolher (-)Sal.Maternidade (-)Sal.Família Encargos Valor
 *   0,00 540,32 0,00 0,00 1.441,90INSS Segurados Folha 1.982,22
 *   0,00 0,00 0,00 0,00 260,78INSS Empresa e RAT Folha 260,78
 *   0,00 0,00 0,00 0,00 260,78PIS Folha 260,78
 *
 * O extrator cola o "Saldo a recolher" no nome do encargo e joga o "Valor" para o fim da linha.
 * É o SALDO A RECOLHER que interessa: é o que a empresa efetivamente recolhe depois das
 * compensações (no INSS dos segurados, por exemplo, 1.982,22 − 540,32 de salário-família).
 */

export interface ApuracaoEncargoLinha {
  /** Nome da coluna "Encargos" — vira o histórico do lançamento. */
  encargo: string;
  /** Coluna "Valor" (antes das compensações). */
  valor: number;
  /** Coluna "Saldo a recolher" — o valor que a empresa recolhe. */
  saldoARecolher: number;
  /** `false` para as linhas de retenção do empregado (INSS Segurados). */
  ehEncargoEmpresa: boolean;
}

export interface ApuracaoTributosPagina {
  competencia: string; // MM/YYYY
  data: string; // DD/MM/YYYY — último dia da competência
  empresa?: string;
  cnpj?: string;
  tipoCalculo?: string;
  linhas: ApuracaoEncargoLinha[];
  /** Total impresso no rodapé ("Total saldo à recolher"), para conferência. */
  totalSaldoARecolher?: number;
}

const COMPETENCIA_PATTERN = /Compet[êe]ncia:\s*(\d{1,2}\/\d{4})/i;
/**
 * Cabeçalhos em dois sabores. Na ordem visual o rótulo vem antes ("Empresa: 52 - OBRAS …",
 * "Cálculo: Folha Mensal Hora: 08:55:21"); na ordem interna do PDF ele vem depois, colado
 * ("52 - OBRAS …Empresa:", "Folha Mensal\nCálculo:"). Tenta-se o primeiro e cai no segundo.
 */
const EMPRESA_VISUAL = /Empresa:[ \t]*([^\n]+?)(?:\s+P[áa]gina:|\n|$)/i;
const EMPRESA_INVERTIDO = /([^\n]+?)Empresa:/i;
const CNPJ_PATTERN = /CNPJ:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i;
const CALCULO_VISUAL = /C[áa]lculo:[ \t]*([^\n]+?)(?:\s+Hora:|\n|$)/i;
const CALCULO_INVERTIDO = /([^\n]+)\n\s*C[áa]lculo:/i;

/** Aplica o padrão visual e, se não render um valor útil, o invertido. */
function leCabecalho(texto: string, visual: RegExp, invertido: RegExp): string | undefined {
  const pelaOrdemVisual = visual.exec(texto)?.[1]?.trim();
  if (pelaOrdemVisual) return pelaOrdemVisual;
  return invertido.exec(texto)?.[1]?.trim() || undefined;
}
const TOTAL_PATTERN = /Total\s+saldo\s+[àa]\s+recolher:\s*([\d.]+,\d{2})/i;

/**
 * Ordem visual: nome do encargo seguido das colunas numéricas.
 *   `INSS Segurados Folha 1.982,22 0,00 540,32 0,00 0,00 1.441,90`
 * A primeira coluna é o Valor e a última o Saldo a recolher.
 */
const ENCARGO_VISUAL = /^([A-Za-zÀ-ÿ][^\d]*?)\s+((?:[\d.]+,\d{2}\s+)+[\d.]+,\d{2})\s*$/;

/**
 * Ordem interna do PDF: o saldo a recolher fica colado no nome e o valor fecha a linha.
 *   `0,00 540,32 0,00 0,00 1.441,90INSS Segurados Folha 1.982,22`
 */
const ENCARGO_INVERTIDO = /([\d.]+,\d{2})([A-Za-zÀ-ÿ][^\d]*?)\s+([\d.]+,\d{2})\s*$/;

/**
 * Encargos que são RETENÇÃO DO EMPREGADO, não custo da empresa. Já vêm no Resumo da Folha
 * como desconto — importá-los aqui de novo duplicaria a obrigação.
 */
const RETENCAO_EMPREGADO = /\bSEGURADO/i;

function parseBrValor(v: string): number {
  const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Último dia da competência MM/YYYY → DD/MM/YYYY. */
export function ultimoDiaDaCompetencia(competencia: string): string {
  const m = /^(\d{1,2})\/(\d{4})$/.exec(competencia.trim());
  if (!m) return '';
  const mes = Number(m[1]);
  const ano = Number(m[2]);
  if (mes < 1 || mes > 12) return '';
  const ultimo = new Date(new Date(ano, mes, 1).getTime() - 1);
  return `${String(ultimo.getDate()).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
}

/** Parser de UMA página/competência. */
export function parseApuracaoTributosPagina(texto: string): ApuracaoTributosPagina | null {
  const competenciaMatch = COMPETENCIA_PATTERN.exec(texto);
  if (!competenciaMatch) return null;

  const competencia = competenciaMatch[1];
  const data = ultimoDiaDaCompetencia(competencia);
  if (!data) return null;

  const linhas: ApuracaoEncargoLinha[] = [];
  for (const bruta of texto.split('\n')) {
    const linha = bruta.trim();
    if (!linha) continue;
    // O cabeçalho termina em "Encargos Valor" e casaria com o padrão de encargo
    if (/Encargos\s+Valor\s*$/i.test(linha)) continue;
    if (/^Total\s+saldo/i.test(linha)) continue;

    let encargo = '';
    let valor = 0;
    let saldoARecolher = 0;

    const visual = ENCARGO_VISUAL.exec(linha);
    if (visual) {
      const numeros = visual[2].trim().split(/\s+/).map(parseBrValor);
      // Uma coluna só é totalizador ("Total saldo à recolher: 1.963,46"), não linha de encargo
      if (numeros.length < 2) continue;
      encargo = visual[1];
      valor = numeros[0]!;
      saldoARecolher = numeros[numeros.length - 1]!;
    } else {
      const invertido = ENCARGO_INVERTIDO.exec(linha);
      if (!invertido) continue;
      encargo = invertido[2];
      saldoARecolher = parseBrValor(invertido[1]);
      valor = parseBrValor(invertido[3]);
    }

    encargo = encargo.replace(/\s+/g, ' ').trim();
    if (!encargo) continue;
    if (valor <= 0 && saldoARecolher <= 0) continue;

    linhas.push({
      encargo,
      valor,
      saldoARecolher,
      ehEncargoEmpresa: !RETENCAO_EMPREGADO.test(encargo),
    });
  }

  if (linhas.length === 0) return null;

  const pagina: ApuracaoTributosPagina = { competencia, data, linhas };

  pagina.empresa = leCabecalho(texto, EMPRESA_VISUAL, EMPRESA_INVERTIDO);
  const cnpj = CNPJ_PATTERN.exec(texto);
  if (cnpj) pagina.cnpj = cnpj[1];
  pagina.tipoCalculo = leCabecalho(texto, CALCULO_VISUAL, CALCULO_INVERTIDO);
  const total = TOTAL_PATTERN.exec(texto);
  if (total) pagina.totalSaldoARecolher = parseBrValor(total[1]);

  return pagina;
}

/** Marcador inserido pelo extrator de texto do app ("--- Página 2 ---"). */
const PAGE_MARKER_PATTERN = /---\s*P[áa]gina\s*\d+\s*---/gi;
/** Cabeçalho que abre cada página quando não há marcador (ex.: extração direta do PDF). */
const CABECALHO_PATTERN = /APURA[ÇC][ÃA]O\s+DE\s+TRIBUTOS\s+FEDERAIS/gi;

/** Divide o texto em páginas e lê todas as competências do PDF. */
export function parseApuracaoTributos(texto: string): ApuracaoTributosPagina[] {
  PAGE_MARKER_PATTERN.lastIndex = 0;
  const temMarcador = PAGE_MARKER_PATTERN.test(texto);
  PAGE_MARKER_PATTERN.lastIndex = 0;

  let paginas = texto.split(PAGE_MARKER_PATTERN).map((p) => p.trim()).filter(Boolean);

  // Só quando NÃO há marcador de página é que se divide pelo título do relatório. Com marcador,
  // uma página única já é a divisão certa — quebrá-la no título separaria a competência (que no
  // layout visual vem acima dele) das linhas de encargo, e a página inteira se perderia.
  if (!temMarcador && paginas.length <= 1) {
    const partes: string[] = [];
    let ultimo = 0;
    for (const m of texto.matchAll(CABECALHO_PATTERN)) {
      if (m.index != null && m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
      if (m.index != null) ultimo = m.index;
    }
    partes.push(texto.slice(ultimo));
    paginas = partes.map((p) => p.trim()).filter(Boolean);
  }

  const resultado: ApuracaoTributosPagina[] = [];
  const vistas = new Set<string>();
  for (const pagina of paginas) {
    const lida = parseApuracaoTributosPagina(pagina);
    // Uma competência por página; repetições vêm de blocos duplicados na extração.
    if (lida && !vistas.has(lida.competencia)) {
      vistas.add(lida.competencia);
      resultado.push(lida);
    }
  }
  return resultado;
}

export interface EncargoImportRow {
  id: string;
  date: string;
  description: string;
  debito: number;
  credito: number;
  tipo: 'INFORMATIVA';
  tipoCalculo?: string;
}

/**
 * Converte para linhas da tabela da Folha, mantendo SÓ os encargos da empresa.
 *
 * O valor é o saldo a recolher, e a natureza é crédito: é uma obrigação a pagar, com a
 * despesa do encargo do outro lado — a regra cadastrada é que define as duas contas.
 */
export function encargosEmpresaParaLinhasFolha(
  paginas: ApuracaoTributosPagina[],
): EncargoImportRow[] {
  const linhas: EncargoImportRow[] = [];
  for (const pagina of paginas) {
    for (const linha of pagina.linhas) {
      if (!linha.ehEncargoEmpresa) continue;
      if (linha.saldoARecolher <= 0) continue;
      linhas.push({
        id: `encargo-${pagina.competencia.replace(/\D/g, '')}-${linha.encargo.replace(/\W+/g, '').slice(0, 18)}`,
        date: pagina.data,
        description: linha.encargo,
        debito: 0,
        credito: linha.saldoARecolher,
        tipo: 'INFORMATIVA',
        tipoCalculo: pagina.tipoCalculo,
      });
    }
  }
  return linhas;
}
