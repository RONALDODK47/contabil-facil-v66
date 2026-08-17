/**
 * Núcleo único de construção de lançamentos pareados (débito + crédito) do
 * balancete. Toda automação (garantida/banco, custo x faturamento, coligadas,
 * auto-correção, regras Receita Federal) deve usar estas funções em vez de
 * reimplementar `cloneBase`/`parLancamento`/`normCls` localmente — eram 6
 * cópias quase idênticas espalhadas pelo código, cada uma com pequenas
 * divergências (algumas sem `importId`, o que impedia idempotência ao
 * rerodar a automação).
 */
import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';

/** Remove pontos e espaços de uma classificação para comparação (ex.: "1.1.1.01" → "11101"). */
export function normalizarClassificacao(cls: string): string {
  return cls.replace(/\./g, '').replace(/\s/g, '');
}

/** Clona apenas os campos identificadores de uma conta, zerando os valores — base para gerar uma perna nova. */
export function contaBaseLimpa(r: VisionBalanceteRow): VisionBalanceteRow {
  return {
    codigo: r.codigo,
    classificacao: r.classificacao,
    nome: r.nome,
    tipo: r.tipo ?? 'A',
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
  };
}

/** Converte uma linha do plano de contas numa linha de balancete "vazia" (para servir de contrapartida). */
export function planoRowToBalanceteRow(p: VisionPlanoRow): VisionBalanceteRow {
  return {
    codigo: p.codigoReduzido ?? p.codigo,
    classificacao: p.codigo,
    nome: p.nome,
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
    tipo: p.tipo ?? 'A',
  };
}

/**
 * Débito e crédito nunca podem ser a mesma conta — se o fallback (codigo)
 * faz as duas pernas caírem na mesma conta (dado de origem sem a
 * contrapartida real), é melhor mostrar/gravar o crédito vazio do que
 * inventar uma partida fechada contra si mesma.
 */
export function contasSaoIguaisEDevemSerLimpa(
  contaDeb: string,
  contaCred: string,
): { contaDeb: string; contaCred: string } {
  if (contaDeb && contaCred && contaDeb === contaCred) {
    return { contaDeb, contaCred: '' };
  }
  return { contaDeb, contaCred };
}

/**
 * Gera um lançamento pareado (débito + crédito): `contaDeb` é sempre a perna
 * de débito, `contaCred` é sempre a perna de crédito. Mesma `ordem` nas duas
 * pernas e `contaDeb`/`contaCred` preenchidas nas duas — padrão exigido pelo
 * layout Domínio (senão o detector de "sem contrapartida" vê duas linhas
 * soltas incompletas).
 */
export function criarParLancamento(params: {
  contaDeb: VisionBalanceteRow;
  contaCred: VisionBalanceteRow;
  valor: number;
  data: string;
  historico: string;
  ordem: number;
  /** Identidade determinística da automação (ex.: `"garantida-banco:<chave>|<data>"`) — reaplicar a MESMA automação substitui o par anterior em vez de empilhar duplicado. */
  importId: string;
}): VisionBalanceteRow[] {
  const { contaDeb, contaCred, valor, data, historico, ordem, importId } = params;
  const v = Math.abs(valor);
  if (v < 0.05) return [];

  const codDeb = (contaDeb.codigo ?? '').trim();
  const codCred = (contaCred.codigo ?? '').trim();
  const limpo = contasSaoIguaisEDevemSerLimpa(codDeb, codCred);

  return [
    {
      ...contaBaseLimpa(contaDeb),
      data,
      nome: historico,
      debito: v,
      credito: 0,
      ordem,
      contaDeb: limpo.contaDeb || undefined,
      contaCred: limpo.contaCred || undefined,
      importId,
    },
    {
      ...contaBaseLimpa(contaCred),
      data,
      nome: historico,
      debito: 0,
      credito: v,
      ordem,
      contaDeb: limpo.contaDeb || undefined,
      contaCred: limpo.contaCred || undefined,
      importId,
    },
  ];
}

/**
 * Variante "por diferença assinada": dado quanto mover (`diferencaAssinada`,
 * já normalizada na convenção "positivo = direção débito") e a natureza
 * esperada da conta, decide qual das duas contas (`conta`/`contrapartida`)
 * fica do lado débito e qual fica do lado crédito, e gera o par via
 * `criarParLancamento`.
 */
export function criarParAjusteNatureza(params: {
  conta: VisionBalanceteRow;
  contrapartida: VisionBalanceteRow;
  diferencaAssinada: number;
  naturezaEsperadaConta: 'D' | 'C';
  data: string;
  historico: string;
  ordem: number;
  importId: string;
}): VisionBalanceteRow[] {
  const { conta, contrapartida, diferencaAssinada, naturezaEsperadaConta, data, historico, ordem, importId } =
    params;
  const v = Math.abs(diferencaAssinada);
  if (v < 0.05) return [];

  let debTarget = 0;
  let credTarget = 0;
  if (naturezaEsperadaConta === 'D') {
    if (diferencaAssinada > 0) debTarget = v;
    else credTarget = v;
  } else {
    if (diferencaAssinada < 0) credTarget = v;
    else debTarget = v;
  }

  const contaDeb = debTarget > 0 ? conta : contrapartida;
  const contaCred = credTarget > 0 ? conta : contrapartida;
  return criarParLancamento({ contaDeb, contaCred, valor: v, data, historico, ordem, importId });
}

/** Remove lançamentos anteriores de uma automação (por prefixo de `importId`) antes de inserir os novos — mecanismo único de idempotência, substituindo a checagem por faixas de `ordem` que hoje não é aplicada em lugar nenhum. */
export function removerLancamentosPorPrefixoImportId(
  rows: VisionBalanceteRow[],
  prefixo: string,
): VisionBalanceteRow[] {
  return rows.filter((r) => !(r.importId ?? '').startsWith(prefixo));
}
