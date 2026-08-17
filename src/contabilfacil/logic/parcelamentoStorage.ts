import { format } from 'date-fns';
import type {
  ModoCalculoJurosParcelamento,
  VariacaoValorParcelas,
} from '../../lib/parcelamentoDominioExport';
import { valorTransferenciaAnualFromParcelaStr } from '../../lib/parcelamentoDominioExport';
import { mergeSavedById, persistCanonicalList } from '../../lib/simuladorBrowserStorage';

/** Domínio TXT+: mesmos pareamentos da simulação de empréstimo (`dominioExporter`). */
export interface SavedParcelamento {
  id: string;
  nomeParcelamento: string;
  numeroParcelamento?: string;
  clienteNome: string;
  companyName?: string;
  valorParcelaStr: string;
  numeroPrimeiraParcelaStr: string;
  dataInicioPrimeiraParcelaStr: string;
  quantidadeParcelasStr: string;
  valorTotalParcelamentoStr?: string;
  variacaoValorParcelas?: VariacaoValorParcelas;
  reajusteSelicEntreParcelas?: boolean;
  faixasValorParcelaJson?: string;
  modoCalculoJuros?: ModoCalculoJurosParcelamento;
  faixasJurosPercentualJson?: string;
  createdAt: string;
  dominioComplementoHistoricoStr?: string;
  dominioCodigoHistoricoStr?: string;
  accJurosAproDebit?: string;
  accJurosAproCredit?: string;
  valorJurosMensalStr?: string;
  primeiraParcelaSemJuros?: boolean;
  accApropriacaoDebit?: string;
  accApropriacaoCredit?: string;
  accTransferenciaDebit?: string;
  accTransferenciaCredit?: string;
  valorTransferenciaMensalStr?: string;
  accEmprestimoDebit?: string;
  accEmprestimoCredit?: string;
  accParcelaDebit?: string;
  accParcelaCredit?: string;
  accPagamentoDebit?: string;
  accPagamentoCredit?: string;
  cronogramaPlanilhaJson?: string;
  dataGerarLancamentosAPartirStr?: string;
  dataGerarLancamentosAteStr?: string;
  selicManualStr?: string;
}

function normalizarVariacaoParcelas(raw: unknown): VariacaoValorParcelas {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'selic_dias') return 'selic_dias';
  if (s === 'por_faixa') return 'por_faixa';
  return 'fixo';
}

function normalizarModoCalculoJuros(raw: unknown): ModoCalculoJurosParcelamento {
  return String(raw ?? '').trim().toLowerCase() === 'percentual_faixa'
    ? 'percentual_faixa'
    : 'valor_fixo';
}

function legacyBloc(raw: unknown): { deb: string; cred: string; val: string } {
  if (!raw || typeof raw !== 'object') return { deb: '', cred: '', val: '0,00' };
  const o = raw as Record<string, unknown>;
  return {
    deb: String(o.contaDebitoStr ?? '').trim(),
    cred: String(o.contaCreditoStr ?? '').trim(),
    val: String(o.valorMensalStr ?? '0,00'),
  };
}

function unwrapParcelamentoRaw(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const nested =
    r.formState && typeof r.formState === 'object'
      ? (r.formState as Record<string, unknown>)
      : r.dados && typeof r.dados === 'object'
        ? (r.dados as Record<string, unknown>)
        : null;
  return nested ? { ...r, ...nested } : r;
}

export function normalizeSavedParcelamento(raw: unknown): SavedParcelamento {
  const r = unwrapParcelamentoRaw(raw);
  const acp = legacyBloc(r.jurosApropriarCurtoPrazo);
  const alp = legacyBloc(r.jurosApropriarLongoPrazo);
  const ocp = legacyBloc(r.jurosApropriadoValorCurtoPrazo);

  let valJuros = String(r.valorJurosMensalStr ?? r.valorJurosStr ?? '');
  if (!valJuros.trim()) valJuros = acp.val !== '0,00' ? acp.val : alp.val !== '0,00' ? alp.val : '0,00';

  const valorParcelaNormalized = String(r.valorParcelaStr ?? r.valorParcela ?? '0,00');
  const dataInicio =
    r.dataInicioPrimeiraParcelaStr ?? r.dataInicioStr ?? r.dataInicio ?? r.dataPrimeiraParcelaStr;

  return {
    id: String(r.id ?? crypto.randomUUID()),
    nomeParcelamento: String(r.nomeParcelamento ?? r.nome ?? ''),
    numeroParcelamento:
      r.numeroParcelamento != null ? String(r.numeroParcelamento).trim() : undefined,
    clienteNome: String(r.clienteNome ?? r.cliente ?? ''),
    companyName: r.companyName != null ? String(r.companyName).trim().toUpperCase() : undefined,
    valorParcelaStr: valorParcelaNormalized,
    numeroPrimeiraParcelaStr: String(r.numeroPrimeiraParcelaStr ?? r.numeroPrimeiraParcela ?? '1'),
    dataInicioPrimeiraParcelaStr: String(dataInicio ?? format(new Date(), 'yyyy-MM-dd')).slice(0, 10),
    quantidadeParcelasStr: String(
      r.quantidadeParcelasStr ?? r.quantidadeParcelas ?? r.qtdParcelas ?? '12',
    ),
    variacaoValorParcelas: normalizarVariacaoParcelas(r.variacaoValorParcelas),
    reajusteSelicEntreParcelas: !!r.reajusteSelicEntreParcelas,
    faixasValorParcelaJson:
      r.faixasValorParcelaJson != null ? String(r.faixasValorParcelaJson) : undefined,
    valorTotalParcelamentoStr:
      r.valorTotalParcelamentoStr != null && String(r.valorTotalParcelamentoStr).trim() !== ''
        ? String(r.valorTotalParcelamentoStr).trim()
        : undefined,
    createdAt: String(r.createdAt ?? new Date().toISOString()),
    dominioComplementoHistoricoStr:
      r.dominioComplementoHistoricoStr != null ? String(r.dominioComplementoHistoricoStr) : undefined,
    dominioCodigoHistoricoStr:
      r.dominioCodigoHistoricoStr != null ? String(r.dominioCodigoHistoricoStr) : undefined,
    accJurosAproDebit: String(r.accJurosAproDebit ?? acp.deb ?? ''),
    accJurosAproCredit: String(r.accJurosAproCredit ?? acp.cred ?? ''),
    valorJurosMensalStr: valJuros,
    modoCalculoJuros: normalizarModoCalculoJuros(r.modoCalculoJuros),
    faixasJurosPercentualJson:
      r.faixasJurosPercentualJson != null ? String(r.faixasJurosPercentualJson) : undefined,
    primeiraParcelaSemJuros: !!r.primeiraParcelaSemJuros,
    accApropriacaoDebit: String(r.accApropriacaoDebit ?? ocp.deb ?? ''),
    accApropriacaoCredit: String(r.accApropriacaoCredit ?? ocp.cred ?? ''),
    accTransferenciaDebit: String(r.accTransferenciaDebit ?? alp.deb ?? ''),
    accTransferenciaCredit: String(r.accTransferenciaCredit ?? alp.cred ?? ''),
    valorTransferenciaMensalStr: valorTransferenciaAnualFromParcelaStr(valorParcelaNormalized),
    accEmprestimoDebit: String(r.accEmprestimoDebit ?? ''),
    accEmprestimoCredit: String(r.accEmprestimoCredit ?? ''),
    accParcelaDebit: String(r.accParcelaDebit ?? ''),
    accParcelaCredit: String(r.accParcelaCredit ?? ''),
    accPagamentoDebit: String(r.accPagamentoDebit ?? ''),
    accPagamentoCredit: String(r.accPagamentoCredit ?? ''),
    cronogramaPlanilhaJson:
      r.cronogramaPlanilhaJson != null ? String(r.cronogramaPlanilhaJson) : undefined,
    dataGerarLancamentosAPartirStr: (() => {
      const s = String(r.dataGerarLancamentosAPartirStr ?? '').trim().slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
    })(),
    dataGerarLancamentosAteStr: (() => {
      const s = String(r.dataGerarLancamentosAteStr ?? '').trim().slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
    })(),
    selicManualStr: r.selicManualStr != null ? String(r.selicManualStr) : undefined,
  };
}

function parcelamentosArrayFromParsed(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items;
    if (Array.isArray(o.parcelamentos)) return o.parcelamentos;
    if (Array.isArray(o.data)) return o.data;
    if (o.id != null || o.nomeParcelamento != null || o.nome != null) return [parsed];
  }
  return [];
}

export function loadParcelamentosFromStorage(rawJson: string | null): SavedParcelamento[] {
  if (!rawJson?.trim()) return [];
  try {
    const parsed = JSON.parse(rawJson);
    const rows = parcelamentosArrayFromParsed(parsed);
    const out: SavedParcelamento[] = [];
    for (const row of rows) {
      try {
        out.push(normalizeSavedParcelamento(row));
      } catch (e) {
        console.warn('[parcelamentos] registro ignorado na carga:', e, row);
      }
    }
    return out;
  } catch (e) {
    console.error('[parcelamentos] JSON inválido no armazenamento:', e);
    return [];
  }
}

const PARCELAMENTOS_STORAGE_KEYS = [
  'simulador_parcelamentos',
  'parcelamentos',
  'emprestimos_parcelamentos',
] as const;

export function loadParcelamentosFromBrowserStorage(): SavedParcelamento[] {
  const collected: SavedParcelamento[][] = [];
  for (const key of PARCELAMENTOS_STORAGE_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw?.trim()) continue;
    const list = loadParcelamentosFromStorage(raw);
    if (list.length > 0) {
      collected.push(list);
      if (key !== 'simulador_parcelamentos') {
        console.info(`[parcelamentos] ${list.length} registro(s) recuperado(s) da chave legada "${key}".`);
      }
    }
  }
  const merged = mergeSavedById(collected);
  persistCanonicalList('simulador_parcelamentos', merged);
  return merged;
}
