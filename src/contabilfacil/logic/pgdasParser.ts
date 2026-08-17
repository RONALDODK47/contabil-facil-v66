import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { SpedFiscalItem } from '../../extratoVision/utils/spedFiscalParser';
import { formatDateBr } from '../../extratoVision/utils/spedFiscalParser';
import type { FiscalSpedLinhaRazao } from './fiscalSpedToRazao';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type FiscalPgdasArquivoSalvo = {
  id: string;
  parsed: ParsedPgdas;
};

export type ParsedPgdas = {
  fileName: string;
  cnpj: string;
  empresa: string;
  periodo: string;
  dtIni: string;
  dtFin: string;
  dtFinLabel: string;
  valorDas: number;
  itens: SpedFiscalItem[];
  issues: string[];
};

function parseMoedaBr(val: unknown): number {
  if (typeof val === 'number') return Math.abs(val);
  const s = String(val ?? '').trim();
  if (!s) return 0;
  const clean = s
    .replace(/R\$\s*/gi, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const n = Number.parseFloat(clean);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function lastDayOfMonth(mm: number, yyyy: number): number {
  return new Date(yyyy, mm, 0).getDate();
}

function periodoToDatas(periodo: string): { dtIni: string; dtFin: string; dtFinLabel: string } {
  const m = periodo.match(/(\d{2})\/(\d{4})/);
  if (!m) return { dtIni: '', dtFin: '', dtFinLabel: '—' };
  const mm = m[1]!;
  const yyyy = m[2]!;
  const dd = String(lastDayOfMonth(Number.parseInt(mm, 10), Number.parseInt(yyyy, 10))).padStart(2, '0');
  const dtIni = `01${mm}${yyyy}`;
  const dtFin = `${dd}${mm}${yyyy}`;
  return {
    dtIni,
    dtFin,
    dtFinLabel: `${dd}/${mm}/${yyyy}`,
  };
}

export function isPgdasText(text: string): boolean {
  const sample = text.slice(0, 16_000).toUpperCase();
  if (sample.includes('PGDAS')) return true;
  if (sample.includes('DOCUMENTO DE ARRECADACAO DO SIMPLES') || sample.includes('ARRECADAÇÃO DO SIMPLES')) {
    return true;
  }
  return (
    sample.includes('SIMPLES NACIONAL') &&
    (sample.includes('DAS') || sample.includes('PERIODO DE APURACAO') || sample.includes('PERÍODO DE APURAÇÃO'))
  );
}

function extractCnpj(text: string): string {
  const m = text.match(/\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/);
  return m ? m[1].replace(/\D/g, '') : '';
}

function extractEmpresa(text: string): string {
  const patterns = [
    /Nome\s+Empresarial[:\s]+(.+)/i,
    /Raz[aã]o\s+Social[:\s]+(.+)/i,
    /Nome\s+da\s+empresa[:\s]+(.+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].split(/\r?\n/)[0]?.trim().slice(0, 120) ?? '';
  }
  return '';
}

function extractPeriodo(text: string): string {
  const patterns = [
    /Per[ií]odo\s+de\s+Apura[cç][aã]o[:\s]*(\d{2}\/\d{4})/i,
    /PA[:\s]+(\d{2}\/\d{4})/i,
    /Apura[cç][aã]o[:\s]*(\d{2}\/\d{4})/i,
    /Compet[eê]ncia[:\s]*(\d{2}\/\d{4})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }
  const m2 = text.match(/\b(0[1-9]|1[0-2])\/(20\d{2})\b/);
  return m2 ? `${m2[1]}/${m2[2]}` : '';
}

function extractValorDas(text: string): number {
  const labeled = [
    /Valor\s+Total\s+do\s+Documento\s+de\s+Arrecada[cç][aã]o[:\s]*R?\$?\s*([\d.,]+)/i,
    /Total\s+do\s+DAS[:\s]*R?\$?\s*([\d.,]+)/i,
    /VALOR\s+TOTAL\s+DO\s+DAS[:\s]*R?\$?\s*([\d.,]+)/i,
    /Valor\s+a\s+Pagar[:\s]*R?\$?\s*([\d.,]+)/i,
    /Total\s+Geral[:\s]*R?\$?\s*([\d.,]+)/i,
  ];
  for (const re of labeled) {
    const m = text.match(re);
    if (m?.[1]) {
      const v = parseMoedaBr(m[1]);
      if (v > 0) return v;
    }
  }

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!/total.*das|valor.*total.*documento|valor\s+a\s+pagar/i.test(line)) continue;
    const same = line.match(/([\d]{1,3}(?:\.[\d]{3})*,\d{2})/);
    if (same?.[1]) {
      const v = parseMoedaBr(same[1]);
      if (v > 0) return v;
    }
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const m = (lines[j] ?? '').match(/R?\$?\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})/);
      if (m?.[1]) {
        const v = parseMoedaBr(m[1]);
        if (v > 0) return v;
      }
    }
  }

  return 0;
}

export function parsePgdasText(text: string, fileName: string): ParsedPgdas {
  const issues: string[] = [];
  const normalized = text.replace(/\uFEFF/g, '').replace(/\r/g, '\n');

  if (!isPgdasText(normalized)) {
    return {
      fileName,
      cnpj: '',
      empresa: '',
      periodo: '',
      dtIni: '',
      dtFin: '',
      dtFinLabel: '—',
      valorDas: 0,
      itens: [],
      issues: ['Arquivo não reconhecido como PGDAS-D / DAS do Simples Nacional.'],
    };
  }

  const cnpj = extractCnpj(normalized);
  const empresa = extractEmpresa(normalized);
  const periodo = extractPeriodo(normalized);
  const { dtIni, dtFin, dtFinLabel } = periodoToDatas(periodo);
  const valorDas = extractValorDas(normalized);

  if (!periodo) issues.push('Período de apuração não identificado.');
  if (valorDas < 0.01) issues.push('Valor total do DAS não encontrado no arquivo.');

  const itens: SpedFiscalItem[] = [];

  if (valorDas >= 0.01) {
    itens.push({
      kind: 'imposto',
      natureza: 'credora',
      registro: 'PGDAS',
      codigo: 'DAS-TOTAL',
      nome: 'Simples Nacional — DAS (PGDAS-D)',
      descricao: `Documento de Arrecadação do Simples Nacional · ${periodo || 'período não informado'}`,
      imposto: 'Simples Nacional',
      valor: valorDas,
      linha: 0,
      data: dtFinLabel !== '—' ? dtFinLabel : periodo,
    });
  }

  if (itens.length === 0 && issues.length === 0) {
    issues.push('Nenhum imposto extraído do PGDAS-D.');
  }

  return {
    fileName,
    cnpj,
    empresa,
    periodo,
    dtIni,
    dtFin,
    dtFinLabel,
    valorDas,
    itens,
    issues,
  };
}

export async function extractPdfPlainText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ('str' in it ? String(it.str) : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) parts.push(line);
  }
  return parts.join('\n');
}

export async function parsePgdasFile(file: File): Promise<ParsedPgdas> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  let text = '';

  if (ext === 'pdf') {
    text = await extractPdfPlainText(file);
  } else {
    text = await file.text();
  }

  return parsePgdasText(text, file.name);
}

export async function sniffPgdasFile(file: File): Promise<{
  isPgdas: boolean;
  periodo: string;
  fileName: string;
}> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  let text = '';
  try {
    if (ext === 'pdf') {
      const slice = file.slice(0, Math.min(file.size, 200_000));
      text = await extractPdfPlainText(new File([await slice.arrayBuffer()], file.name, { type: file.type }));
    } else {
      text = await file.slice(0, Math.min(file.size, 120_000)).text();
    }
  } catch {
    return { isPgdas: false, periodo: '', fileName: file.name };
  }
  const parsed = parsePgdasText(text, file.name);
  return {
    isPgdas: parsed.itens.length > 0 || isPgdasText(text),
    periodo: parsed.periodo,
    fileName: file.name,
  };
}

export function pgdasImportSlotKey(parsed: ParsedPgdas): string {
  if (parsed.periodo) {
    const [mm, yyyy] = parsed.periodo.split('/');
    if (mm && yyyy) return `PGDAS|${yyyy}-${mm}`;
  }
  if (parsed.dtFin.length >= 8) {
    return `PGDAS|${parsed.dtFin.slice(4, 8)}-${parsed.dtFin.slice(2, 4)}`;
  }
  return `PGDAS|${parsed.fileName}`;
}

export function formatPgdasPeriodoLabel(parsed: ParsedPgdas): string {
  if (parsed.periodo) return parsed.periodo;
  if (parsed.dtFinLabel && parsed.dtFinLabel !== '—') return parsed.dtFinLabel;
  if (parsed.dtIni && parsed.dtFin) {
    return `${formatDateBr(parsed.dtIni)} — ${formatDateBr(parsed.dtFin)}`;
  }
  return '—';
}

export function linhasRazaoFromArquivosPgdas(arquivos: FiscalPgdasArquivoSalvo[]): FiscalSpedLinhaRazao[] {
  return arquivos.flatMap((arq) =>
    arq.parsed.itens.map((item) => ({
      item,
      data:
        item.data ??
        (arq.parsed.dtFinLabel && arq.parsed.dtFinLabel !== '—'
          ? arq.parsed.dtFinLabel
          : arq.parsed.periodo ?? ''),
      fileName: arq.parsed.fileName,
    })),
  );
}
