import type { VisionBalanceteRow, VisionPlanoRow } from '../../extratoVision/types/accounting';
import { inferAccountTypes } from '../../extratoVision/utils/planilhaModelo';
import { isValidRazaoLinha, parseDataRazao } from '../../extratoVision/utils/razaoContabil';
import type { GenericOcrRow } from '../../lib/parcelamentoColunasExtract';
import {
  codeLengthToPlanoLevel,
  derivePlanoGroupFromCode,
  derivePlanoNatureFromGroup,
  sanitizeCodigoReduzido,
  visionPlanoToAccountPlan,
} from './planoContasMapper';

export type AccountPlanLike = {
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: 'S' | 'A';
  nivel?: number;
  group?: string;
  nature?: 'DEVEDORA' | 'CREDORA';
};

export function accountPlansToVisionPlano(plans: AccountPlanLike[]): VisionPlanoRow[] {
  return inferAccountTypes(
    plans.map((p) => ({
      codigo: p.code,
      nome: p.name,
      codigoReduzido: p.codigoReduzido,
      tipo: p.tipo,
      nivel: p.nivel ?? codeLengthToPlanoLevel(p.code),
    })),
  );
}

export function finalizePlanoImport(plans: AccountPlanLike[]): AccountPlanLike[] {
  const vision = inferAccountTypes(
    plans.map((p) => ({
      codigo: p.code,
      nome: p.name,
      codigoReduzido: sanitizeCodigoReduzido(p.codigoReduzido),
      tipo: p.tipo,
      nivel: p.nivel ?? codeLengthToPlanoLevel(p.code),
    })),
  );
  return vision.map((v) => visionPlanoToAccountPlan(v));
}

/** Registros antigos de conciliação gravavam `EXTRATO-CONC|id|histórico` dentro de `nome` — migra para `importId`. */
const LEGACY_EXTRATO_CONC_MARCA = /^EXTRATO-CONC\|([^|]+)\|(.*)$/;

function limparHistoricoLegado(r: VisionBalanceteRow): VisionBalanceteRow {
  const match = (r.nome ?? '').match(LEGACY_EXTRATO_CONC_MARCA);
  if (!match) return r;
  return {
    ...r,
    nome: match[2],
    isReconciliation: true,
    importId: r.importId ?? `extrato-conc:${match[1]}`,
  };
}

/**
 * Autocura: remove duplicatas geradas por reimportar a mesma movimentação com o código da
 * conta em formatos diferentes (ex.: "8" vs "0000008"). O TXT+ Domínio grava o código com
 * zeros à esquerda, mas um import por OCR/recorte de extrato do mesmo período pode gravar o
 * código cru sem padding — o sistema não reconhecia como a mesma conta e duplicava toda a
 * movimentação daquele dia em diante, dobrando débito/crédito no balancete.
 *
 * Roda automaticamente (chamada por normalizeRazaoImport, usado em todo carregamento/merge
 * do razão) — diferente do "zeramento de conta garantida" (que É manual, ver
 * balanceteGarantidaBanco.ts), essa limpeza é puramente estrutural: só remove quando a MESMA
 * movimentação (mesma data + mesmo débito + mesmo crédito + mesmo código numérico) aparece
 * duas vezes com formatos de texto diferentes (ex.: "8" e "0000008") — linhas legitimamente
 * repetidas (mesmo valor, mesmo dia, mas com o código gravado sempre do mesmo jeito) não
 * entram aqui. Mantém a linha de código mais longo (zero-padded / canônico).
 *
 * Também exportada para o botão manual "Corrigir Duplicatas de Importação" (Balancete →
 * Configuração), que deixa o usuário rodar de novo sob demanda e ver quantas linhas mudariam.
 */
export function removerDuplicatasCodigoInconsistente(rows: VisionBalanceteRow[]): VisionBalanceteRow[] {
  const numCodigo = (c: string | undefined): number | null => {
    const digits = (c ?? '').replace(/\D/g, '');
    if (!digits) return null;
    const n = parseInt(digits, 10);
    return Number.isFinite(n) ? n : null;
  };

  const grupos = new Map<string, VisionBalanceteRow[]>();
  for (const r of rows) {
    const num = numCodigo(r.codigo);
    if (num == null) continue;
    const key = `${r.data ?? ''}|${num}|${(r.debito ?? 0).toFixed(2)}|${(r.credito ?? 0).toFixed(2)}`;
    const list = grupos.get(key) ?? [];
    list.push(r);
    grupos.set(key, list);
  }

  const remover = new Set<VisionBalanceteRow>();
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const formatos = new Set(grupo.map((r) => (r.codigo ?? '').trim()));
    if (formatos.size < 2) continue; // mesmo formato nas duas → repetição real, não duplicata
    const ordenado = [...grupo].sort((a, b) => (b.codigo ?? '').length - (a.codigo ?? '').length);
    for (const r of ordenado.slice(1)) remover.add(r);
  }

  return remover.size > 0 ? rows.filter((r) => !remover.has(r)) : rows;
}

export function normalizeRazaoImport(rows: VisionBalanceteRow[]): VisionBalanceteRow[] {
  const sanitizadas = rows
    .filter(isValidRazaoLinha)
    .map(limparHistoricoLegado)
    .map((r, i) => ({
      ...r,
      data: r.data ? parseDataRazao(r.data) : r.data,
      ordem: r.ordem ?? i + 1,
      saldoInicial: r.saldoInicial ?? 0,
      saldoFinal: r.saldoFinal ?? 0,
      debito: r.debito ?? 0,
      credito: r.credito ?? 0,
    }));
  return removerDuplicatasCodigoInconsistente(sanitizadas);
}

export function ocrRowToVisionRazao(row: GenericOcrRow, index: number): VisionBalanceteRow | null {
  const debito = parseNum(row.debito);
  const credito = parseNum(row.credito);
  const fromDc = parseValorDc(row.valorDc);
  const deb = debito > 0 ? debito : fromDc.debito;
  const cred = credito > 0 ? credito : fromDc.credito;
  const contaPartida = row.contaPartida?.trim() || row.classificacao?.trim() || '';
  // Se veio com classificacao estruturada (com pontos), usa como classificacao; senão deixa vazio
  const classificacao = contaPartida.includes('.') ? contaPartida : (row.classificacao?.trim() || '');
  /**
   * `codigo` vira Conta Débito / Conta Crédito, e ali só cabe o código REDUZIDO.
   * Achatar a classificação ("1.1.1.01.00001" → "1110100001") criava um número
   * que não existe no plano. Quando não há reduzido, fica vazio e o plano
   * resolve na exibição — melhor vazio do que uma conta inventada.
   */
  const codigoBruto = row.codigo?.trim() || '';
  const codigo = codigoBruto.includes('.') ? '' : codigoBruto;
  const nome = (row.descricao || row.historico || 'LANCAMENTO').trim();
  if (!codigo && !nome) return null;

  const contraparte = row.contaContrapartida?.trim() || '';
  const contaDeb = deb > 0 ? codigo || undefined : contraparte || undefined;
  const contaCred = cred > 0 ? codigo || undefined : contraparte || undefined;

  // Saldo anterior (SI) e saldo final (SF) — preenchidos no modo "Importar Saldo"
  // quando o usuário marca as colunas Saldo Anterior e Saldo Atual no recortador.
  const siDc = parseSaldoDc(row.saldoAnterior);
  const sfDc = parseSaldoDc(row.valorDc);

  const candidate: VisionBalanceteRow = {
    codigo,
    // Deixa classificacao vazia se não vier estruturada — será preenchida por enrichNomeDoPlano
    classificacao: classificacao || undefined,
    nome: nome.toUpperCase(),
    data: row.data ? parseDataRazao(row.data) : undefined,
    ordem: index + 1,
    saldoInicial: siDc.valor,
    naturezaSaldoInicial: siDc.natureza,
    debito: deb,
    credito: cred,
    saldoFinal: sfDc.valor,
    naturezaSaldoFinal: sfDc.natureza,
    contaDeb,
    contaCred,
  };
  if (isValidRazaoLinha(candidate)) return candidate;

  /**
   * Conta com saldo exatamente zero (ex.: "0,00" sem D/C — comum em contas de resultado
   * zeradas ou contas que não tiveram saldo anterior): `isValidRazaoLinha` rejeita por não
   * ver movimento/saldo/data, mas a coluna de saldo foi de fato preenchida no OCR — não é
   * lixo. Mantém a conta em vez de descartá-la silenciosamente.
   */
  const temCodigoValido = /^\d/.test(codigo) || /^\d/.test(classificacao);
  const temValorInformado =
    Boolean(row.valorDc?.trim()) ||
    Boolean(row.saldoAnterior?.trim()) ||
    Boolean(row.debito?.trim()) ||
    Boolean(row.credito?.trim());
  if (temCodigoValido && temValorInformado && Boolean(row.descricao?.trim())) return candidate;

  return null;
}

function parseNum(raw: string | undefined, fallback = 0): number {
  if (!raw?.trim()) return fallback;
  const s = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.abs(n) : fallback;
}

function parseValorDc(raw: string | undefined): { debito: number; credito: number } {
  if (!raw?.trim()) return { debito: 0, credito: 0 };
  const t = raw.trim().toUpperCase();
  const n = parseNum(raw);
  if (t.endsWith('D')) return { debito: n, credito: 0 };
  if (t.endsWith('C')) return { debito: 0, credito: n };
  return { debito: n, credito: 0 };
}

/** Interpreta "306.957,79C" ou "85.381,42D" em { valor, natureza }. */
function parseSaldoDc(raw: string | undefined): { valor: number; natureza?: 'D' | 'C' } {
  if (!raw?.trim()) return { valor: 0 };
  const t = raw.trim().toUpperCase();
  const n = parseNum(raw);
  if (n < 1e-9) {
    // Saldo zero: inferir natureza D como padrão se houver sufixo, ou deixar undefined
    if (t.endsWith('D')) return { valor: 0, natureza: 'D' };
    if (t.endsWith('C')) return { valor: 0, natureza: 'C' };
    return { valor: 0 };
  }
  if (t.endsWith('D')) return { valor: n, natureza: 'D' };
  if (t.endsWith('C')) return { valor: n, natureza: 'C' };
  return { valor: n };
}

/** Converte linhas legadas (flat balancete) em movimentos de razão. */
export function migrateLegacyBalanceteToRazao(
  rows: Array<{
    dataInicio?: string;
    codigo?: string;
    classificacao?: string;
    descricao?: string;
    debito?: number;
    credito?: number;
    saldoInicial?: number;
  }>,
): VisionBalanceteRow[] {
  return normalizeRazaoImport(
    rows.map((r, i) => ({
      codigo: r.codigo ?? '',
      // Deixa classificacao vazia se não vier — será preenchida por enrichNomeDoPlano com o plano de contas
      classificacao: r.classificacao ?? '',
      nome: r.descricao ?? 'LANCAMENTO',
      data: r.dataInicio ? parseDataRazao(r.dataInicio) : undefined,
      ordem: i + 1,
      saldoInicial: r.saldoInicial ?? 0,
      debito: r.debito ?? 0,
      credito: r.credito ?? 0,
      saldoFinal: 0,
    })),
  );
}

export function formatVisionRazaoDate(data?: string): string {
  if (!data?.trim()) return '—';
  const parsed = parseDataRazao(data);
  return parsed || data;
}

export function visionPlanoRowsToAccountPlans(rows: VisionPlanoRow[]): AccountPlanLike[] {
  return finalizePlanoImport(rows.map((r) => visionPlanoToAccountPlan(r)));
}

/** TXT+ partida dobrada → duas pernas no razão (débito e crédito). */
export function parseTxtPlusToRazaoVision(
  rows: Array<{
    date: string;
    description: string;
    value: number;
    accountDebit?: string;
    accountCredit?: string;
  }>,
  _contaBancoSelecionada?: string,
): VisionBalanceteRow[] {
  const out: VisionBalanceteRow[] = [];
  let ordemGlobal = 0;

  rows.forEach((row) => {
    const data = parseDataRazao(row.date);
    const nome = row.description.toUpperCase();
    const val = row.value;
    if (val <= 0) return;

    const deb = row.accountDebit?.trim();
    const cred = row.accountCredit?.trim();
    if (!deb && !cred) return;

    // Ambas as linhas da mesma partida recebem a MESMA ordem — assim o Passo 2
    // do pareamento (data+ordem) consegue emparelhar débito e crédito corretamente.
    // contaDeb e contaCred são preenchidos em ambas para que o Passo 1 (mais rápido)
    // já emita a partida sem precisar de pareamento por heurística.
    const ordemPartida = ++ordemGlobal;

    if (deb) {
      out.push({
        codigo: deb,
        classificacao: deb,
        nome,
        data,
        ordem: ordemPartida,
        saldoInicial: 0,
        debito: val,
        credito: 0,
        saldoFinal: 0,
        contaDeb: deb,
        contaCred: cred,
      });
    }

    if (cred) {
      out.push({
        codigo: cred,
        classificacao: cred,
        nome,
        data,
        ordem: ordemPartida,
        saldoInicial: 0,
        debito: 0,
        credito: val,
        saldoFinal: 0,
        contaDeb: deb,
        contaCred: cred,
      });
    }
  });

  return normalizeRazaoImport(out);
}
