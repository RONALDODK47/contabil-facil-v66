import { format } from 'date-fns';
import { generateUUID } from '../../lib/uuid';
import { mergeSavedById, persistCanonicalList } from '../../lib/simuladorBrowserStorage';
import type { VariacaoValorParcelas } from '../../lib/aplicacoesDominioExport';

export interface SavedAplicacao {
  id: string;
  createdAt: string;
  sindicatoName?: string;
  nomeEmpresa: string;
  nomeAplicacao: string;
  numeroAplicacao?: string;
  valorParcelaStr: string;
  valorAplicacaoMesStr?: string;
  anoCompetenciaMensaisStr?: string;
  valorPorMesAplicacao12Str?: string;
  numeroPrimeiraParcelaStr: string;
  dataInicioPrimeiraParcelaStr: string;
  quantidadeParcelasStr: string;
  valorTotalParcelamentoStr?: string;
  variacaoValorParcelas?: VariacaoValorParcelas;
  accAplicacaoDebit?: string;
  accAplicacaoCredit?: string;
  naoGerarLancamentoAplicacao?: boolean;
  naoGerarLancamentoAplicacaoMes?: boolean;
  temReceitaJuros?: boolean;
  valorReceitaJurosMensalStr?: string;
  anoReceitaJurosMensaisStr?: string;
  valorReceitaJurosPorMes12Str?: string;
  accReceitaJurosDebit?: string;
  accReceitaJurosCredit?: string;
  temIRRF?: boolean;
  valorIRRFStr?: string;
  anoIRRFPorMes12Str?: string;
  valorIRRFPorMes12Str?: string;
  accIRRFDebit?: string;
  accIRRFCredit?: string;
  temIOF?: boolean;
  valorIOFStr?: string;
  anoIOPorMes12Str?: string;
  valorIOPorMes12Str?: string;
  accIOFDebit?: string;
  accIOFCredit?: string;
  dominioCodigoItemDfcStr?: string;
  dominioCodigoHistoricoStr?: string;
  dominioComplementoHistoricoStr?: string;
}

const STORAGE_KEY = 'simulador_aplicacoes';

const APLICACOES_STORAGE_KEYS = [
  'simulador_aplicacoes',
  'aplicacoes',
  'emprestimos_aplicacoes',
] as const;

function aplicacoesArrayFromParsed(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items;
    if (Array.isArray(o.aplicacoes)) return o.aplicacoes;
    if (o.id != null || o.nomeAplicacao != null || o.nomeEmpresa != null) return [parsed];
  }
  return [];
}

export function loadAplicacoesFromStorage(raw: string | null): SavedAplicacao[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    const rows = aplicacoesArrayFromParsed(parsed);
    const out: SavedAplicacao[] = [];
    for (const row of rows) {
      try {
        out.push(normalizeSavedAplicacao(row));
      } catch (e) {
        console.warn('[aplicacoes] registro ignorado na carga:', e, row);
      }
    }
    return out;
  } catch (e) {
    console.error('[aplicacoes] JSON inválido no armazenamento:', e);
    return [];
  }
}

export function loadAplicacoesFromBrowserStorage(): SavedAplicacao[] {
  const collected: SavedAplicacao[][] = [];
  for (const key of APLICACOES_STORAGE_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw?.trim()) continue;
    const list = loadAplicacoesFromStorage(raw);
    if (list.length > 0) {
      collected.push(list);
      if (key !== STORAGE_KEY) {
        console.info(`[aplicacoes] ${list.length} registro(s) recuperado(s) da chave legada "${key}".`);
      }
    }
  }
  const merged = mergeSavedById(collected);
  persistCanonicalList(STORAGE_KEY, merged);
  return merged;
}

export function normalizeSavedAplicacao(raw: unknown): SavedAplicacao {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = (k: string, fb = '') => String(r[k] ?? fb);
  const sOpt = (k: string) => (r[k] != null ? String(r[k]) : undefined);
  return {
    id: s('id', generateUUID()),
    createdAt: s('createdAt', new Date().toISOString()),
    nomeEmpresa: s('nomeEmpresa'),
    sindicatoName: sOpt('sindicatoName')?.toUpperCase(),
    nomeAplicacao: s('nomeAplicacao'),
    numeroAplicacao: sOpt('numeroAplicacao'),
    valorParcelaStr: s('valorParcelaStr', '0,00'),
    valorAplicacaoMesStr: sOpt('valorAplicacaoMesStr'),
    anoCompetenciaMensaisStr: sOpt('anoCompetenciaMensaisStr'),
    valorPorMesAplicacao12Str: sOpt('valorPorMesAplicacao12Str'),
    numeroPrimeiraParcelaStr: s('numeroPrimeiraParcelaStr', '1'),
    dataInicioPrimeiraParcelaStr: s(
      'dataInicioPrimeiraParcelaStr',
      format(new Date(), 'yyyy-MM-dd'),
    ),
    quantidadeParcelasStr: s('quantidadeParcelasStr', '1'),
    valorTotalParcelamentoStr: sOpt('valorTotalParcelamentoStr'),
    variacaoValorParcelas:
      String(r.variacaoValorParcelas ?? '').trim().toLowerCase() === 'selic_dias'
        ? 'selic_dias'
        : 'fixo',
    accAplicacaoDebit: sOpt('accAplicacaoDebit'),
    accAplicacaoCredit: sOpt('accAplicacaoCredit'),
    naoGerarLancamentoAplicacao: !!r.naoGerarLancamentoAplicacao,
    naoGerarLancamentoAplicacaoMes: !!r.naoGerarLancamentoAplicacaoMes,
    temReceitaJuros: !!r.temReceitaJuros,
    valorReceitaJurosMensalStr: sOpt('valorReceitaJurosMensalStr'),
    anoReceitaJurosMensaisStr: sOpt('anoReceitaJurosMensaisStr'),
    valorReceitaJurosPorMes12Str: sOpt('valorReceitaJurosPorMes12Str'),
    accReceitaJurosDebit: sOpt('accReceitaJurosDebit'),
    accReceitaJurosCredit: sOpt('accReceitaJurosCredit'),
    temIRRF: !!r.temIRRF,
    valorIRRFStr: sOpt('valorIRRFStr'),
    anoIRRFPorMes12Str: sOpt('anoIRRFPorMes12Str'),
    valorIRRFPorMes12Str: sOpt('valorIRRFPorMes12Str'),
    accIRRFDebit: sOpt('accIRRFDebit'),
    accIRRFCredit: sOpt('accIRRFCredit'),
    temIOF: !!r.temIOF,
    valorIOFStr: sOpt('valorIOFStr'),
    anoIOPorMes12Str: sOpt('anoIOPorMes12Str'),
    valorIOPorMes12Str: sOpt('valorIOPorMes12Str'),
    accIOFDebit: sOpt('accIOFDebit'),
    accIOFCredit: sOpt('accIOFCredit'),
    dominioCodigoItemDfcStr: sOpt('dominioCodigoItemDfcStr'),
    dominioCodigoHistoricoStr: sOpt('dominioCodigoHistoricoStr'),
    dominioComplementoHistoricoStr: sOpt('dominioComplementoHistoricoStr'),
  };
}
