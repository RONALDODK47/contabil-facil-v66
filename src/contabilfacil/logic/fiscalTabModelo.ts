import type { ParsedSpedFiscal, SpedFiscalItem } from '../../extratoVision/utils/spedFiscalParser';
import { fiscalAcumuladorKey } from './fiscalAcumuladorModel';
import {
  FISCAL_IMPOSTOS,
  FISCAL_IMPOSTO_LABELS,
  resolveFiscalImpostoId,
  type FiscalImpostoId,
} from './fiscalContasImposto';
import type { FiscalSpedArquivoSalvo } from './fiscalSpedAutomation';
import type { FiscalPgdasArquivoSalvo } from './pgdasParser';
import type { FiscalOcrRelatorioRow } from './fiscalOcrAutomation';

/** Um item de um arquivo, já com a origem (nome do arquivo) anexada — base comum para as duas subabas. */
export type FiscalFonteItem = {
  arquivoId: string;
  fileName: string;
  data: string;
  item: SpedFiscalItem;
};

export function coletarFontesFiscais(
  arquivosSped: FiscalSpedArquivoSalvo[],
  arquivosPgdas: FiscalPgdasArquivoSalvo[],
): FiscalFonteItem[] {
  const fontes: FiscalFonteItem[] = [];
  for (const arq of arquivosSped) {
    for (const item of arq.parsed.itens) {
      fontes.push({
        arquivoId: arq.id,
        fileName: arq.parsed.fileName,
        data:
          item.data ||
          (arq.parsed.dtFinLabel && arq.parsed.dtFinLabel !== '—' ? arq.parsed.dtFinLabel : arq.parsed.dtFin),
        item,
      });
    }
  }
  for (const arq of arquivosPgdas) {
    for (const item of arq.parsed.itens) {
      fontes.push({
        arquivoId: arq.id,
        fileName: arq.parsed.fileName,
        data: item.data || arq.parsed.dtFinLabel,
        item,
      });
    }
  }
  return fontes;
}

export type FiscalImpostoPresente = { id: FiscalImpostoId; label: string };

/** Impostos com pelo menos 1 lançamento importado — só esses mostram linha de regra de conta. */
export function impostosPresentes(fontes: FiscalFonteItem[]): FiscalImpostoPresente[] {
  const ids = new Set<FiscalImpostoId>();
  for (const f of fontes) {
    if (f.item.kind !== 'imposto') continue;
    const id = resolveFiscalImpostoId(f.item.imposto);
    if (id) ids.add(id);
  }
  return FISCAL_IMPOSTOS.filter((id) => ids.has(id)).map((id) => ({ id, label: FISCAL_IMPOSTO_LABELS[id] }));
}

export type FiscalAcumuladorPresente = { key: string; label: string; registro: string; codigo: string };

/** Códigos de acumulador com pelo menos 1 lançamento — dedup por chave (registro|código|imposto). */
export function acumuladoresPresentes(fontes: FiscalFonteItem[]): FiscalAcumuladorPresente[] {
  const map = new Map<string, FiscalAcumuladorPresente>();
  for (const f of fontes) {
    if (f.item.kind !== 'acumulador') continue;
    const key = fiscalAcumuladorKey(f.item);
    if (map.has(key)) continue;
    const nome = f.item.nome?.trim() || f.item.descricao;
    map.set(key, {
      key,
      label: `${f.item.codigo} · ${nome}`.trim(),
      registro: f.item.registro,
      codigo: f.item.codigo,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.codigo.localeCompare(b.codigo));
}

export type FiscalCfopPresente = { cfop: string; cst: string };

/** CFOPs distintos com pelo menos 1 lançamento C190 — dedup por código de CFOP. */
export function cfopsPresentes(fontes: FiscalFonteItem[]): FiscalCfopPresente[] {
  const map = new Map<string, FiscalCfopPresente>();
  for (const f of fontes) {
    if (f.item.kind !== 'acumulador' || f.item.registro !== 'C190') continue;
    const [cst, cfop] = f.item.codigo.split('-');
    if (!cfop?.trim()) continue;
    if (!map.has(cfop)) map.set(cfop, { cfop, cst: cst?.trim() || '—' });
  }
  return Array.from(map.values()).sort((a, b) => a.cfop.localeCompare(b.cfop));
}

/**
 * Empacota linhas recortadas de PDF (data/descrição/[acumulador]/valor) como um "arquivo SPED"
 * sintético, para reaproveitar toda a tabela/filtro/regras/postagem já existentes.
 */
export function ocrRowsParaArquivoFiscal(
  rows: FiscalOcrRelatorioRow[],
  fileName: string,
): FiscalSpedArquivoSalvo | null {
  const itens: SpedFiscalItem[] = [];
  rows.forEach((row, i) => {
    const valor = Math.max(row.debito ?? 0, row.credito ?? 0);
    if (valor < 0.0001) return;
    const isAcumulador = Boolean(row.acumulador?.trim());
    const natureza: SpedFiscalItem['natureza'] = (row.credito ?? 0) > (row.debito ?? 0) ? 'credora' : 'devedora';
    itens.push({
      kind: isAcumulador ? 'acumulador' : 'imposto',
      natureza,
      registro: 'RECORTE',
      codigo: row.acumulador?.trim() || `RECORTE-${i}`,
      nome: row.description,
      descricao: row.description,
      imposto: isAcumulador ? row.acumulador!.trim() : row.description,
      valor,
      linha: i + 1,
      data: row.date,
    });
  });
  if (!itens.length) return null;

  const parsed: ParsedSpedFiscal = {
    tipo: 'DESCONHECIDO',
    fileName,
    cnpj: '',
    empresa: '',
    dtIni: '',
    dtFin: '',
    dtFinLabel: '—',
    itens,
    issues: [],
  };
  return { id: crypto.randomUUID(), parsed };
}
