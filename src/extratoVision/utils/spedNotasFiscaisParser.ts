import { formatDateBr } from './spedFiscalParser';
import {
  cfopEhEntrada,
  cfopEhRemessa,
  cfopEhSaida,
  normalizarCfop,
} from '../../contabilfacil/logic/fiscalCfopCatalog';

export type SpedNotaFiscal = {
  chave: string;
  numero: string;
  serie: string;
  data: string;
  codParticipante: string;
  nomeParticipante: string;
  valorTotal: number;
  valorPis: number;
  valorCofins: number;
  valorIcms: number;
  valorIpi: number;
  codContribuicao: string;
  /** CST/CFOP predominantes nos itens C170 (vínculo com C190). */
  cstIcms?: string;
  cfop?: string;
  /** C100 IND_OPER: 0 entrada, 1 saída. */
  indOper?: '0' | '1';
  linha: number;
};

type SpedRecord = { reg: string; fields: string[]; lineNum: number };

function parseBrFloat(s: string): number {
  if (!s?.trim()) return 0;
  const clean = s.trim().replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

function isPlausibleSpedDate(raw: string): boolean {
  if (!/^\d{8}$/.test(raw) || raw === '00000000') return false;
  const dd = Number.parseInt(raw.slice(0, 2), 10);
  const mm = Number.parseInt(raw.slice(2, 4), 10);
  const yyyy = Number.parseInt(raw.slice(4, 8), 10);
  return dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 1990 && yyyy <= 2100;
}

function parseParticipantes(records: SpedRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of records) {
    if (r.reg !== '0150') continue;
    const cod = (r.fields[2] ?? '').trim();
    const nome = (r.fields[3] ?? '').trim();
    if (cod && nome) map.set(cod, nome);
  }
  return map;
}

function cfopValidoEmCampo(val: string): string {
  const digits = val.replace(/\D/g, '');
  if (digits.length !== 4) return '';
  const c = digits.padStart(4, '0');
  const raiz = c[0];
  if (raiz !== '1' && raiz !== '2' && raiz !== '3' && raiz !== '5' && raiz !== '6' && raiz !== '7') {
    return '';
  }
  return c;
}

function cfopPredominante(itens: { cfop: string; valor: number }[]): string {
  const mapa = new Map<string, number>();
  for (const { cfop, valor } of itens) {
    if (!cfop) continue;
    mapa.set(cfop, (mapa.get(cfop) ?? 0) + Math.abs(valor));
  }
  let melhor = '';
  let maior = 0;
  for (const [cfop, valor] of mapa) {
    if (valor >= maior) {
      melhor = cfop;
      maior = valor;
    }
  }
  return melhor;
}

function spedRegBase(fields: string[], reg: string): number {
  const idx = fields.findIndex((f) => f.trim().toUpperCase() === reg.toUpperCase());
  return idx >= 0 ? idx : 1;
}

function c100Field(fields: string[], offset: number): string {
  return (fields[spedRegBase(fields, 'C100') + offset] ?? '').trim();
}

function c170Field(fields: string[], offset: number): string {
  return (fields[spedRegBase(fields, 'C170') + offset] ?? '').trim();
}

function extrairCfopC170(f: string[]): string {
  const base = spedRegBase(f, 'C170');
  const indices = [base + 11, base + 10, base + 12, base + 9, 11, 12, 10, 9, 13, 8];
  for (const idx of indices) {
    const hit = cfopValidoEmCampo(f[idx] ?? '');
    if (hit) return hit;
  }
  for (const campo of f) {
    const hit = cfopValidoEmCampo(campo ?? '');
    if (hit) return hit;
  }
  return '';
}

type C190Resumo = { cst: string; cfop: string; valor: number };

function parseC190Record(r: SpedRecord): C190Resumo | null {
  if (r.reg !== 'C190') return null;
  const base = spedRegBase(r.fields, 'C190');
  const cst = (r.fields[base + 1] ?? r.fields[2] ?? '').trim();
  const cfop = cfopValidoEmCampo(r.fields[base + 2] ?? r.fields[3] ?? '');
  if (!cfop) return null;
  const valor = parseBrFloat(
    r.fields[base + 4] ?? r.fields[5] ?? r.fields[base + 3] ?? r.fields[4] ?? '',
  );
  return { cst, cfop, valor };
}

function extrairResumosC190Documento(records: SpedRecord[], c100Line: number): C190Resumo[] {
  const out: C190Resumo[] = [];
  for (const r of records) {
    if (r.lineNum <= c100Line) continue;
    if (r.reg === 'C100' || r.reg === 'C195' || r.reg === 'D100' || r.reg === 'D500') break;
    const parsed = parseC190Record(r);
    if (parsed) out.push(parsed);
  }
  return out;
}

function cfopCompativelComNota(cfop: string, nota: SpedNotaFiscal): boolean {
  if (nota.indOper === '0') return cfopEhEntrada(cfop);
  if (nota.indOper === '1') return cfopEhSaida(cfop);
  if (cfopEhEntrada(cfop)) return true;
  if (cfopEhSaida(cfop)) return true;
  return false;
}

function resolverCfopDocumento(
  nota: SpedNotaFiscal,
  cfopC170: string,
  resumosC190: C190Resumo[],
): string {
  const cfopConhecido = normalizarCfop(cfopC170);
  if (cfopConhecido) return cfopConhecido;

  let candidatos = resumosC190.filter((r) => cfopCompativelComNota(r.cfop, nota));
  if (candidatos.length === 0) return '';
  if (candidatos.length === 1) return candidatos[0]!.cfop;

  const cstNota = (nota.cstIcms ?? '').replace(/\D/g, '').padStart(3, '0').slice(-3);
  if (cstNota) {
    const porCst = candidatos.filter((r) => {
      const cst = r.cst.replace(/\D/g, '').padStart(3, '0').slice(-3);
      return cst === cstNota;
    });
    if (porCst.length === 1) return porCst[0]!.cfop;
    if (porCst.length > 1) candidatos = porCst;
  }

  const valorNota = Math.abs(nota.valorTotal ?? 0);
  if (valorNota > 0) {
    const tolerancia = Math.max(valorNota * 0.02, 2);
    const porValor = candidatos
      .map((r) => ({ ...r, diff: Math.abs(r.valor - valorNota) }))
      .filter((r) => r.diff <= tolerancia)
      .sort((a, b) => a.diff - b.diff);
    if (porValor.length === 1) return porValor[0]!.cfop;
    if (porValor.length > 1) candidatos = porValor;
  }

  const remessa = candidatos.filter((r) => cfopEhRemessa(r.cfop));
  if (remessa.length === 1) return remessa[0]!.cfop;
  if (remessa.length > 1 && valorNota > 0) {
    const best = remessa
      .map((r) => ({ ...r, diff: Math.abs(r.valor - valorNota) }))
      .sort((a, b) => a.diff - b.diff)[0];
    if (best) return best.cfop;
  }

  const predominante = cfopPredominante(
    candidatos.map((r) => ({ cfop: r.cfop, valor: Math.max(r.valor, 0.01) })),
  );
  if (predominante) return predominante;

  return candidatos[0]!.cfop;
}

function somaC170PorDocumento(records: SpedRecord[], c100Line: number): {
  pis: number;
  cofins: number;
  icms: number;
  ipi: number;
  codContribuicao: string;
  cstIcms: string;
  cfop: string;
  resumosC190: C190Resumo[];
} {
  let pis = 0;
  let cofins = 0;
  let icms = 0;
  let ipi = 0;
  let codContribuicao = '';
  let cstIcms = '';
  const cfopItens: { cfop: string; valor: number }[] = [];
  const resumosC190 = extrairResumosC190Documento(records, c100Line);

  for (const r of records) {
    if (r.lineNum <= c100Line) continue;
    if (r.reg === 'C100' || r.reg === 'C195' || r.reg === 'D100' || r.reg === 'D500') break;
    if (r.reg !== 'C170' && r.reg !== 'C177') continue;
    const f = r.fields;
    const itemValor = parseBrFloat(f[7] ?? f[6] ?? f[12] ?? f[11] ?? '');
    pis += parseBrFloat(f[29] ?? f[28] ?? f[26] ?? f[25] ?? '');
    cofins += parseBrFloat(f[33] ?? f[32] ?? f[30] ?? f[29] ?? '');
    icms += parseBrFloat(f[15] ?? f[14] ?? '');
    ipi += parseBrFloat(f[20] ?? f[19] ?? '');
    const cod = (f[31] ?? f[32] ?? '').trim();
    if (cod && !codContribuicao) codContribuicao = cod;
    const itemCst = c170Field(f, 10) || (f[10] ?? f[9] ?? '').trim();
    const itemCfop = extrairCfopC170(f);
    if (itemCst && !cstIcms) cstIcms = itemCst;
    if (itemCfop) cfopItens.push({ cfop: itemCfop, valor: itemValor });
  }

  if (!cstIcms && resumosC190.length === 1) {
    cstIcms = resumosC190[0]!.cst;
  }

  return {
    pis,
    cofins,
    icms,
    ipi,
    codContribuicao,
    cstIcms,
    cfop: cfopPredominante(cfopItens),
    resumosC190,
  };
}

export function parseSpedNotasFiscaisFromRecords(records: SpedRecord[]): SpedNotaFiscal[] {
  const participantes = parseParticipantes(records);
  const notas: SpedNotaFiscal[] = [];

  for (const r of records) {
    if (r.reg !== 'C100') continue;
    const f = r.fields;
    const codSit = c100Field(f, 5) || (f[6] ?? '').trim();
    if (codSit === '02' || codSit === '03' || codSit === '04' || codSit === '05') continue;

    const codPart = c100Field(f, 3) || (f[4] ?? '').trim();
    const indRaw = c100Field(f, 1) || (f[2] ?? '').trim();
    const indOper = indRaw === '0' || indRaw === '1' ? indRaw : undefined;
    const serie = c100Field(f, 6) || (f[7] ?? '').trim();
    const numero = c100Field(f, 7) || (f[8] ?? '').trim();
    const chave = c100Field(f, 8) || (f[9] ?? '').trim();
    const dtDoc = c100Field(f, 9) || (f[10] ?? '').trim();
    const data = isPlausibleSpedDate(dtDoc) ? formatDateBr(dtDoc) : '';
    const valorTotal = parseBrFloat(c100Field(f, 11) || (f[12] ?? f[11] ?? ''));
    const tributos = somaC170PorDocumento(records, r.lineNum);

    const notaBase: SpedNotaFiscal = {
      chave,
      numero,
      serie,
      data,
      codParticipante: codPart,
      nomeParticipante: participantes.get(codPart) ?? codPart,
      valorTotal,
      valorPis: tributos.pis,
      valorCofins: tributos.cofins,
      valorIcms: tributos.icms,
      valorIpi: tributos.ipi,
      codContribuicao: tributos.codContribuicao,
      cstIcms: tributos.cstIcms || undefined,
      indOper,
      linha: r.lineNum,
    };

    const cfop = resolverCfopDocumento(notaBase, tributos.cfop, tributos.resumosC190);
    notas.push(cfop ? { ...notaBase, cfop } : notaBase);
  }

  return notas;
}

export function notaFiscalTextoBusca(nota: SpedNotaFiscal): string {
  return [nota.nomeParticipante, nota.numero, nota.serie, nota.chave, nota.codParticipante]
    .filter(Boolean)
    .join(' ');
}
