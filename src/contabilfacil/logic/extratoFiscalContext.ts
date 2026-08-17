import type { SpedFiscalItem } from '../../extratoVision/utils/spedFiscalParser';
import { inferSpedFiscalNatureza } from '../../extratoVision/utils/spedFiscalParser';
import { contasParaImpostoLancamento, type FiscalContasImpostoConfig } from './fiscalContasImposto';
import { loadFiscalContasImposto } from './fiscalContasImpostoStorage';
import { readManagerData } from './companyWorkspace';
import { fiscalAcumuladorKey } from './fiscalAcumuladorModel';
import {
  regraDoAcumulador,
  loadFiscalAcumuladorContas,
} from './fiscalAcumuladorContasStorage';
import { loadFiscalAcumuladorRegras } from './fiscalAcumuladorRegrasStorage';

type FiscalSpedArquivoSalvo = {
  id: string;
  parsed: {
    itens: SpedFiscalItem[];
    dtIni?: string;
    dtFin?: string;
  };
};

export type ExtratoFiscalIndexEntry = {
  valor: number;
  mesRef: string;
  data: string;
  imposto: string;
  kind: 'acumulador' | 'imposto';
  naturezaFiscal: 'devedora' | 'credora';
  descricao: string;
  registro: string;
  codigo: string;
  acumuladorKey: string;
  contaDebito: string;
  contaCredito: string;
};

export type ExtratoFiscalContext = {
  entries: ExtratoFiscalIndexEntry[];
  contasConfig: FiscalContasImpostoConfig;
  acumuladorRegras: ReturnType<typeof loadFiscalAcumuladorRegras>;
};

/** Extrai YYYY-MM de DD/MM/YYYY, YYYY-MM-DD ou período SPED. */
export function extratoMesReferencia(data: string): string | null {
  const t = (data ?? '').trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 7);
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}`;
  if (t.includes('—') || t.includes('–')) {
    const parts = t.split(/[—–]/).map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1] ?? '';
    const m = last.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2]}`;
  }
  return null;
}

function flattenFiscalEntries(
  arquivos: FiscalSpedArquivoSalvo[],
  contas: FiscalContasImpostoConfig,
  acumuladorContas: ReturnType<typeof loadFiscalAcumuladorContas>,
): ExtratoFiscalIndexEntry[] {
  const out: ExtratoFiscalIndexEntry[] = [];
  for (const arq of arquivos) {
    const periodoMes =
      extratoMesReferencia(arq.parsed.dtFin ?? '') ??
      extratoMesReferencia(arq.parsed.dtIni ?? '');
    for (const item of arq.parsed.itens ?? []) {
      const valor = Math.abs(item.valor ?? 0);
      if (valor < 0.01) continue;
      const regra = item.kind === 'acumulador' ? regraDoAcumulador(acumuladorContas, item) : null;
      const custom = regra && (regra.debito.trim() || regra.credito.trim()) ? regra : null;
      const naturezaFiscal = item.natureza ?? inferSpedFiscalNatureza(item);
      const par =
        custom != null
          ? { debito: custom.debito, credito: custom.credito }
          : contasParaImpostoLancamento(contas, item.imposto, naturezaFiscal);
      const mesRef = extratoMesReferencia(item.data ?? '') ?? periodoMes ?? '';
      out.push({
        valor,
        mesRef,
        data: item.data ?? '',
        imposto: item.imposto,
        kind: item.kind,
        naturezaFiscal,
        descricao: item.descricao,
        registro: item.registro,
        codigo: item.codigo,
        acumuladorKey: fiscalAcumuladorKey(item),
        contaDebito: par.debito.trim(),
        contaCredito: par.credito.trim(),
      });
    }
  }
  return out;
}

export function buildExtratoFiscalContext(companyName: string): ExtratoFiscalContext | null {
  const name = companyName?.trim();
  if (!name) return null;
  const arquivos = readManagerData<FiscalSpedArquivoSalvo>(name, 'fiscalSped');
  const contasConfig = loadFiscalContasImposto(name);
  const acumuladorContas = loadFiscalAcumuladorContas(name);
  const entries = flattenFiscalEntries(arquivos, contasConfig, acumuladorContas);
  if (entries.length === 0) return null;
  return { entries, contasConfig, acumuladorRegras: loadFiscalAcumuladorRegras(name) };
}
