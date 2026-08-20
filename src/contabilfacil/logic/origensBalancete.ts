import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';

/**
 * Origens dos lançamentos do balancete
 * ---------------------------------------------------------------------------
 * Cada aba publica no razão com uma marca própria — a Folha grava `FOLHA-REGRA` no `importId`,
 * o Fiscal grava `FISCAL-AUTO` na classificação, a conciliação usa `extrato-conc:*`, e assim
 * por diante. Até aqui só os TXT/PDF importados no balancete apareciam em "Docs. Importados";
 * tudo o mais entrava no razão sem deixar rastro visível, e não havia como remover a remessa
 * inteira de uma aba.
 *
 * Este módulo lê essas marcas e devolve o que cada aba publicou, para que a lista mostre TODAS
 * as origens com a mesma opção de excluir. A classificação sai do próprio razão: não depende de
 * cada fluxo lembrar de se registrar, então nada fica de fora.
 */

export type OrigemBalanceteId =
  | 'FOLHA'
  | 'CONCILIACAO'
  | 'FISCAL'
  | 'FISCAL_SPED'
  | 'HONORARIOS'
  | 'EMPRESTIMO'
  | 'PARCELAMENTO'
  | 'APLICACAO'
  | 'CUSTO_FATURAMENTO'
  | 'ZERAMENTO';

export interface OrigemBalanceteDef {
  id: OrigemBalanceteId;
  /** Nome exibido na lista de documentos importados. */
  rotulo: string;
  /** De qual aba veio — ajuda a saber onde desfazer/ajustar. */
  aba: string;
}

const ORIGENS: OrigemBalanceteDef[] = [
  { id: 'FOLHA', rotulo: 'Folha de pagamento', aba: 'Folha' },
  { id: 'CONCILIACAO', rotulo: 'Conciliação bancária', aba: 'Conciliação' },
  { id: 'FISCAL', rotulo: 'Fiscal — notas e impostos', aba: 'Fiscal' },
  { id: 'FISCAL_SPED', rotulo: 'Fiscal — SPED', aba: 'Fiscal' },
  { id: 'HONORARIOS', rotulo: 'Honorários', aba: 'Honorários' },
  { id: 'EMPRESTIMO', rotulo: 'Empréstimos', aba: 'Empréstimos' },
  { id: 'PARCELAMENTO', rotulo: 'Parcelamentos', aba: 'Parcelamento' },
  { id: 'APLICACAO', rotulo: 'Aplicações', aba: 'Aplicações' },
  { id: 'CUSTO_FATURAMENTO', rotulo: 'Custos & Faturamento', aba: 'Custos & Faturamento' },
  { id: 'ZERAMENTO', rotulo: 'Zeramento de contas', aba: 'Balancete' },
];

const ORIGEM_POR_ID = new Map(ORIGENS.map((o) => [o.id, o]));

export function getOrigemBalancete(id: OrigemBalanceteId): OrigemBalanceteDef | undefined {
  return ORIGEM_POR_ID.get(id);
}

/**
 * Marcas gravadas por cada aba ao publicar, na ORDEM DE AVALIAÇÃO.
 *
 * A ordem importa nos prefixos que se contêm: "FOLHA-REGRA" (partidas novas) antes de
 * "FOLHA-AUTO" (caminho legado) não faz diferença, mas "SPED-FISC" precisa ser testado antes
 * de qualquer padrão genérico de fiscal.
 */
const MARCAS: Array<{ id: OrigemBalanceteId; padrao: RegExp }> = [
  { id: 'CONCILIACAO', padrao: /^extrato-conc\b/i },
  { id: 'ZERAMENTO', padrao: /^zeramento-/i },
  { id: 'CUSTO_FATURAMENTO', padrao: /^custo-auto-/i },
  { id: 'FOLHA', padrao: /^FOLHA-(REGRA|AUTO)\b/i },
  { id: 'FISCAL_SPED', padrao: /^SPED-FISC\b/i },
  { id: 'FISCAL', padrao: /^FISCAL-AUTO\b/i },
  { id: 'HONORARIOS', padrao: /^HONOR-AUTO\b/i },
  { id: 'EMPRESTIMO', padrao: /^EMPRESTIMO-AUTO\b/i },
  { id: 'PARCELAMENTO', padrao: /^PARCELAMENTO-AUTO\b/i },
  { id: 'APLICACAO', padrao: /^APLICACAO-AUTO\b/i },
];

/**
 * De qual aba veio esta linha do razão, ou `null` para as que não vieram de automação
 * (digitadas à mão, ou importadas por TXT/PDF — essas já têm entrada própria na lista).
 *
 * A marca pode estar no `importId` (Folha, conciliação, zeramento) ou na `classificacao`
 * (Fiscal, honorários, empréstimos e demais), porque os fluxos foram escritos em épocas
 * diferentes. Olha nos dois.
 */
export function origemDaLinhaBalancete(row: VisionBalanceteRow): OrigemBalanceteId | null {
  const importId = String(row.importId ?? '').trim();
  const classificacao = String(row.classificacao ?? '').trim();

  for (const { id, padrao } of MARCAS) {
    if (importId && padrao.test(importId)) return id;
    if (classificacao && padrao.test(classificacao)) return id;
  }

  // A conciliação antiga não gravava importId, só o sinalizador da linha
  if (row.isReconciliation) return 'CONCILIACAO';

  return null;
}

export interface OrigemBalanceteResumo {
  origem: OrigemBalanceteDef;
  /** Competências (MM/AAAA) que a origem publicou, da mais antiga para a mais recente. */
  meses: string[];
  /** Linhas de razão — cada lançamento tem duas (débito e crédito). */
  linhas: number;
  /** Soma dos débitos, que num conjunto equilibrado é igual à dos créditos. */
  total: number;
}

function mesDaLinha(row: VisionBalanceteRow): string | null {
  const partes = String(row.data ?? '').split('/');
  if (partes.length !== 3) return null;
  return `${partes[1]}/${partes[2]}`;
}

/**
 * Agrupa o razão pelas abas que o publicaram.
 *
 * Só entram origens que realmente têm lançamento — a lista mostra o que existe, não um
 * catálogo de abas vazias.
 */
export function resumirOrigensDoBalancete(rows: VisionBalanceteRow[]): OrigemBalanceteResumo[] {
  const acumulado = new Map<OrigemBalanceteId, { meses: Set<string>; linhas: number; total: number }>();

  for (const row of rows) {
    const id = origemDaLinhaBalancete(row);
    if (!id) continue;

    let atual = acumulado.get(id);
    if (!atual) {
      atual = { meses: new Set(), linhas: 0, total: 0 };
      acumulado.set(id, atual);
    }
    atual.linhas += 1;
    atual.total += row.debito ?? 0;
    const mes = mesDaLinha(row);
    if (mes) atual.meses.add(mes);
  }

  const porMes = (a: string, b: string) => {
    const [ma, aa] = a.split('/');
    const [mb, ab] = b.split('/');
    return `${aa}${ma}`.localeCompare(`${ab}${mb}`);
  };

  return ORIGENS.filter((o) => acumulado.has(o.id)).map((origem) => {
    const dados = acumulado.get(origem.id)!;
    return {
      origem,
      meses: [...dados.meses].sort(porMes),
      linhas: dados.linhas,
      total: dados.total,
    };
  });
}

/** Remove do razão tudo o que veio da aba indicada. */
export function removerOrigemDoBalancete(
  rows: VisionBalanceteRow[],
  id: OrigemBalanceteId,
): VisionBalanceteRow[] {
  return rows.filter((r) => origemDaLinhaBalancete(r) !== id);
}
