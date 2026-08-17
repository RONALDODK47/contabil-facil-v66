import { parseOfxToLedgerRows } from '../../extratoVision/utils/ofxLedgerParser';
import type { ExtratoConciliacaoResumo } from '../../lib/itauExtratoProfile';
import { readTextFileSmart } from './dominioTxtIO';

export type { ExtratoConciliacaoResumo };

export type OfxExtratoImportContext = {
  contaBanco: string;
  bancoNome?: string;
};

export type OfxExtratoImportItem = {
  id: string;
  date: string;
  description: string;
  value: number;
  nature: 'D' | 'C';
  accountCode: string;
  status: 'CONCILIADO';
};

export type OfxExtratoImportResult = {
  items: OfxExtratoImportItem[];
  saldoAnterior?: number;
  conciliacao?: ExtratoConciliacaoResumo;
  logs: string[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseOfxMoeda(raw: string | undefined): number | undefined {
  if (raw == null || !String(raw).trim()) return undefined;
  const clean = String(raw).trim().replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(clean.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Saldo em <LEDGERBAL> (abertura ou fechamento conforme o banco). */
function parseOfxLedgerBalAmt(content: string): number | undefined {
  const m = /<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i.exec(content);
  return parseOfxMoeda(m?.[1]);
}

/** Saldo disponível em <AVAILBAL>, quando presente (geralmente saldo final). */
function parseOfxAvailBalAmt(content: string): number | undefined {
  const m = /<AVAILBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i.exec(content);
  return parseOfxMoeda(m?.[1]);
}

export function buildOfxExtratoConciliacao(
  items: OfxExtratoImportItem[],
  opts?: { ledgerBal?: number; availBal?: number },
): ExtratoConciliacaoResumo {
  const creditos = round2(
    items.filter((i) => i.nature === 'C').reduce((s, i) => s + Math.abs(i.value), 0),
  );
  const debitos = round2(
    items.filter((i) => i.nature === 'D').reduce((s, i) => s + Math.abs(i.value), 0),
  );

  const ledgerBal = opts?.ledgerBal;
  const availBal = opts?.availBal;

  let saldoAnterior = 0;
  let saldoFinalOfx: number | undefined = availBal ?? undefined;

  if (ledgerBal != null) {
    const seAbertura = round2(ledgerBal + creditos - debitos);
    const seFechamento = round2(ledgerBal);
    const anteriorSeFechamento = round2(ledgerBal - creditos + debitos);

    if (availBal != null) {
      saldoAnterior = anteriorSeFechamento >= 0 ? anteriorSeFechamento : ledgerBal;
      saldoFinalOfx = availBal;
    } else if (Math.abs(seAbertura - ledgerBal) <= 0.02) {
      saldoAnterior = round2(ledgerBal - creditos + debitos);
      saldoFinalOfx = ledgerBal;
    } else {
      saldoAnterior = round2(ledgerBal);
      saldoFinalOfx = seAbertura;
    }
  } else if (availBal != null) {
    saldoAnterior = round2(availBal - creditos + debitos);
    saldoFinalOfx = availBal;
  }

  const saldoConciliado = round2(saldoAnterior + creditos - debitos);
  const deltaSaldoFinal =
    saldoFinalOfx != null ? round2(Math.abs(saldoConciliado - saldoFinalOfx)) : undefined;
  const ok =
    items.length > 0 &&
    (saldoFinalOfx == null || (deltaSaldoFinal != null && deltaSaldoFinal <= 0.02));

  let mensagem: string;
  if (ok) {
    mensagem =
      saldoFinalOfx != null
        ? `Conciliação OFX OK — saldo R$ ${saldoConciliado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (saldo final OFX R$ ${saldoFinalOfx.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`
        : `Conciliação OFX OK — ${items.length} lançamento(s), saldo R$ ${saldoConciliado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  } else if (saldoFinalOfx != null && deltaSaldoFinal != null) {
    mensagem = `Revisar OFX — saldo calculado R$ ${saldoConciliado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, saldo final OFX R$ ${saldoFinalOfx.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (diferença R$ ${deltaSaldoFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`;
  } else {
    mensagem = `${items.length} lançamento(s) OFX — débitos R$ ${debitos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, créditos R$ ${creditos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  }

  return {
    ok,
    perfilItau: false,
    saldoAnterior,
    creditos,
    debitos,
    saldoConciliado,
    saldoFinalOcr: saldoFinalOfx,
    deltaSaldoFinal,
    alertasCriticos: 0,
    mensagem,
  };
}

function brDateToIso(data: string | undefined): string {
  const t = String(data ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/);
  if (!m) return new Date().toISOString().split('T')[0]!;
  const yearPart = m[3] ?? String(new Date().getFullYear());
  const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;
  return `${year}-${m[2]}-${m[1]}`;
}

function parseOfxSaldoAnterior(content: string): number | undefined {
  return parseOfxLedgerBalAmt(content);
}

export function parseOfxContentToExtratoItems(
  content: string,
  ctx?: OfxExtratoImportContext,
): OfxExtratoImportResult {
  const logs: string[] = [];
  const contaBanco = ctx?.contaBanco?.trim() ?? '';
  if (!contaBanco) {
    return { items: [], logs: ['Informe a conta contábil do banco antes de importar o OFX.'] };
  }

  const ledgerRows = parseOfxToLedgerRows(content);
  if (ledgerRows.length === 0) {
    return { items: [], logs: ['Nenhuma transação <STMTTRN> encontrada no arquivo OFX/QFX.'] };
  }

  const stamp = Date.now();
  const items: OfxExtratoImportItem[] = ledgerRows.map((row, index) => {
    const debito = row.debito > 0.0001 ? row.debito : 0;
    const credito = row.credito > 0.0001 ? row.credito : 0;
    const nature: 'D' | 'C' = debito >= credito && debito > 0 ? 'D' : 'C';
    const value = nature === 'D' ? debito : credito;
    return {
      id: `ofx-${stamp}-${index}`,
      date: brDateToIso(row.data),
      description: row.historico.trim().toUpperCase() || 'LANCAMENTO OFX',
      value,
      nature,
      accountCode: '',
      status: 'CONCILIADO',
    };
  });

  const bancoLabel = ctx?.bancoNome?.trim();
  if (bancoLabel) {
    logs.push(`Banco: ${bancoLabel} · Conta contábil: ${contaBanco}.`);
  } else {
    logs.push(`Conta contábil do banco: ${contaBanco}.`);
  }
  logs.push(`${items.length} lançamento(s) importado(s) do OFX/QFX.`);

  const ledgerBal = parseOfxLedgerBalAmt(content);
  const availBal = parseOfxAvailBalAmt(content);
  const conciliacao = buildOfxExtratoConciliacao(items, { ledgerBal, availBal });
  const saldoAnterior = conciliacao.saldoAnterior;

  logs.push(
    `Totais OFX — débitos R$ ${conciliacao.debitos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, créditos R$ ${conciliacao.creditos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
  );
  if (saldoAnterior > 0.0001) {
    logs.push(`Saldo anterior: R$ ${saldoAnterior.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`);
  }
  if (conciliacao.saldoFinalOcr != null) {
    logs.push(
      `Saldo final OFX: R$ ${conciliacao.saldoFinalOcr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
    );
  }
  logs.push(conciliacao.mensagem);

  return { items, saldoAnterior, conciliacao, logs };
}

export async function importOfxFileToExtratoItems(
  file: File,
  ctx: OfxExtratoImportContext,
): Promise<OfxExtratoImportResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext !== 'ofx' && ext !== 'qfx') {
    return { items: [], logs: ['Selecione um arquivo .ofx ou .qfx exportado pelo banco ou Microsoft Money.'] };
  }
  if (!ctx.contaBanco?.trim()) {
    return { items: [], logs: ['Informe a conta contábil do banco antes de importar o OFX.'] };
  }
  const content = await readTextFileSmart(file);
  return parseOfxContentToExtratoItems(content, ctx);
}
