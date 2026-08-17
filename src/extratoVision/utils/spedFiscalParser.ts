import {
  parseSpedNotasFiscaisFromRecords,
  type SpedNotaFiscal,
} from './spedNotasFiscaisParser';
import {
  descricaoCfop,
  inferNaturezaAcumuladorPorOperacao,
  isSimplesNacionalCsosn,
  nomeAcumuladorC190,
} from '../../contabilfacil/logic/fiscalCfopCatalog';

export type { SpedNotaFiscal };

export type SpedFiscalBalanceteRow = {
  codigo: string;
  classificacao?: string;
  nome: string;
  data?: string;
  ordem?: number;
  saldoInicial: number;
  debito: number;
  credito: number;
  saldoFinal: number;
  tipo?: 'S' | 'A';
};

export type SpedFiscalTipo = 'CONTRIBUICOES' | 'ICMS_IPI' | 'DESCONHECIDO';

export type SpedFiscalItemKind = 'acumulador' | 'imposto';

/** Natureza contábil do imposto: devedora = a recuperar; credora = a pagar/recolher. */
export type SpedFiscalNatureza = 'devedora' | 'credora';

export interface SpedFiscalItem {
  kind: SpedFiscalItemKind;
  /** Natureza da conta do imposto (não confundir com kind acumulador/imposto). */
  natureza: SpedFiscalNatureza;
  registro: string;
  codigo: string;
  /** Nome amigável (CFOP, obrigação, produto). */
  nome?: string;
  descricao: string;
  imposto: string;
  valor: number;
  linha: number;
  /** Data do registro (vencimento/apuração) ou período do arquivo (0000). */
  data: string;
}

export interface ParsedSpedFiscal {
  tipo: SpedFiscalTipo;
  fileName: string;
  cnpj: string;
  empresa: string;
  dtIni: string;
  dtFin: string;
  dtFinLabel: string;
  itens: SpedFiscalItem[];
  /** Notas fiscais (C100) extraídas do mesmo arquivo — usadas na aba Acumuladores. */
  notasFiscais?: SpedNotaFiscal[];
  issues: string[];
}

export interface SpedFiscalResumoArquivo {
  tipo: SpedFiscalTipo;
  fileName: string;
  savedAt: string;
  cnpj: string;
  empresa: string;
  periodo: string;
  acumuladores: number;
  impostos: number;
}

const REG_LABELS: Record<string, string> = {
  M200: 'Consolidação PIS/Pasep (M200)',
  M205: 'PIS a recolher por código de receita (M205)',
  M210: 'Detalhe PIS — código de contribuição (M210)',
  M600: 'Consolidação COFINS (M600)',
  M605: 'COFINS a recolher por código de receita (M605)',
  M610: 'Detalhe COFINS — código de contribuição (M610)',
  E110: 'Apuração ICMS (E110)',
  E111: 'Ajuste/benefício ICMS (E111)',
  E116: 'Obrigação ICMS a recolher (E116)',
  E250: 'Apuração IPI (E250)',
  C190: 'Consolidação por CST/CFOP/ALIQ (C190)',
};

/** Impostos a recuperar → devedora; impostos a pagar/recolher → credora. */
export function inferSpedFiscalNatureza(
  item: Pick<SpedFiscalItem, 'kind' | 'registro' | 'codigo' | 'descricao' | 'nome'>,
): SpedFiscalNatureza {
  const cod = item.codigo.toUpperCase();
  const desc = item.descricao.toUpperCase();
  const reg = item.registro.toUpperCase();

  if (item.kind === 'imposto') return 'credora';

  if (
    cod === 'E110-DEB' ||
    desc.includes('TOTAL DÉBITOS ICMS') ||
    desc.includes('TOTAL DEBITOS ICMS')
  ) {
    return 'credora';
  }

  if (
    cod === 'E110-CRED' ||
    cod === 'E110-SLD-CRED' ||
    desc.includes('CRÉDITOS ICMS') ||
    desc.includes('CREDITOS ICMS') ||
    desc.includes('SALDO CREDOR') ||
    desc.includes('RECUPERAR')
  ) {
    return 'devedora';
  }

  if (reg === 'E111') {
    if (/CR[EÉ]D|RECUPER|BENEF[IÍ]CIO/i.test(desc)) return 'devedora';
    if (/DEB|RECOLHER|PAGAR/i.test(desc)) return 'credora';
  }

  if (reg === 'E110' && cod === 'E110-ESP') return 'credora';

  if (item.kind === 'acumulador') {
    const porCfop = inferNaturezaAcumuladorPorOperacao(item);
    if (porCfop) return porCfop;
  }

  return 'devedora';
}

export function spedFiscalNaturezaLabel(natureza: SpedFiscalNatureza): 'Débito' | 'Crédito' {
  return natureza === 'devedora' ? 'Débito' : 'Crédito';
}

/** Rótulo principal para exibição (nome amigável ou descrição técnica). */
export function spedFiscalItemLabel(item: Pick<SpedFiscalItem, 'nome' | 'descricao'>): string {
  return (item.nome ?? '').trim() || item.descricao;
}

function parseBrFloat(s: string): number {
  if (!s?.trim()) return 0;
  const clean = s.trim().replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

export function formatDateBr(dt: string): string {
  if (!dt || dt.length < 8) return dt || '—';
  return `${dt.slice(0, 2)}/${dt.slice(2, 4)}/${dt.slice(4, 8)}`;
}

function isPlausibleSpedDate(raw: string): boolean {
  if (!/^\d{8}$/.test(raw) || raw === '00000000') return false;
  const dd = Number.parseInt(raw.slice(0, 2), 10);
  const mm = Number.parseInt(raw.slice(2, 4), 10);
  const yyyy = Number.parseInt(raw.slice(4, 8), 10);
  return dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 1990 && yyyy <= 2100;
}

/** Primeira data DDMMYYYY válida nos campos do registro (ex.: DT_VENC no E116). */
export function extractSpedDateFromFields(fields: string[], reg?: string): string | undefined {
  if (reg === 'E116') {
    const venc = (fields[4] ?? '').trim();
    if (isPlausibleSpedDate(venc)) return formatDateBr(venc);
  }
  if (reg === 'E250') {
    const venc = (fields[4] ?? fields[3] ?? '').trim();
    if (isPlausibleSpedDate(venc)) return formatDateBr(venc);
  }
  for (const f of fields) {
    const t = (f ?? '').trim();
    if (isPlausibleSpedDate(t)) return formatDateBr(t);
  }
  return undefined;
}

/** Período do bloco 0000 (DT_INI — DT_FIN). */
export function formatSpedPeriodoLabel(dtIni: string, dtFin: string, dtFinLabel?: string): string {
  const ini = dtIni ? formatDateBr(dtIni) : '';
  const fin = dtFin ? formatDateBr(dtFin) : dtFinLabel && dtFinLabel !== '—' ? dtFinLabel : '';
  if (ini && fin && ini !== fin) return `${ini} — ${fin}`;
  return fin || ini || '—';
}

function findCnpj(fields: string[]): string {
  for (const f of fields) {
    const d = f.replace(/\D/g, '');
    if (d.length === 14) return d;
  }
  return '';
}

export function parseSpedLines(text: string): { reg: string; fields: string[]; lineNum: number }[] {
  const out: { reg: string; fields: string[]; lineNum: number }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw.includes('|')) continue;
    const fields = raw.split('|');
    const reg = (fields[1] ?? '').trim().toUpperCase();
    if (!reg) continue;
    out.push({ reg, fields, lineNum: i + 1 });
  }
  return out;
}

function detectTipo(regs: Set<string>, rec0000?: string[]): SpedFiscalTipo {
  if (regs.has('E110') || regs.has('E100') || regs.has('E001')) return 'ICMS_IPI';
  if (regs.has('M200') || regs.has('M600') || regs.has('M210') || regs.has('M610')) return 'CONTRIBUICOES';
  const hint = (rec0000?.[2] ?? rec0000?.[3] ?? '').toUpperCase();
  if (hint.includes('ICMS') || hint.includes('IPI')) return 'ICMS_IPI';
  if (hint.includes('CONTRIB') || hint.includes('PIS') || hint.includes('COFINS')) return 'CONTRIBUICOES';
  return 'DESCONHECIDO';
}

function pushItem(
  items: SpedFiscalItem[],
  partial: Omit<SpedFiscalItem, 'linha' | 'data' | 'natureza'> & {
    linha?: number;
    data?: string;
    natureza?: SpedFiscalNatureza;
  },
  periodoFallback: string,
  fields?: string[],
) {
  if (!partial.valor || Math.abs(partial.valor) < 0.0001) return;
  const data = partial.data ?? extractSpedDateFromFields(fields ?? [], partial.registro) ?? periodoFallback;
  const natureza = partial.natureza ?? inferSpedFiscalNatureza(partial);
  items.push({ ...partial, natureza, data, linha: partial.linha ?? 0 });
}

/** Evita M200+M205 e M600+M605 com o mesmo valor (consolidação + detalhe). */
export function contribRegistroPrioridade(regs: Set<string>) {
  return {
    pis: regs.has('M210') ? 'M210' : regs.has('M205') ? 'M205' : regs.has('M200') ? 'M200' : null,
    cofins: regs.has('M610') ? 'M610' : regs.has('M605') ? 'M605' : regs.has('M600') ? 'M600' : null,
  };
}

/** Remove consolidação quando há detalhe e linhas legadas duplicadas do M200. */
export function dedupeSpedFiscalItens(itens: SpedFiscalItem[]): SpedFiscalItem[] {
  // If we have A170 records, skip dedupe for those entirely
  const hasA170 = itens.some(i => i.registro.toUpperCase() === 'A170');
  if (hasA170) {
    return itens.filter(item => {
      const reg = item.registro.toUpperCase();
      // Only keep A170 records and nothing else (since we want line-by-line, not accumulated)
      return reg === 'A170';
    });
  }
  // Otherwise proceed with original dedupe logic for M records
  const regs = new Set(itens.map((i) => i.registro.toUpperCase()));
  const prio = contribRegistroPrioridade(regs);
  return itens.filter((item) => {
    const reg = item.registro.toUpperCase();
    if (reg === 'M200' && prio.pis !== 'M200') return false;
    if (reg === 'M205' && prio.pis !== 'M205') return false;
    if (reg === 'M210' && prio.pis !== 'M210') return false;
    if (reg === 'M600' && prio.cofins !== 'M600') return false;
    if (reg === 'M605' && prio.cofins !== 'M605') return false;
    if (reg === 'M610' && prio.cofins !== 'M610') return false;
    if (item.codigo === 'M200-PIS-NC') return false;
    return true;
  });
}

export function dedupeIcmsSpedItens(itens: SpedFiscalItem[]): SpedFiscalItem[] {
  const hasE116 = itens.some((i) => i.registro.toUpperCase() === 'E116');
  if (!hasE116) return itens;
  return itens.filter((i) => !(i.registro.toUpperCase() === 'E110' && i.codigo === 'E110-SLD'));
}

function parseCstCfopFromCodigo(codigo: string): { cst: string; cfop: string } | null {
  const m = codigo.trim().match(/^(\d{2,3})-(\d{4})$/);
  if (!m) return null;
  return { cst: m[1]!, cfop: m[2]! };
}

function parseCstCfopFromDescricao(descricao: string): { cst: string; cfop: string } | null {
  const cstMatch = descricao.match(/CST\s+(\d{2,3})/i);
  const cfopMatch = descricao.match(/CFOP\s+(\d{4})/i);
  if (!cstMatch || !cfopMatch) return null;
  return { cst: cstMatch[1]!, cfop: cfopMatch[1]! };
}

/** Preenche nomes amigáveis em itens já importados (antes da correção do parser). */
function enrichSpedFiscalItens(itens: SpedFiscalItem[]): SpedFiscalItem[] {
  return itens.map((it) => {
    const reg = it.registro.toUpperCase();

    if (reg === 'C190') {
      const pair =
        parseCstCfopFromCodigo(it.codigo) ?? parseCstCfopFromDescricao(it.descricao);
      const cst = pair?.cst ?? it.codigo.split('-')[0] ?? '';
      const imposto = isSimplesNacionalCsosn(cst) ? 'Simples Nacional' : it.imposto;
      if (!(it.nome ?? '').trim() && pair) {
        return { ...it, imposto, nome: nomeAcumuladorC190(pair.cst, pair.cfop) };
      }
      if (imposto !== it.imposto) return { ...it, imposto };
    }

    if (reg === 'E116' && !(it.nome ?? '').trim()) {
      const codRec = it.descricao.match(/rec\.\s*([\d-]+)/i)?.[1];
      return {
        ...it,
        nome: `ICMS a recolher${codRec ? ` · rec. ${codRec}` : ''}`,
      };
    }

    if (reg === 'E250' && !(it.nome ?? '').trim()) {
      return { ...it, nome: 'IPI apurado no período' };
    }

    if ((reg === 'M210' || reg === 'M610') && !(it.nome ?? '').trim()) {
      const imposto = reg === 'M210' ? 'PIS/Pasep' : 'COFINS';
      return { ...it, nome: `${imposto} · código ${it.codigo || '—'}` };
    }

    return it;
  });
}

/** Remove linhas legadas que usavam receita CSOSN como imposto. */
function stripReceitaComoImpostoSimples(itens: SpedFiscalItem[]): SpedFiscalItem[] {
  return itens.filter(
    (i) =>
      !(
        i.kind === 'imposto' &&
        /simples/i.test(i.imposto) &&
        (i.codigo === 'SN-BASE' || /receita no período/i.test(i.nome ?? ''))
      ),
  );
}

/** Soma apenas tributos (ICMS, ST, IPI) de linhas C190 CSOSN. */
function tributoC190SimplesNacional(fields: string[]): number {
  const vlIcms = parseBrFloat(fields[7] ?? '');
  const vlSt = parseBrFloat(fields[9] ?? '');
  const vlIpi = parseBrFloat(fields[10] ?? '');
  return vlIcms + vlSt + vlIpi;
}

export function sanitizeParsedSpedFiscal(parsed: ParsedSpedFiscal): ParsedSpedFiscal {
  const periodo = formatSpedPeriodoLabel(parsed.dtIni, parsed.dtFin, parsed.dtFinLabel);
  let itens = parsed.itens.map((it) => ({
    ...it,
    registro: it.registro.toUpperCase(),
    data: it.data ?? periodo,
    natureza: it.natureza ?? inferSpedFiscalNatureza(it),
  }));
  itens = stripReceitaComoImpostoSimples(itens);
  itens = enrichSpedFiscalItens(itens);
  if (parsed.tipo === 'CONTRIBUICOES') itens = dedupeSpedFiscalItens(itens);
  else if (parsed.tipo === 'ICMS_IPI') itens = dedupeIcmsSpedItens(itens);
  const notasFiscais = parsed.notasFiscais ?? [];
  return { ...parsed, itens, notasFiscais };
}

function parseContribuicoes(
  records: { reg: string; fields: string[]; lineNum: number }[],
  periodoFallback: string,
): SpedFiscalItem[] {
  const items: SpedFiscalItem[] = [];
  const regs = new Set(records.map((r) => r.reg));
  const prio = contribRegistroPrioridade(regs);

  // First, build a map of participants (0150 records)
  const participantes = new Map<string, string>();
  for (const r of records) {
    if (r.reg !== '0150') continue;
    const cod = (r.fields[2] ?? '').trim();
    const nome = (r.fields[3] ?? '').trim();
    if (cod && nome) participantes.set(cod, nome);
  }

  // Iterate all A100 records (each is a document/transaction)
  for (let i = 0; i < records.length; i++) {
    const a100 = records[i];
    if (a100.reg !== 'A100') continue;

    const f100 = a100.fields;
    const baseIdx100 = f100.findIndex((x) => x.trim().toUpperCase() === 'A100') >= 0
      ? f100.findIndex((x) => x.trim().toUpperCase() === 'A100')
      : 1;

    // Get fields for A100
    const codPart = (f100[baseIdx100 + 3] ?? f100[4] ?? '').trim();
    const dtDoc = (f100[baseIdx100 + 9] ?? f100[10] ?? '').trim();
    const dataDoc = isPlausibleSpedDate(dtDoc) ? formatDateBr(dtDoc) : periodoFallback;
    const nomePart = participantes.get(codPart) || codPart;

    // Now get all A170 records after this A100 until next A100 or A990
    for (let j = i + 1; j < records.length; j++) {
      const r = records[j];
      if (r.reg === 'A100' || r.reg === 'A990') break;
      if (r.reg !== 'A170') continue;

      const f170 = r.fields;
      const baseIdx170 = f170.findIndex((x) => x.trim().toUpperCase() === 'A170') >= 0
        ? f170.findIndex((x) => x.trim().toUpperCase() === 'A170')
        : 1;

      // Campos do A170 (Guia Prático EFD-Contribuições, posições fixas):
      // 9 CST_PIS · 10 VL_BC_PIS · 11 ALIQ_PIS · 12 VL_PIS ·
      // 13 CST_COFINS · 14 VL_BC_COFINS · 15 ALIQ_COFINS · 16 VL_COFINS.
      // A170 (serviço) não tem CFOP — isso só existe em C170 (mercadoria).
      const cstPis = (f170[baseIdx170 + 8] ?? f170[9] ?? '').trim();
      const vlBcPis = parseBrFloat(f170[baseIdx170 + 9] ?? f170[10] ?? '');
      const aliqPis = f170[baseIdx170 + 10] ?? f170[11] ?? '';
      const vlPis = parseBrFloat(f170[baseIdx170 + 11] ?? f170[12] ?? '');

      const cstCofins = (f170[baseIdx170 + 12] ?? f170[13] ?? '').trim();
      const vlBcCofins = parseBrFloat(f170[baseIdx170 + 13] ?? f170[14] ?? '');
      const aliqCofins = f170[baseIdx170 + 14] ?? f170[15] ?? '';
      const vlCofins = parseBrFloat(f170[baseIdx170 + 15] ?? f170[16] ?? '');

      // Add PIS item (acumulador for base, imposto for contribution)
      if (vlBcPis > 0.0001) {
        pushItem(
          items,
          {
            kind: 'acumulador',
            registro: 'A170',
            codigo: `PIS-${cstPis || '—'}`,
            descricao: `PIS Base (A170) · ${nomePart}${aliqPis ? ` · Alíq ${aliqPis}` : ''}`,
            imposto: 'PIS/Pasep',
            valor: vlBcPis,
            linha: r.lineNum,
            data: dataDoc,
          },
          periodoFallback,
          f170,
        );
      }
      if (vlPis > 0.0001) {
        pushItem(
          items,
          {
            kind: 'imposto',
            registro: 'A170',
            codigo: `PIS-APUR-${cstPis || '—'}`,
            descricao: `PIS Apurado (A170) · ${nomePart}`,
            imposto: 'PIS/Pasep',
            valor: vlPis,
            linha: r.lineNum,
            data: dataDoc,
          },
          periodoFallback,
          f170,
        );
      }

      // Add COFINS item (acumulador for base, imposto for contribution)
      if (vlBcCofins > 0.0001) {
        pushItem(
          items,
          {
            kind: 'acumulador',
            registro: 'A170',
            codigo: `COFINS-${cstCofins || '—'}`,
            descricao: `COFINS Base (A170) · ${nomePart}${aliqCofins ? ` · Alíq ${aliqCofins}` : ''}`,
            imposto: 'COFINS',
            valor: vlBcCofins,
            linha: r.lineNum,
            data: dataDoc,
          },
          periodoFallback,
          f170,
        );
      }
      if (vlCofins > 0.0001) {
        pushItem(
          items,
          {
            kind: 'imposto',
            registro: 'A170',
            codigo: `COFINS-APUR-${cstCofins || '—'}`,
            descricao: `COFINS Apurado (A170) · ${nomePart}`,
            imposto: 'COFINS',
            valor: vlCofins,
            linha: r.lineNum,
            data: dataDoc,
          },
          periodoFallback,
          f170,
        );
      }
    }
  }

  // If there are no A170 records, fall back to M200/M210/M600/M610 as before
  if (items.length === 0) {
    for (const r of records) {
      const f = r.fields;
      if (r.reg === 'M200' && prio.pis !== 'M200') continue;
      if (r.reg === 'M205' && prio.pis !== 'M205') continue;
      if (r.reg === 'M600' && prio.cofins !== 'M600') continue;
      if (r.reg === 'M605' && prio.cofins !== 'M605') continue;

      if (r.reg === 'M210' || r.reg === 'M610') {
        const codCont = (f[3] ?? f[2] ?? '').trim();
        const imposto = r.reg === 'M210' ? 'PIS/Pasep' : 'COFINS';
        const vlBc = parseBrFloat(f[6] ?? f[5] ?? '');
        const vlCont = parseBrFloat(f[13] ?? f[12] ?? f[9] ?? f[8] ?? '');
        const aliq = f[7] ?? f[8] ?? '';
        pushItem(
          items,
          {
            kind: 'acumulador',
            registro: r.reg,
            codigo: codCont || r.reg,
            descricao: `${REG_LABELS[r.reg]} · COD ${codCont || '—'}${aliq ? ` · Alíq ${aliq}` : ''}`,
            imposto,
            valor: vlBc > 0 ? vlBc : vlCont,
            linha: r.lineNum,
          },
          periodoFallback,
          f,
        );
        if (vlCont > 0 && vlCont !== vlBc) {
          pushItem(
            items,
            {
              kind: 'imposto',
              registro: r.reg,
              codigo: `${codCont}-APUR`,
              descricao: `Contribuição apurada ${imposto} · COD ${codCont || '—'}`,
              imposto,
              valor: vlCont,
              linha: r.lineNum,
            },
            periodoFallback,
            f,
          );
        }
      }

      if (r.reg === 'M200') {
        const vlRec = parseBrFloat(f[13] ?? '');
        const vlNc = parseBrFloat(f[8] ?? '');
        const vlCum = parseBrFloat(f[12] ?? '');
        const total = vlRec > 0 ? vlRec : vlNc + vlCum;
        pushItem(
          items,
          {
            kind: 'imposto',
            registro: 'M200',
            codigo: 'M200-PIS-REC',
            descricao: REG_LABELS.M200 + ' — total a recolher',
            imposto: 'PIS/Pasep',
            valor: total,
            linha: r.lineNum,
          },
          periodoFallback,
          f,
        );
      }

      if (r.reg === 'M600') {
        const vlRec = parseBrFloat(f[13] ?? '');
        const vlNc = parseBrFloat(f[8] ?? '');
        const vlCum = parseBrFloat(f[12] ?? '');
        pushItem(
          items,
          {
            kind: 'imposto',
            registro: 'M600',
            codigo: 'M600-COFINS-REC',
            descricao: REG_LABELS.M600 + ' — total a recolher',
            imposto: 'COFINS',
            valor: vlRec > 0 ? vlRec : vlNc + vlCum,
            linha: r.lineNum,
          },
          periodoFallback,
          f,
        );
      }

      if (r.reg === 'M205' || r.reg === 'M605') {
        const codRec = (f[4] ?? f[3] ?? f[2] ?? '').trim();
        const vl = parseBrFloat(f[5] ?? f[4] ?? '');
        pushItem(
          items,
          {
            kind: 'imposto',
            registro: r.reg,
            codigo: codRec || r.reg,
            descricao: `${REG_LABELS[r.reg]} · receita ${codRec || '—'}`,
            imposto: r.reg === 'M205' ? 'PIS/Pasep' : 'COFINS',
            valor: vl,
            linha: r.lineNum,
          },
          periodoFallback,
          f,
        );
      }
    }
  }

  // Still apply dedupe in case of duplicates
  return dedupeSpedFiscalItens(items);
}

/** Impostos Simples Nacional a partir de C190 (CSOSN) e ajustes E111 — somente tributo. */
function appendSimplesNacionalImpostos(
  items: SpedFiscalItem[],
  records: { reg: string; fields: string[]; lineNum: number }[],
  periodoFallback: string,
): void {
  let totalTributo = 0;
  let linhasSn = 0;

  for (const r of records) {
    if (r.reg !== 'C190') continue;
    const cst = (r.fields[2] ?? '').trim();
    if (!isSimplesNacionalCsosn(cst)) continue;
    const trib = tributoC190SimplesNacional(r.fields);
    if (trib > 0) {
      totalTributo += trib;
      linhasSn += 1;
    }
  }

  for (const r of records) {
    if (r.reg !== 'E111') continue;
    const descr = (r.fields[3] ?? '').trim();
    if (!/simples|\bdas\b|pgdas/i.test(descr)) continue;
    const vl = parseBrFloat(r.fields[4] ?? r.fields[5] ?? '');
    if (vl < 0.01) continue;
    pushItem(
      items,
      {
        kind: 'imposto',
        registro: 'E111',
        codigo: (r.fields[2] ?? '').trim() || 'E111-SN',
        nome: 'Simples Nacional — ajuste',
        descricao: `Ajuste Simples Nacional (E111): ${descr}`,
        imposto: 'Simples Nacional',
        valor: vl,
        linha: r.lineNum,
      },
      periodoFallback,
      r.fields,
    );
  }

  if (linhasSn === 0 || totalTributo < 0.01) return;

  const jaTemSn = items.some(
    (i) => i.kind === 'imposto' && /simples/i.test(i.imposto),
  );
  if (jaTemSn) return;

  pushItem(
    items,
    {
      kind: 'imposto',
      registro: 'C190',
      codigo: 'SN-TRIB',
      nome: 'Simples Nacional — tributos destacados (CSOSN)',
      descricao: `ICMS + ST + IPI no C190 · ${linhasSn} linha(s) CSOSN`,
      imposto: 'Simples Nacional',
      valor: totalTributo,
      linha: 0,
    },
    periodoFallback,
  );
}

function buildCstCfopItemHintIndex(
  records: { reg: string; fields: string[] }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of records) {
    if (r.reg !== 'C170') continue;
    const f = r.fields;
    const cst = (f[10] ?? f[9] ?? '').trim();
    const cfop = (f[11] ?? f[10] ?? '').trim();
    const descr = (f[4] ?? f[3] ?? '').trim();
    if (!cfop || !descr) continue;
    const key = `${cst}-${cfop}`;
    if (!map.has(key)) map.set(key, descr);
  }
  return map;
}

function parseIcms(
  records: { reg: string; fields: string[]; lineNum: number }[],
  periodoFallback: string,
): SpedFiscalItem[] {
  const items: SpedFiscalItem[] = [];
  const hasE116 = records.some((r) => r.reg === 'E116');
  const c190Hints = buildCstCfopItemHintIndex(records);

  for (const r of records) {
    const f = r.fields;
    if (r.reg === 'E110') {
      const debitos = parseBrFloat(f[2] ?? '');
      const creditos = parseBrFloat(f[3] ?? '');
      const sldApurado = parseBrFloat(f[4] ?? f[5] ?? '');
      const sldCredor = parseBrFloat(f[6] ?? '');
      const debEsp = parseBrFloat(f[7] ?? '');
      const credEsp = parseBrFloat(f[8] ?? '');
      pushItem(
        items,
        {
          kind: 'acumulador',
          registro: 'E110',
          codigo: 'E110-DEB',
          nome: 'Total débitos ICMS',
          descricao: 'Total débitos ICMS (E110)',
          imposto: 'ICMS',
          valor: debitos,
          linha: r.lineNum,
        },
        periodoFallback,
        f,
      );
      pushItem(
        items,
        {
          kind: 'acumulador',
          registro: 'E110',
          codigo: 'E110-CRED',
          nome: 'Total créditos ICMS',
          descricao: 'Total créditos ICMS (E110)',
          imposto: 'ICMS',
          valor: creditos,
          linha: r.lineNum,
        },
        periodoFallback,
        f,
      );
      if (!hasE116) {
        pushItem(
          items,
          {
            kind: 'imposto',
            registro: 'E110',
            codigo: 'E110-SLD',
            nome: 'ICMS apurado no período',
            descricao: 'Saldo ICMS apurado (E110)',
            imposto: 'ICMS',
            valor: sldApurado,
            linha: r.lineNum,
          },
          periodoFallback,
          f,
        );
      }
      if (sldCredor > 0) {
        pushItem(
          items,
          {
            kind: 'acumulador',
            registro: 'E110',
            codigo: 'E110-SLD-CRED',
            descricao: 'Saldo credor a transportar (E110)',
            imposto: 'ICMS',
            valor: sldCredor,
            linha: r.lineNum,
          },
          periodoFallback,
          f,
        );
      }
      if (debEsp > 0 || credEsp > 0) {
        pushItem(
          items,
          {
            kind: 'acumulador',
            registro: 'E110',
            codigo: 'E110-ESP',
            descricao: `Déb./créd. especiais ICMS (${debEsp} / ${credEsp})`,
            imposto: 'ICMS',
            valor: debEsp - credEsp,
            linha: r.lineNum,
          },
          periodoFallback,
          f,
        );
      }
    }

    if (r.reg === 'E111') {
      const codAj = (f[2] ?? '').trim();
      const descr = (f[3] ?? '').trim();
      const vl = parseBrFloat(f[4] ?? f[5] ?? '');
      pushItem(
        items,
        {
          kind: 'acumulador',
          registro: 'E111',
          codigo: codAj || 'E111',
          descricao: descr ? `Ajuste ICMS: ${descr}` : REG_LABELS.E111,
          imposto: 'ICMS',
          valor: vl,
          linha: r.lineNum,
        },
        periodoFallback,
        f,
      );
    }

    if (r.reg === 'E116') {
      const codOr = (f[2] ?? '').trim();
      const vl = parseBrFloat(f[3] ?? '');
      const codRec = (f[5] ?? '').trim();
      pushItem(
        items,
        {
          kind: 'imposto',
          registro: 'E116',
          codigo: codOr || 'E116',
          nome: `ICMS a recolher${codRec ? ` · rec. ${codRec}` : ''}`,
          descricao: `${REG_LABELS.E116} · obrigação ${codOr || '—'}`,
          imposto: 'ICMS',
          valor: vl,
          linha: r.lineNum,
        },
        periodoFallback,
        f,
      );
    }

    if (r.reg === 'E250') {
      const sldDevedor = parseBrFloat(f[8] ?? '');
      const sldCredor = parseBrFloat(f[9] ?? '');
      const vl = sldDevedor > 0 ? sldDevedor : sldCredor;
      pushItem(
        items,
        {
          kind: 'imposto',
          registro: 'E250',
          codigo: 'E250-IPI',
          nome: 'IPI apurado no período',
          descricao: REG_LABELS.E250,
          imposto: 'IPI',
          valor: vl,
          linha: r.lineNum,
        },
        periodoFallback,
        f,
      );
    }

    if (r.reg === 'C190') {
      const cst = (f[2] ?? '').trim();
      const cfop = (f[3] ?? '').trim();
      const aliq = (f[4] ?? '').trim();
      const vlOpr = parseBrFloat(f[5] ?? '');
      const vlBc = parseBrFloat(f[6] ?? '');
      const vlIcms = parseBrFloat(f[7] ?? '');
      const vlSt = parseBrFloat(f[9] ?? '');
      const vlIpi = parseBrFloat(f[10] ?? '');
      const valorTributo = vlIcms + vlSt + vlIpi;
      const valorAcum = valorTributo > 0 ? valorTributo : vlOpr > 0 ? vlOpr : vlBc;
      if (valorAcum > 0) {
        const hint = c190Hints.get(`${cst}-${cfop}`);
        const nome = nomeAcumuladorC190(cst, cfop, hint);
        const impostoSn = isSimplesNacionalCsosn(cst) ? 'Simples Nacional' : 'ICMS';
        const tribDetalhe =
          valorTributo > 0
            ? ` · Trib. ICMS ${vlIcms.toLocaleString('pt-BR')}${vlSt > 0 ? ` + ST ${vlSt.toLocaleString('pt-BR')}` : ''}${vlIpi > 0 ? ` + IPI ${vlIpi.toLocaleString('pt-BR')}` : ''}`
            : '';
        pushItem(
          items,
          {
            kind: 'acumulador',
            registro: 'C190',
            codigo: `${cst}-${cfop}`,
            nome,
            descricao: `CST ${cst} · CFOP ${cfop} · Alíq ${aliq || '—'} · ${descricaoCfop(cfop)}${tribDetalhe}`,
            imposto: impostoSn,
            valor: valorAcum,
            linha: r.lineNum,
          },
          periodoFallback,
          f,
        );
      }
    }
  }

  appendSimplesNacionalImpostos(items, records, periodoFallback);
  return supplementIcmsImpostoFromE110(items, records, periodoFallback);
}

function supplementIcmsImpostoFromE110(
  items: SpedFiscalItem[],
  records: { reg: string; fields: string[]; lineNum: number }[],
  periodoFallback: string,
): SpedFiscalItem[] {
  const hasE116Record = records.some((r) => r.reg === 'E116');
  const e116Itens = items.filter((i) => i.kind === 'imposto' && i.registro === 'E116');
  const totalE116 = e116Itens.reduce((s, i) => s + Math.abs(i.valor), 0);
  if (!hasE116Record || totalE116 >= 0.01) {
    return dedupeIcmsSpedItens(items);
  }

  const e110 = records.find((r) => r.reg === 'E110');
  if (!e110) return dedupeIcmsSpedItens(items);
  const sldApurado = parseBrFloat(e110.fields[4] ?? e110.fields[5] ?? '');
  if (sldApurado < 0.01) return dedupeIcmsSpedItens(items);

  pushItem(
    items,
    {
      kind: 'imposto',
      registro: 'E110',
      codigo: 'E110-SLD',
      nome: 'ICMS apurado no período',
      descricao: 'Saldo ICMS apurado (E110) — E116 sem valor informado',
      imposto: 'ICMS',
      valor: sldApurado,
      linha: e110.lineNum,
    },
    periodoFallback,
    e110.fields,
  );
  return dedupeIcmsSpedItens(items);
}

export function parseSpedFiscalText(text: string, fileName: string): ParsedSpedFiscal {
  const records = parseSpedLines(text);
  const issues: string[] = [];
  if (records.length === 0) {
    return {
      tipo: 'DESCONHECIDO',
      fileName,
      cnpj: '',
      empresa: '',
      dtIni: '',
      dtFin: '',
      dtFinLabel: '—',
      itens: [],
      issues: ['Arquivo vazio ou sem registros SPED (pipe |).'],
    };
  }

  const regSet = new Set(records.map((r) => r.reg));
  const rec0000 = records.find((r) => r.reg === '0000')?.fields;
  const tipo = detectTipo(regSet, rec0000);

  let cnpj = rec0000 ? findCnpj(rec0000) : '';
  let empresa = '';
  let dtIni = '';
  let dtFin = '';

  if (rec0000) {
    const dates = rec0000.filter((x) => /^\d{8}$/.test(x));
    if (dates.length >= 2) {
      dtIni = dates[0];
      dtFin = dates[1];
    }
    empresa =
      rec0000.find((x) => x.length > 8 && !/^\d+$/.test(x.replace(/\W/g, '')))?.trim() ?? '';
    if (!cnpj) cnpj = findCnpj(rec0000);
  }

  const dtFinLabel = formatDateBr(dtFin);
  const periodoFallback = formatSpedPeriodoLabel(dtIni, dtFin, dtFinLabel);
  let itens: SpedFiscalItem[] = [];

  if (tipo === 'CONTRIBUICOES') {
    itens = parseContribuicoes(records, periodoFallback);
  } else if (tipo === 'ICMS_IPI') {
    itens = parseIcms(records, periodoFallback);
  } else {
    issues.push('Tipo não identificado. Envie EFD-Contribuições (PIS/COFINS) ou EFD ICMS/IPI.');
  }

  if (itens.length === 0 && tipo !== 'DESCONHECIDO') {
    issues.push(
      'Nenhum acumulador/imposto encontrado nos registros esperados (M200/M210/M600/E110/E116/C190). Verifique se o arquivo é a escrituração transmitida.',
    );
  }

  const notasFiscais = parseSpedNotasFiscaisFromRecords(records);

  return sanitizeParsedSpedFiscal({
    tipo,
    fileName,
    cnpj,
    empresa,
    dtIni,
    dtFin,
    dtFinLabel,
    itens,
    notasFiscais,
    issues,
  });
}

export async function sniffSpedFiscalFile(file: File): Promise<{
  tipo: SpedFiscalTipo;
  dtFin: string;
  fileName: string;
}> {
  const slice = file.slice(0, Math.min(file.size, 120_000));
  const text = await slice.text();
  const parsed = parseSpedFiscalText(text, file.name);
  return { tipo: parsed.tipo, dtFin: parsed.dtFin, fileName: file.name };
}

export function spedFiscalToVisionRows(
  parsed: ParsedSpedFiscal,
  origem: 'CONTRIBUICOES' | 'ICMS_IPI',
): SpedFiscalBalanceteRow[] {
  const dataRef = parsed.dtFinLabel !== '—' ? parsed.dtFinLabel : '';
  const prefix = origem === 'CONTRIBUICOES' ? 'EFD-Contrib' : 'EFD-ICMS';

  return parsed.itens.map((item, idx) => {
    const isDebito = item.natureza === 'devedora';
    const valor = Math.abs(item.valor);
    const rotuloNatureza = item.natureza === 'devedora' ? 'A recuperar' : 'A recolher';
    return {
      codigo: item.codigo,
      classificacao: `${prefix} · ${item.registro} · ${item.imposto}`,
      nome: `[${item.kind === 'acumulador' ? 'Acumulador' : 'Imposto'} · ${rotuloNatureza}] ${item.descricao}`,
      data: item.data || dataRef,
      ordem: item.linha || idx + 1,
      saldoInicial: 0,
      debito: isDebito ? valor : 0,
      credito: isDebito ? 0 : valor,
      saldoFinal: isDebito ? valor : -valor,
      tipo: 'A',
    };
  });
}

export function resumoSpedFiscal(parsed: ParsedSpedFiscal): SpedFiscalResumoArquivo {
  return {
    tipo: parsed.tipo,
    fileName: parsed.fileName,
    savedAt: new Date().toISOString(),
    cnpj: parsed.cnpj,
    empresa: parsed.empresa,
    periodo: formatSpedPeriodoLabel(parsed.dtIni, parsed.dtFin, parsed.dtFinLabel),
    acumuladores: parsed.itens.filter((i) => i.kind === 'acumulador').length,
    impostos: parsed.itens.filter((i) => i.kind === 'imposto').length,
  };
}

export async function pickLatestSpedFiscalPair(files: File[]): Promise<{
  contrib?: File;
  icms?: File;
  contribCount: number;
  icmsCount: number;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const meta = await Promise.all(
    files.map(async (file) => {
      try {
        const sniff = await sniffSpedFiscalFile(file);
        return { file, ...sniff };
      } catch {
        return { file, tipo: 'DESCONHECIDO' as SpedFiscalTipo, dtFin: '', fileName: file.name };
      }
    }),
  );

  const contribs = meta
    .filter((m) => m.tipo === 'CONTRIBUICOES')
    .sort((a, b) => (b.dtFin || '').localeCompare(a.dtFin || ''));
  const icmsList = meta
    .filter((m) => m.tipo === 'ICMS_IPI')
    .sort((a, b) => (b.dtFin || '').localeCompare(a.dtFin || ''));

  const unknown = meta.filter((m) => m.tipo === 'DESCONHECIDO');
  if (unknown.length > 0) {
    warnings.push(
      `${unknown.length} arquivo(s) ignorado(s) — não reconhecidos como EFD-Contribuições nem EFD ICMS/IPI.`,
    );
  }

  return {
    contrib: contribs[0]?.file,
    icms: icmsList[0]?.file,
    contribCount: contribs.length,
    icmsCount: icmsList.length,
    warnings,
  };
}

export async function loadSpedFiscalFromFiles(files: File[]): Promise<{
  rows: SpedFiscalBalanceteRow[];
  contrib?: ParsedSpedFiscal;
  icms?: ParsedSpedFiscal;
  resumos: SpedFiscalResumoArquivo[];
  messages: string[];
}> {
  const { contrib, icms, contribCount, icmsCount, warnings } = await pickLatestSpedFiscalPair(files);
  const messages = [...warnings];
  const resumos: SpedFiscalResumoArquivo[] = [];
  const rows: SpedFiscalBalanceteRow[] = [];
  let contribParsed: ParsedSpedFiscal | undefined;
  let icmsParsed: ParsedSpedFiscal | undefined;

  if (!contrib && !icms) {
    messages.push('Nenhum SPED Contribuições ou ICMS/IPI encontrado na seleção.');
    return { rows, resumos, messages, contrib: contribParsed, icms: icmsParsed };
  }

  if (contrib) {
    const text = await contrib.text();
    contribParsed = parseSpedFiscalText(text, contrib.name);
    if (contribParsed.tipo !== 'CONTRIBUICOES') {
      messages.push(`«${contrib.name}» não foi reconhecido como EFD-Contribuições.`);
    } else {
      rows.push(...spedFiscalToVisionRows(contribParsed, 'CONTRIBUICOES'));
      resumos.push(resumoSpedFiscal(contribParsed));
      messages.push(
        `EFD-Contribuições: ${contrib.name} · período ${resumos[resumos.length - 1].periodo} · ${contribParsed.itens.length} linha(s).`,
      );
    }
  }

  if (icms) {
    const text = await icms.text();
    icmsParsed = parseSpedFiscalText(text, icms.name);
    if (icmsParsed.tipo !== 'ICMS_IPI') {
      messages.push(`«${icms.name}» não foi reconhecido como EFD ICMS/IPI.`);
    } else {
      rows.push(...spedFiscalToVisionRows(icmsParsed, 'ICMS_IPI'));
      resumos.push(resumoSpedFiscal(icmsParsed));
      messages.push(
        `EFD ICMS/IPI: ${icms.name} · período ${resumos[resumos.length - 1].periodo} · ${icmsParsed.itens.length} linha(s).`,
      );
    }
  }

  if (contribCount > 1) {
    messages.push('Vários arquivos de Contribuições: usado o de período final mais recente.');
  }
  if (icmsCount > 1) {
    messages.push('Vários arquivos de ICMS/IPI: usado o de período final mais recente.');
  }

  return { rows, contrib: contribParsed, icms: icmsParsed, resumos, messages };
}
