import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { readManagerData, writeManagerData } from './companyWorkspace';
import {
  contasParaImpostoLancamento,
  type FiscalContasImpostoConfig,
} from './fiscalContasImposto';
import { loadFiscalContasImposto } from './fiscalContasImpostoStorage';
import {
  FISCAL_RAZAO_MARCA,
  isFiscalRazaoRow,
  parseDataLancamentoFiscal,
} from './fiscalSpedToRazao';

export type FiscalOcrRelatorioRow = {
  id: string;
  date: string;
  description: string;
  debito: number;
  credito: number;
  /** Código do acumulador (recorte de PDF na subaba Acumuladores) — ausente = lançamento de imposto. */
  acumulador?: string;
};

export type BuildFiscalOcrRazaoResult = {
  rows: VisionBalanceteRow[];
  gerados: number;
  pendencias: string[];
};

function normalizeConta(conta: string): { codigo: string; classificacao: string } {
  const classificacao = conta.trim();
  const codigo = classificacao.replace(/\./g, '') || classificacao;
  return { codigo, classificacao };
}

function brDateToDisplay(iso: string | undefined): string {
  const t = String(iso ?? '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

export function buildRazaoFromFiscalOcr(
  linhas: FiscalOcrRelatorioRow[],
  contas: FiscalContasImpostoConfig,
  ordemInicial = 1,
): BuildFiscalOcrRazaoResult {
  const rows: VisionBalanceteRow[] = [];
  const pendencias: string[] = [];
  let ordem = ordemInicial;
  let gerados = 0;

  for (const linha of linhas) {
    const valor = Math.max(linha.debito ?? 0, linha.credito ?? 0);
    if (valor < 0.0001) continue;

    const natureza = (linha.debito ?? 0) >= (linha.credito ?? 0) ? 'devedora' : 'credora';
    const par = contasParaImpostoLancamento(contas, linha.description, natureza);
    if (!par.debito.trim() || !par.credito.trim()) {
      pendencias.push(
        `Sem contas para «${linha.description}» — configure o imposto na subaba Contas`,
      );
      continue;
    }

    const dataLanc = parseDataLancamentoFiscal(brDateToDisplay(linha.date));
    const historico = linha.description.trim().toUpperCase() || 'LANCAMENTO FISCAL OCR';
    const deb = normalizeConta(par.debito);
    const cred = normalizeConta(par.credito);
    const classificacao = `${FISCAL_RAZAO_MARCA} · OCR · ${linha.id}`;

    rows.push({
      codigo: deb.codigo,
      classificacao: deb.classificacao,
      nome: historico,
      data: dataLanc,
      debito: valor,
      credito: 0,
      saldoInicial: 0,
      saldoFinal: 0,
      ordem: ordem++,
      tipo: 'A',
    });
    rows.push({
      codigo: cred.codigo,
      classificacao: cred.classificacao,
      nome: historico,
      data: dataLanc,
      debito: 0,
      credito: valor,
      saldoInicial: 0,
      saldoFinal: 0,
      ordem: ordem++,
      tipo: 'A',
    });
    gerados += 1;
  }

  return { rows, gerados, pendencias };
}

/** Substitui lançamentos fiscais OCR no razão e persiste. */
export function postFiscalOcrNoRazao(
  companyName: string,
  linhas: FiscalOcrRelatorioRow[],
  contas?: FiscalContasImpostoConfig,
): { gerados: number; pendencias: string[] } {
  const cfg = contas ?? loadFiscalContasImposto(companyName);
  const { rows, gerados, pendencias } = buildRazaoFromFiscalOcr(linhas, cfg);
  if (rows.length === 0) return { gerados, pendencias };

  const existente = readManagerData<VisionBalanceteRow>(companyName, 'razao');
  // Mantém SPED/PGDAS e demais; só remove OCR fiscal anterior.
  const base = existente.filter(
    (r) => !(isFiscalRazaoRow(r) && String(r.classificacao ?? '').includes('· OCR ·')),
  );
  const maxOrdem = base.reduce((m, r) => Math.max(m, r.ordem ?? 0), 0);
  const reordenados = rows.map((r, i) => ({ ...r, ordem: maxOrdem + i + 1 }));
  writeManagerData(companyName, 'razao', [...base, ...reordenados]);
  return { gerados, pendencias };
}
