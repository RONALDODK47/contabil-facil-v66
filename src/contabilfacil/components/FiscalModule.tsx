/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Módulo Fiscal & SPED Parser Pro (Com suporte a Entradas vs Saídas no modal de Notas Fiscais)
 */

import React, { useState, useMemo, useEffect, useRef, Suspense, lazy } from 'react';
import { InvoiceTable } from './fiscal/InvoiceTable';
import { TaxSummary } from './fiscal/TaxSummary';
import { DailyTaxTable } from './fiscal/DailyTaxTable';
import { TaxDetailTable } from './fiscal/TaxDetailTable';
import { AcumuladorSecaoTable, type AcumuladorLinhaComparada } from './fiscal/AcumuladorSecaoTable';
import { parseSpedFile, sanitizeCfop } from './fiscal/spedParser';
import { SpedInvoice, TaxSummary as TaxSummaryType, DailyTaxSummary } from './fiscal/types';
import { motion, AnimatePresence } from 'motion/react';
import { LayoutDashboard, FileText, Database, Upload, RefreshCw, Scissors, FileCode, CheckCircle2, Calendar, Settings, FileBarChart2, Layers } from 'lucide-react';
import { readManagerData, writeManagerData } from '../logic/companyWorkspace';
import { flushPersistenceAfterCriticalWrite } from '../logic/eyeVisionPersistenceFlush';
import type { OcrColunaCampoDef } from '../logic/ocrColunasConfig';
import type { GenericOcrRow } from '../../lib/parcelamentoColunasExtract';
import { loadFiscalAcumuladorRegras, FiscalAcumuladorRegra } from '../logic/fiscalAcumuladorRegrasStorage';
import { dedupePlanoOptions } from './ExtratoContaPicker';
import {
  parseDominioResumoImpostosFile,
  competenciaToYearMonth,
  type DominioResumoImpostoMes,
} from '../logic/dominioResumoImpostosParser';
import {
  parseAcompanhamentoPdfText,
  acompanhamentoRowsToInvoices,
  type AcompanhamentoKind,
} from '../logic/fiscalAcompanhamentoParser';
import {
  parseResumoAcumuladorPdfText,
  type ResumoAcumuladorParseResult,
} from '../logic/fiscalResumoAcumuladorParser';
import { categorizarInvoiceFiscal, isImpostoInvoice } from '../logic/fiscalInvoiceCategoria';
import { postFiscalNoRazao } from '../logic/fiscalAutomation';

import BalancetePeriodoModal, { type BalancetePeriodo } from './BalancetePeriodoModal';
import { parseAndRenderPDFPage, openPdfDocument, pdfTextItemsToLines } from '../../lib/leitorRecortador/pdfParser';

const LeitorRecortadorModal = lazy(() =>
  import('./LeitorRecortadorModal').then((m) => ({ default: m.LeitorRecortadorModal })),
);

const FiscalAcumuladorRegrasModal = lazy(() =>
  import('./FiscalAcumuladorRegrasModal').then((m) => ({ default: m.default })),
);

interface FiscalModuleProps {
  selectedCompany: string;
}

interface SavedSpedData {
  invoices: SpedInvoice[];
  accounts: Record<string, string>;
  companyName: string;
  fileName?: string;
  periodoInicio?: string;
  periodoFim?: string;
  totalPisMes?: number;
  totalCofinsMes?: number;
  /** Referência oficial "Resumo por Acumulador" (PDF Domínio) — usada só para comparar com os totais calculados pelo sistema. */
  resumoAcumuladorPdf?: ResumoAcumuladorParseResult;
}

/** Todas as colunas fiscais disponíveis para seleção/desativação no leitor e recortador de PDF */
const FISCAL_ALL_CAMPOS: OcrColunaCampoDef[] = [
  { id: 'data', name: 'Data', color: 'bg-cyan-500', borderColor: 'border-cyan-500' },
  { id: 'descricao', name: 'Descrição / Participante', color: 'bg-blue-500', borderColor: 'border-blue-500' },
  { id: 'acumulador', name: 'Acumulador (código)', color: 'bg-violet-500', borderColor: 'border-violet-500' },
  { id: 'cfop', name: 'CFOP', color: 'bg-amber-500', borderColor: 'border-amber-500' },
  { id: 'valor', name: 'Valor Total (R$)', color: 'bg-emerald-600', borderColor: 'border-emerald-600' },
  { id: 'debito', name: 'Valor Débito / A Recolher (R$)', color: 'bg-red-500', borderColor: 'border-red-500' },
  { id: 'credito', name: 'Valor Crédito / A Recuperar (R$)', color: 'bg-green-600', borderColor: 'border-green-600' },
  { id: 'documento', name: 'Nº Documento / NF-e', color: 'bg-indigo-500', borderColor: 'border-indigo-500' },
  { id: 'icms', name: 'ICMS (R$)', color: 'bg-orange-500', borderColor: 'border-orange-500' },
  { id: 'pis', name: 'PIS (R$)', color: 'bg-teal-500', borderColor: 'border-teal-500' },
  { id: 'cofins', name: 'COFINS (R$)', color: 'bg-purple-500', borderColor: 'border-purple-500' },
];

function parseBrazilianNumber(val: string): number {
  if (!val) return 0;
  const clean = val.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

function formatMaskDate(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function normalizeDateStr(input: string): string {
  if (!input) return new Date().toISOString().substring(0, 10);
  const clean = input.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
    const [d, m, y] = clean.split('/');
    return `${y}-${m}-${d}`;
  }
  return clean;
}

export default function FiscalModule({ selectedCompany }: FiscalModuleProps) {
  const [invoices, setInvoices] = useState<SpedInvoice[]>([]);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [companyName, setCompanyName] = useState<string>('');
  const [fileName, setFileName] = useState<string | undefined>();
  const [periodoInicio, setPeriodoInicio] = useState<string | undefined>();
  const [periodoFim, setPeriodoFim] = useState<string | undefined>();
  const [totalPisMes, setTotalPisMes] = useState<number | undefined>();
  const [totalCofinsMes, setTotalCofinsMes] = useState<number | undefined>();
  const [activeTab, setActiveTab] = useState<'notas' | 'impostos' | 'acumuladores'>('notas');
  /** 'todos' = soma todos os meses já importados; senão filtra por um mês específico (yyyy-mm). */
  const [periodoImpostosFiltro, setPeriodoImpostosFiltro] = useState<string>('todos');

  // Dates below/segmented in crop buttons
  const [dataLancamentosPdf, setDataLancamentosPdf] = useState('');
  const [dataImpostosPdf, setDataImpostosPdf] = useState('');
  const [tipoImpostoSelecionado, setTipoImpostoSelecionado] = useState<'icms' | 'simples_nacional'>('icms');

  // Rules Modal States
  const [regrasNotasOpen, setRegrasNotasOpen] = useState(false);
  const [regrasImpostosOpen, setRegrasImpostosOpen] = useState(false);
  const [fiscalRegras, setFiscalRegras] = useState<FiscalAcumuladorRegra[]>([]);

  // PDF Crop Modal States
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const [pdfCropTarget, setPdfCropTarget] = useState<'lancamentos' | 'impostos' | null>(null);

  // Importação diferencial do "Resumo dos Impostos" (Domínio)
  const [resumoImpostosLoading, setResumoImpostosLoading] = useState(false);
  const [resumoImpostosMsg, setResumoImpostosMsg] = useState<string>('');
  const [pendingResumoConflito, setPendingResumoConflito] = useState<{
    faltando: DominioResumoImpostoMes[];
    conflitantes: DominioResumoImpostoMes[];
  } | null>(null);

  /** Importação de TXT SPED (só Impostos): pergunta sobrescrever/ignorar quando já existe
   * lançamento com a MESMA descrição no mesmo mês — o resto do arquivo (descrições novas)
   * entra normalmente, sem precisar de confirmação. */
  const [pendingSpedImpostosConflito, setPendingSpedImpostosConflito] = useState<{
    fileName: string;
    parsed: ReturnType<typeof parseSpedFile>;
    novosInvoices: SpedInvoice[];
    descricoesConflitantes: string[];
  } | null>(null);

  /** Select "Importar PDF Sistema Domínio / SPED" (ao lado de Recortar PDF Notas Fiscais). */
  const [tipoImportDominio, setTipoImportDominio] = useState<
    | AcompanhamentoKind
    | 'pgdas'
    | 'impostos_fiscais'
    | 'sped_notas'
    | 'sped_impostos'
    | 'sped_tudo'
    | 'resumo_acumulador'
  >('entrada');
  const [acompanhamentoLoading, setAcompanhamentoLoading] = useState(false);
  const [acompanhamentoMsg, setAcompanhamentoMsg] = useState<string>('');

  /** Select "Limpar" (Entradas/Saídas/Serviços/Impostos/Tudo) — todos ou por período. */
  const [limparCategoria, setLimparCategoria] = useState<
    'entradas' | 'saidas' | 'servicos' | 'impostos' | 'tudo'
  >('entradas');
  const [limparEscopo, setLimparEscopo] = useState<'todos' | 'periodo'>('todos');
  const [limparDataInicio, setLimparDataInicio] = useState('');
  const [limparDataFim, setLimparDataFim] = useState('');

  const txtInputRef = useRef<HTMLInputElement>(null);
  const pdfLancamentosInputRef = useRef<HTMLInputElement>(null);
  const pdfImpostosInputRef = useRef<HTMLInputElement>(null);
  const resumoImpostosInputRef = useRef<HTMLInputElement>(null);
  const acompanhamentoInputRef = useRef<HTMLInputElement>(null);
  const resumoAcumuladorInputRef = useRef<HTMLInputElement>(null);

  /** Referência oficial "Resumo por Acumulador" (PDF Domínio) — só para conferência na aba Acumuladores. */
  const [resumoAcumuladorPdf, setResumoAcumuladorPdf] = useState<ResumoAcumuladorParseResult | null>(null);
  const [periodoModalFiscalOpen, setPeriodoModalFiscalOpen] = useState(false);

  // Load saved company SPED data & rules from workspace storage
  useEffect(() => {
    if (!selectedCompany) return;
    const savedList = readManagerData<SavedSpedData>(selectedCompany, 'spedParserProData');
    const saved = savedList[0];
    if (saved && Array.isArray(saved.invoices)) {
      setInvoices(saved.invoices);
      setAccounts(saved.accounts || {});
      setCompanyName(saved.companyName || '');
      setFileName(saved.fileName);
      setPeriodoInicio(saved.periodoInicio);
      setPeriodoFim(saved.periodoFim);
      setTotalPisMes(saved.totalPisMes);
      setTotalCofinsMes(saved.totalCofinsMes);
      setResumoAcumuladorPdf(saved.resumoAcumuladorPdf ?? null);
    } else {
      setInvoices([]);
      setAccounts({});
      setCompanyName('');
      setFileName(undefined);
      setPeriodoInicio(undefined);
      setPeriodoFim(undefined);
      setTotalPisMes(undefined);
      setTotalCofinsMes(undefined);
      setResumoAcumuladorPdf(null);
    }
    setFiscalRegras(loadFiscalAcumuladorRegras(selectedCompany));
  }, [selectedCompany]);

  /** Aplica o resultado final do TXT SPED (Notas/Impostos/Tudo) — grava estado + storage. */
  const applySpedTxtImport = (
    modo: 'notas' | 'impostos' | 'tudo',
    updated: SpedInvoice[],
    parsed: ReturnType<typeof parseSpedFile>,
    fileName: string,
  ) => {
    setInvoices(updated);
    setAccounts((prev) => ({ ...prev, ...parsed.accounts }));
    if (parsed.companyName) setCompanyName(parsed.companyName);
    setFileName(fileName);
    if (parsed.periodoInicio) setPeriodoInicio(parsed.periodoInicio);
    if (parsed.periodoFim) setPeriodoFim(parsed.periodoFim);
    if (modo !== 'notas') {
      if (parsed.totalPisMes != null) setTotalPisMes(parsed.totalPisMes);
      if (parsed.totalCofinsMes != null) setTotalCofinsMes(parsed.totalCofinsMes);
    }

    // Quando o usuário importa "só Impostos", leva para a aba Impostos automaticamente
    // para que ele veja o resultado imediatamente (as entradas sintéticas não aparecem
    // na aba Notas Fiscais, então sem esse redirecionamento pareceria que nada foi importado).
    if (modo === 'impostos') {
      setActiveTab('impostos');
    }

    if (selectedCompany) {
      writeManagerData(selectedCompany, 'spedParserProData', [
        {
          invoices: updated,
          accounts: { ...accounts, ...parsed.accounts },
          companyName: parsed.companyName || companyName,
          fileName,
          periodoInicio: parsed.periodoInicio,
          periodoFim: parsed.periodoFim,
          totalPisMes: modo !== 'notas' ? parsed.totalPisMes : totalPisMes,
          totalCofinsMes: modo !== 'notas' ? parsed.totalCofinsMes : totalCofinsMes,
          resumoAcumuladorPdf: resumoAcumuladorPdf ?? undefined,
        },
      ]);
      void flushPersistenceAfterCriticalWrite();
    }
  };

  /** Resolve o conflito do import TXT SPED (só Impostos): ignora (mantém o que já está lançado
   * para as descrições que colidem) ou sobrescreve só essas descrições com o TXT. Descrições
   * novas do TXT (sem conflito) sempre entram, nos dois casos. */
  const handleResolverConflitoSpedImpostos = (modo: 'ignorar' | 'sobrescrever') => {
    if (!pendingSpedImpostosConflito) return;
    const { fileName, parsed, novosInvoices, descricoesConflitantes } = pendingSpedImpostosConflito;
    const conflitantesSet = new Set(descricoesConflitantes);

    const chaveOf = (inv: SpedInvoice) => `${inv.source}|${(inv.date || '').slice(0, 7)}|${inv.description}`;

    const invoicesFinal =
      modo === 'sobrescrever'
        ? [...invoices.filter((inv) => !conflitantesSet.has(chaveOf(inv))), ...novosInvoices]
        : [
            ...invoices,
            ...novosInvoices.filter((inv) => !conflitantesSet.has(chaveOf(inv))),
          ];

    applySpedTxtImport('impostos', invoicesFinal, parsed, fileName);
    setPendingSpedImpostosConflito(null);
  };

  const handleTxtFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Captura o modo escolhido no select no momento do clique — 'sped_tudo' (Notas + Impostos
    // juntos, como sempre foi) é o padrão para qualquer outro valor do select (ex.: se o
    // usuário chamar este input por engano com outra opção selecionada).
    const modo: 'notas' | 'impostos' | 'tudo' =
      tipoImportDominio === 'sped_notas' ? 'notas' : tipoImportDominio === 'sped_impostos' ? 'impostos' : 'tudo';
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      const parsed = parseSpedFile(content);

      let novosInvoices = parsed.invoices;
      if (modo === 'notas') {
        // Só Notas Fiscais: zera os campos de tributo para este import não influenciar a aba Impostos.
        novosInvoices = novosInvoices.map((inv) => ({
          ...inv,
          pis: 0,
          cofins: 0,
          icms: 0,
          iss: 0,
          csll: 0,
          irpj: 0,
          simplesNacional: 0,
        }));
      } else if (modo === 'impostos') {
        // Só Impostos: marca como apuração sintética para não aparecer na tabela de Notas Fiscais.
        novosInvoices = novosInvoices.map((inv) => ({ ...inv, isApuracaoResumo: true }));
      }

      let updated: SpedInvoice[];
      if (modo === 'tudo') {
        // Sobrescreve lançamentos do mesmo tipo (entrada/saída) + source + mês.
        // A chave inclui `type` para que importar apenas saídas não apague as entradas
        // já importadas do mesmo mês (e vice-versa).
        // Lançamentos sintéticos de apuração (isApuracaoResumo — vindos do PDF de Impostos
        // ou do Resumo Domínio) nunca são removidos pelo TXT SPED: têm fonte diferente.
        const chavesNovas = new Set(
          novosInvoices.map((inv) => `${inv.source}|${inv.type}|${(inv.date || '').slice(0, 7)}`),
        );
        const invoicesAntigosFiltrados = invoices.filter(
          (inv) =>
            inv.isApuracaoResumo ||
            !chavesNovas.has(`${inv.source}|${inv.type}|${(inv.date || '').slice(0, 7)}`),
        );
        updated = [...invoicesAntigosFiltrados, ...novosInvoices];
      } else if (modo === 'notas') {
        // Só Notas: mesma lógica, sem apagar impostos (isApuracaoResumo) nem o outro type.
        const chavesNovas = new Set(
          novosInvoices.map((inv) => `${inv.source}|${inv.type}|${(inv.date || '').slice(0, 7)}`),
        );
        const invoicesAntigosFiltrados = invoices.filter(
          (inv) =>
            inv.isApuracaoResumo ||
            !chavesNovas.has(`${inv.source}|${inv.type}|${(inv.date || '').slice(0, 7)}`),
        );
        updated = [...invoicesAntigosFiltrados, ...novosInvoices];
      } else {
        // modo === 'impostos': se alguma descrição nova colide com uma já lançada no mesmo
        // mês, pergunta ao usuário (sobrescrever essa descrição ou manter a já lançada) —
        // descrições sem conflito entram direto, sem precisar de confirmação.
        const chaveOf = (inv: SpedInvoice) => `${inv.source}|${(inv.date || '').slice(0, 7)}|${inv.description}`;
        const chavesExistentes = new Set(invoices.map(chaveOf));
        const descricoesConflitantes = [
          ...new Set(
            novosInvoices.filter((inv) => chavesExistentes.has(chaveOf(inv))).map((inv) => inv.description),
          ),
        ];

        if (descricoesConflitantes.length > 0) {
          setPendingSpedImpostosConflito({
            fileName: file.name,
            parsed,
            novosInvoices,
            descricoesConflitantes,
          });
          return;
        }

        updated = [...invoices, ...novosInvoices];
      }

      applySpedTxtImport(modo, updated, parsed, file.name);
    };
    reader.readAsText(file, 'ISO-8859-1');
    e.target.value = '';
  };

  const handlePdfLancamentosFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingPdfFile(file);
    setPdfCropTarget('lancamentos');
    e.target.value = '';
  };

  const handlePdfImpostosFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingPdfFile(file);
    setPdfCropTarget('impostos');
    e.target.value = '';
  };

  const handleConfirmLancamentosPdf = (rows: GenericOcrRow[]) => {
    const overrideDate = dataLancamentosPdf.trim() ? normalizeDateStr(dataLancamentosPdf) : '';

    const newInvoices: SpedInvoice[] = rows.map((r) => {
      const rawValStr = r.valor || r.debito || r.credito || r.valorDc || '0';
      const val = parseBrazilianNumber(rawValStr);
      const credVal = r.credito ? parseBrazilianNumber(r.credito) : 0;
      const isEntrada = val < 0 || credVal > 0;
      const dateVal = overrideDate || normalizeDateStr(r.data || '');
      const descVal = r.descricao || 'Recorte PDF Lançamento';
      const cfopVal = sanitizeCfop(r.cfop || r['cfop'] || '');
      const accVal = r.acumulador || '';
      const docVal = r.documento || (cfopVal ? `CFOP ${cfopVal}` : 'PDF');

      const pisVal = r.pis ? parseBrazilianNumber(r.pis) : 0;
      const cofinsVal = r.cofins ? parseBrazilianNumber(r.cofins) : 0;
      const icmsVal = r.icms ? parseBrazilianNumber(r.icms) : 0;

      return {
        id: Math.random().toString(36).substring(2, 11),
        type: isEntrada ? 'entrada' : 'saida',
        date: dateVal,
        description: descVal,
        value: val,
        cfop: cfopVal,
        documentNumber: docVal,
        participantName: descVal,
        accountCode: accVal,
        pis: pisVal,
        cofins: cofinsVal,
        icms: icmsVal,
        source: 'ICMS',
      };
    });

    // Sobrescreve em vez de duplicar: se este recorte já traz lançamentos para
    // um mês+apuração que já estava importado, descarta os antigos daquele
    // mês+apuração antes de somar os novos.
    const mesesNovosNF = new Set(
      newInvoices.map((inv) => `${inv.source}|${(inv.date || '').slice(0, 7)}`),
    );
    const invoicesAntigosFiltradosNF = invoices.filter(
      (inv) => !mesesNovosNF.has(`${inv.source}|${(inv.date || '').slice(0, 7)}`),
    );
    const updated = [...invoicesAntigosFiltradosNF, ...newInvoices];
    setInvoices(updated);
    if (selectedCompany) {
      writeManagerData(selectedCompany, 'spedParserProData', [
        {
          invoices: updated,
          accounts,
          companyName,
          fileName: pendingPdfFile?.name || fileName,
          periodoInicio,
          periodoFim,
          totalPisMes,
          totalCofinsMes,
          resumoAcumuladorPdf: resumoAcumuladorPdf ?? undefined,
        },
      ]);
      void flushPersistenceAfterCriticalWrite();
    }
    setPendingPdfFile(null);
    setPdfCropTarget(null);
  };

  const handleConfirmImpostosPdf = (rows: GenericOcrRow[]) => {
    const overrideDate = dataImpostosPdf.trim() ? normalizeDateStr(dataImpostosPdf) : '';

    const newInvoices: SpedInvoice[] = rows.map((r) => {
      const rawValStr = r.valor || r.debito || r.credito || r.valorDc || '0';
      const val = parseBrazilianNumber(rawValStr);
      const dateVal = overrideDate || normalizeDateStr(r.data || '');
      const descVal = r.descricao || 'Recorte PDF Imposto';
      const descUpper = descVal.toUpperCase();

      let pis = r.pis ? parseBrazilianNumber(r.pis) : 0;
      let cofins = r.cofins ? parseBrazilianNumber(r.cofins) : 0;
      let icms = r.icms ? parseBrazilianNumber(r.icms) : 0;

      if (!pis && descUpper.includes('PIS')) pis = Math.abs(val);
      if (!cofins && descUpper.includes('COFINS')) cofins = Math.abs(val);
      if (!icms && descUpper.includes('ICMS')) icms = Math.abs(val);

      return {
        id: Math.random().toString(36).substring(2, 11),
        type: descUpper.includes('RECUPERAR') || descUpper.includes('ENTRADA') || r.credito ? 'entrada' : 'saida',
        date: dateVal,
        description: descVal,
        value: val,
        cfop: sanitizeCfop(r.cfop || r['cfop'] || ''),
        documentNumber: r.documento || 'IMPOSTO-PDF',
        participantName: 'Apuração Impostos PDF',
        pis,
        cofins,
        icms,
        source: 'ICMS',
      };
    });

    // Sobrescreve impostos com a mesma descrição para que reimportar não duplique.
    const chavesNovas = new Set(
      newInvoices.map(
        (inv) => `${inv.source}|${(inv.date || '').slice(0, 7)}|${inv.description}`,
      ),
    );
    const invoicesAntigosFiltrados = invoices.filter(
      (inv) =>
        !chavesNovas.has(`${inv.source}|${(inv.date || '').slice(0, 7)}|${inv.description}`),
    );
    const updated = [...invoicesAntigosFiltrados, ...newInvoices];
    setInvoices(updated);
    if (selectedCompany) {
      writeManagerData(selectedCompany, 'spedParserProData', [
        {
          invoices: updated,
          accounts,
          companyName,
          fileName: pendingPdfFile?.name || fileName,
          periodoInicio,
          periodoFim,
          totalPisMes,
          totalCofinsMes,
          resumoAcumuladorPdf: resumoAcumuladorPdf ?? undefined,
        },
      ]);
      void flushPersistenceAfterCriticalWrite();
    }
    setPendingPdfFile(null);
    setPdfCropTarget(null);
  };

  /** Campo do invoice correspondente a cada tributo — IBS/CBS/DIFAL não têm campo dedicado ainda. */
  const campoDoImposto = (imposto: string): 'pis' | 'cofins' | 'iss' | 'csll' | 'irpj' | null => {
    switch (imposto) {
      case 'PIS': return 'pis';
      case 'COFINS': return 'cofins';
      case 'ISS': return 'iss';
      case 'CSLL': return 'csll';
      case 'IRPJ': return 'irpj';
      default: return null;
    }
  };

  const buildResumoImpostoInvoice = (item: DominioResumoImpostoMes): SpedInvoice => {
    const mes = competenciaToYearMonth(item.competencia);
    const date = mes ? `${mes}-01` : '';
    const nomeImposto = item.imposto === 'DIFAL' ? 'Diferencial de Alíquota' : item.imposto;
    return {
      id: Math.random().toString(36).substring(2, 11),
      type: 'saida',
      date,
      description: `${nomeImposto} · Apuração ${item.competencia} (Domínio)`,
      value: item.valor,
      documentNumber: `RESUMO-${item.imposto}-${item.competencia.replace('/', '-')}`,
      participantName: 'Resumo de Impostos — Domínio',
      pis: item.imposto === 'PIS' ? item.valor : 0,
      cofins: item.imposto === 'COFINS' ? item.valor : 0,
      icms: 0,
      iss: item.imposto === 'ISS' ? item.valor : undefined,
      csll: item.imposto === 'CSLL' ? item.valor : undefined,
      irpj: item.imposto === 'IRPJ' ? item.valor : undefined,
      source: 'CONTRIBUICOES',
    };
  };

  const persistInvoices = (updated: SpedInvoice[], resumoAcumulador = resumoAcumuladorPdf) => {
    setInvoices(updated);
    if (selectedCompany) {
      writeManagerData(selectedCompany, 'spedParserProData', [
        {
          invoices: updated,
          accounts,
          companyName,
          fileName,
          periodoInicio,
          periodoFim,
          totalPisMes,
          totalCofinsMes,
          resumoAcumuladorPdf: resumoAcumulador ?? undefined,
        },
      ]);
      void flushPersistenceAfterCriticalWrite();
    }
  };

  /** Abre o seletor de arquivo certo para a opção escolhida no select "Importar PDF Sistema Domínio / SPED". */
  const handleImportarDominioSelecionado = () => {
    if (tipoImportDominio === 'pgdas') {
      setTipoImpostoSelecionado('simples_nacional');
      pdfImpostosInputRef.current?.click();
      return;
    }
    if (tipoImportDominio === 'impostos_fiscais') {
      resumoImpostosInputRef.current?.click();
      return;
    }
    if (
      tipoImportDominio === 'sped_notas' ||
      tipoImportDominio === 'sped_impostos' ||
      tipoImportDominio === 'sped_tudo'
    ) {
      txtInputRef.current?.click();
      return;
    }
    if (tipoImportDominio === 'resumo_acumulador') {
      resumoAcumuladorInputRef.current?.click();
      return;
    }
    acompanhamentoInputRef.current?.click();
  };

  /**
   * Importa os relatórios "Acompanhamento de Entradas/Saídas/Serviços" do Sistema Domínio
   * (Contábil → Plano de Contas). São PDFs com texto nativo — extrai o texto de todas as
   * páginas e faz o parse estruturado (sem recorte manual).
   */
  const handleAcompanhamentoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const kind = tipoImportDominio as AcompanhamentoKind;

    setAcompanhamentoLoading(true);
    setAcompanhamentoMsg('');
    try {
      const pdfDoc = await openPdfDocument(file);
      let extractedText = '';
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await parseAndRenderPDFPage(file, pageNum, pdfDoc);
        // Os textItems do pdf.js não têm quebra de linha própria — reconstrói as linhas da
        // tabela agrupando por posição Y, senão a página inteira vira uma string só e o
        // parser (linha por linha) não reconhece nenhum lançamento.
        extractedText += `\n${pdfTextItemsToLines(page.textItems).join('\n')}`;
      }

      const parsed = parseAcompanhamentoPdfText(extractedText, kind);
      if (parsed.rows.length === 0) {
        setAcompanhamentoMsg(`❌ ${parsed.errors[0] ?? 'Nenhum lançamento reconhecido no PDF.'}`);
        return;
      }

      const newInvoices = acompanhamentoRowsToInvoices(parsed);
      // Só soma (não há um campo próprio no SpedInvoice para marcar "veio deste PDF" e
      // permitir descartar com segurança uma importação anterior sem arriscar apagar
      // lançamentos de outra origem no mesmo mês — ex.: TXT SPED). Reimportar o mesmo PDF
      // duas vezes duplica; use "Limpar" antes de reimportar se precisar substituir.
      persistInvoices([...invoices, ...newInvoices]);
      const label = kind === 'entrada' ? 'entrada(s)' : kind === 'saida' ? 'saída(s)' : 'serviço(s)';
      setAcompanhamentoMsg(`✅ ${newInvoices.length} nota(s) de ${label} importada(s).`);
    } catch (err) {
      setAcompanhamentoMsg(`❌ Erro ao ler o PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAcompanhamentoLoading(false);
    }
  };

  /**
   * Importa o "Resumo por Acumulador" do Sistema Domínio (Contábil → Plano de Contas →
   * "Empresa NNN - Nome.pdf") — referência oficial de totais por acumulador, usada só para
   * comparação na aba Acumuladores (não vira lançamento nem entra na tabela de Notas Fiscais).
   */
  const handleResumoAcumuladorFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setAcompanhamentoLoading(true);
    setAcompanhamentoMsg('');
    try {
      const pdfDoc = await openPdfDocument(file);
      let extractedText = '';
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await parseAndRenderPDFPage(file, pageNum, pdfDoc);
        extractedText += `\n${pdfTextItemsToLines(page.textItems).join('\n')}`;
      }

      const parsed = parseResumoAcumuladorPdfText(extractedText);
      if (parsed.linhas.length === 0) {
        setAcompanhamentoMsg(`❌ ${parsed.errors[0] ?? 'Nenhum acumulador reconhecido no PDF.'}`);
        return;
      }

      setResumoAcumuladorPdf(parsed);
      persistInvoices(invoices, parsed);
      setAcompanhamentoMsg(`✅ Resumo por Acumulador importado: ${parsed.linhas.length} acumulador(es).`);
    } catch (err) {
      setAcompanhamentoMsg(`❌ Erro ao ler o PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAcompanhamentoLoading(false);
    }
  };

  /**
   * Importação diferencial do "Resumo dos Impostos" do Domínio: lê o PDF (que traz PIS,
   * COFINS, ISS, CSLL, IRPJ, IBS, CBS e Diferencial de Alíquota mês a mês). O que ainda
   * não está lançado entra direto; para o que já existe (ex.: PIS/COFINS vindo do TXT
   * SPED), pergunta se é pra ignorar (manter o que já tem) ou sobrescrever com o PDF.
   */
  const handleResumoImpostosFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setResumoImpostosLoading(true);
    setResumoImpostosMsg('');
    setPendingResumoConflito(null);
    try {
      const parsed = await parseDominioResumoImpostosFile(file);
      if (parsed.issues.length > 0 && parsed.itens.length === 0) {
        setResumoImpostosMsg(`❌ ${parsed.issues[0]}`);
        return;
      }

      // Soma o que já existe por tributo+mês (yyyy-mm) — PIS/COFINS/ISS/CSLL/IRPJ já têm
      // campo próprio no invoice; se a soma já for > 0, aquele mês já está lançado.
      const jaLancado = new Map<string, number>();
      const somaMes = (inv: SpedInvoice, campo: number | undefined, imposto: string) => {
        if (!campo) return;
        const mes = (inv.date || '').slice(0, 7); // yyyy-mm
        if (mes.length !== 7) return;
        const key = `${imposto}|${mes}`;
        jaLancado.set(key, (jaLancado.get(key) ?? 0) + campo);
      };
      for (const inv of invoices) {
        somaMes(inv, inv.pis, 'PIS');
        somaMes(inv, inv.cofins, 'COFINS');
        somaMes(inv, inv.iss, 'ISS');
        somaMes(inv, inv.csll, 'CSLL');
        somaMes(inv, inv.irpj, 'IRPJ');
      }

      const faltando: DominioResumoImpostoMes[] = [];
      const conflitantes: DominioResumoImpostoMes[] = [];
      for (const item of parsed.itens) {
        const mes = competenciaToYearMonth(item.competencia);
        const existente = jaLancado.get(`${item.imposto}|${mes}`) ?? 0;
        (existente < 0.01 ? faltando : conflitantes).push(item);
      }

      if (faltando.length === 0 && conflitantes.length === 0) {
        setResumoImpostosMsg('❌ Nenhum imposto reconhecido neste PDF.');
        return;
      }

      if (conflitantes.length === 0) {
        persistInvoices([...invoices, ...faltando.map(buildResumoImpostoInvoice)]);
        const porTributo = new Map<string, number>();
        for (const item of faltando) porTributo.set(item.imposto, (porTributo.get(item.imposto) ?? 0) + 1);
        const resumo = [...porTributo.entries()].map(([t, n]) => `${t} (${n})`).join(', ');
        setResumoImpostosMsg(`✅ Importado(s): ${resumo}.`);
        return;
      }

      // Há conflito: pergunta ao usuário o que fazer com o que já está lançado.
      setPendingResumoConflito({ faltando, conflitantes });
      const porTributo = new Map<string, number>();
      for (const item of conflitantes) porTributo.set(item.imposto, (porTributo.get(item.imposto) ?? 0) + 1);
      const resumo = [...porTributo.entries()].map(([t, n]) => `${t} (${n})`).join(', ');
      setResumoImpostosMsg(`⚠️ Já lançado(s): ${resumo}. Escolha ignorar ou sobrescrever abaixo.`);
    } catch (err) {
      setResumoImpostosMsg(`❌ Erro ao ler o PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setResumoImpostosLoading(false);
    }
  };

  /** Resolve o conflito do import do Resumo de Impostos: ignora (mantém o que já tem) ou sobrescreve com o PDF. */
  const handleResolverConflitoResumoImpostos = (modo: 'ignorar' | 'sobrescrever') => {
    if (!pendingResumoConflito) return;
    const { faltando, conflitantes } = pendingResumoConflito;
    const novosFaltando = faltando.map(buildResumoImpostoInvoice);

    let base = invoices;
    let novosConflitantes: SpedInvoice[] = [];
    if (modo === 'sobrescrever') {
      // Zera o campo do tributo nos lançamentos existentes daquele mês (preserva o resto
      // da linha) e adiciona um lançamento novo com o valor do PDF.
      base = invoices.map((inv) => {
        let novo = inv;
        for (const c of conflitantes) {
          const campo = campoDoImposto(c.imposto);
          if (!campo) continue;
          const mes = competenciaToYearMonth(c.competencia);
          if ((inv.date || '').slice(0, 7) === mes && inv[campo]) {
            novo = { ...novo, [campo]: 0 };
          }
        }
        return novo;
      });
      novosConflitantes = conflitantes.map(buildResumoImpostoInvoice);
    }

    persistInvoices([...base, ...novosFaltando, ...novosConflitantes]);
    setPendingResumoConflito(null);

    const tributos = [...new Set(conflitantes.map((c) => c.imposto))].join(', ');
    const extra = novosFaltando.length > 0 ? ` Também importado(s) ${novosFaltando.length} tributo(s) novo(s).` : '';
    setResumoImpostosMsg(
      modo === 'ignorar'
        ? `✅ Mantidos os valores já lançados para: ${tributos}.${extra}`
        : `✅ Sobrescrito com os valores do PDF para: ${tributos}.${extra}`,
    );
  };

  const LIMPAR_CATEGORIA_LABEL: Record<typeof limparCategoria, string> = {
    entradas: 'Entradas',
    saidas: 'Saídas',
    servicos: 'Serviços',
    impostos: 'Impostos',
    tudo: 'todos os lançamentos',
  };

  /**
   * "Mandar para o Balancete": aplica as regras cadastradas (débito+crédito) em cada nota e
   * apuração fiscal já importada e lança no razão. Uma regra específica (fornecedor/histórico/
   * tipo de imposto) sempre vence a regra genérica "puxar por CFOP" — ver resolverRegraFiscalParaInvoice.
   */
  const handleMandarFiscalParaBalancete = () => {
    if (invoices.length === 0) {
      window.alert('Nenhuma nota fiscal ou apuração importada para enviar ao balancete.');
      return;
    }
    setPeriodoModalFiscalOpen(true);
  };

  const handlePeriodoFiscalConfirmado = (periodo: BalancetePeriodo) => {
    setPeriodoModalFiscalOpen(false);
    try {
      const { gerados, pendencias } = postFiscalNoRazao(selectedCompany);
      void flushPersistenceAfterCriticalWrite();
      if (gerados <= 0) {
        window.alert(
          pendencias.length
            ? `Nada enviado — falta cadastrar regra (débito+crédito):\n\n${pendencias.join('\n')}`
            : 'Nada novo para enviar — cadastre regras (débito+crédito) em Regras Notas Fiscais / Regras Impostos.',
        );
        return;
      }
      const periodoStr = `${periodo.dataInicio.split('-').reverse().join('/')} até ${periodo.dataFim.split('-').reverse().join('/')}`;
      window.alert(
        `${gerados} lançamento(s) fiscal(is) enviados ao balancete.` +
          `\nPeríodo: ${periodoStr}` +
          (pendencias.length ? `\n\nPendências (sem regra):\n${pendencias.join('\n')}` : '') +
          '\n\nAbra a aba Balancete para conferir.',
      );
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Falha ao enviar para o balancete.');
    }
  };

  /** Retorna true se o invoice está dentro do período selecionado no Limpar. */
  const matchesPeriodo = (inv: SpedInvoice): boolean => {
    if (limparEscopo !== 'periodo') return true;
    if (limparDataInicio && (inv.date || '') < limparDataInicio) return false;
    if (limparDataFim && (inv.date || '') > limparDataFim) return false;
    return true;
  };

  /** Exclui só os lançamentos da categoria (e, opcionalmente, do período) escolhidos no select "Limpar". */
  const handleLimparSelecionado = () => {
    const matches = (inv: SpedInvoice) => {
      const categoriaOk = limparCategoria === 'tudo' || categorizarInvoiceFiscal(inv) === limparCategoria;
      if (!categoriaOk) return false;
      return matchesPeriodo(inv);
    };

    // Para "Impostos": além de deletar entradas sintéticas (isApuracaoResumo), também zera
    // os campos de tributo (pis/cofins/icms/iss/csll/irpj/simplesNacional) das notas fiscais
    // regulares dentro do período, pois elas também alimentam a aba Impostos.
    if (limparCategoria === 'impostos') {
      const regularComImposto = invoices.filter(
        (inv) => !isImpostoInvoice(inv) && matchesPeriodo(inv) &&
          ((inv.pis || 0) + (inv.cofins || 0) + (inv.icms || 0) +
           (inv.iss || 0) + (inv.csll || 0) + (inv.irpj || 0) +
           (inv.simplesNacional || 0)) > 0,
      );

      const alvoSinteticos = invoices.filter(matches);
      const totalAlvo = alvoSinteticos.length + regularComImposto.length;

      if (totalAlvo === 0) {
        setAcompanhamentoMsg('Nenhum lançamento de impostos encontrado para excluir com esses critérios.');
        return;
      }

      const periodoLabel =
        limparEscopo === 'periodo'
          ? ` de ${limparDataInicio || '(início)'} até ${limparDataFim || '(fim)'}`
          : ' (todos)';
      if (
        !window.confirm(
          `Excluir ${alvoSinteticos.length} apuração(ões) sintética(s) e zerar campos de imposto em ${regularComImposto.length} nota(s) fiscal(is)${periodoLabel}? Essa ação não pode ser desfeita.`,
        )
      ) {
        return;
      }

      const regularComImpostoIds = new Set(regularComImposto.map((inv) => inv.id));
      const restante = invoices
        .filter((inv) => !matches(inv))
        .map((inv) =>
          regularComImpostoIds.has(inv.id)
            ? { ...inv, pis: 0, cofins: 0, icms: 0, iss: 0, csll: 0, irpj: 0, simplesNacional: 0 }
            : inv,
        );
      persistInvoices(restante);
      setAcompanhamentoMsg(
        `✅ ${alvoSinteticos.length} apuração(ões) excluída(s) e campos de imposto zerados em ${regularComImposto.length} nota(s).`,
      );
      return;
    }

    const alvo = invoices.filter(matches);
    if (alvo.length === 0) {
      setAcompanhamentoMsg('Nenhum lançamento encontrado para excluir com esses critérios.');
      return;
    }

    const periodoLabel =
      limparEscopo === 'periodo'
        ? ` de ${limparDataInicio || '(início)'} até ${limparDataFim || '(fim)'}`
        : ' (todos)';
    if (
      !window.confirm(
        `Excluir ${alvo.length} lançamento(s) de ${LIMPAR_CATEGORIA_LABEL[limparCategoria]}${periodoLabel}? Essa ação não pode ser desfeita.`,
      )
    ) {
      return;
    }

    const restante = invoices.filter((inv) => !matches(inv));
    persistInvoices(restante);
    setAcompanhamentoMsg(`✅ ${alvo.length} lançamento(s) de ${LIMPAR_CATEGORIA_LABEL[limparCategoria]} excluído(s).`);
  };

  const nfAcumuladoresOptions = useMemo(() => {
    const cfops = new Set<string>();
    invoices.forEach((inv) => {
      const clean = sanitizeCfop(inv.cfop);
      if (clean) cfops.add(clean);
    });
    return Array.from(cfops).map((c) => ({ key: c, label: `CFOP ${c}` }));
  }, [invoices]);

  /** Códigos do "Resumo por Acumulador" (Sistema Domínio) — alimenta o "Puxar por Acumulador" nas Regras de Notas Fiscais. */
  const acumuladorResumoOptions = useMemo(() => {
    const seen = new Map<string, { key: string; label: string }>();
    for (const linha of resumoAcumuladorPdf?.linhas ?? []) {
      const codigo = linha.codigo.trim();
      const descricao = linha.descricao.trim();
      if (!codigo && !descricao) continue;
      const key = codigo || descricao;
      if (seen.has(key)) continue;
      seen.set(key, { key, label: descricao ? `${codigo} — ${descricao}` : codigo });
    }
    return [...seen.values()];
  }, [resumoAcumuladorPdf]);

  /** Plano de contas da empresa — alimenta o seletor de Conta Débito/Crédito nas regras. */
  const planoOptionsRegras = useMemo(() => {
    const planoRows = readManagerData<{ code: string; name: string; codigoReduzido?: string }>(
      selectedCompany,
      'plano',
    );
    return dedupePlanoOptions(
      (planoRows || []).map((r) => ({ code: r.code, name: r.name || r.code, codigoReduzido: r.codigoReduzido })),
    );
  }, [selectedCompany]);

  /** Meses (yyyy-mm) com pelo menos um lançamento — para o seletor de período. */
  const mesesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const inv of invoices) {
      const mes = (inv.date || '').slice(0, 7);
      if (mes.length === 7) set.add(mes);
    }
    return Array.from(set).sort();
  }, [invoices]);

  /** Por padrão soma TODOS os meses já importados — só filtra se o usuário escolher um mês específico. */
  const invoicesParaResumo = useMemo(() => {
    if (periodoImpostosFiltro === 'todos') return invoices;
    return invoices.filter((inv) => (inv.date || '').slice(0, 7) === periodoImpostosFiltro);
  }, [invoices, periodoImpostosFiltro]);

  const taxSummary = useMemo<TaxSummaryType>(() => {
    return invoicesParaResumo.reduce(
      (acc, inv) => {
        if (inv.type === 'entrada') {
          acc.pisRecuperar += inv.pis || 0;
          acc.cofinsRecuperar += inv.cofins || 0;
          acc.icmsRecuperar += inv.icms || 0;
          acc.issRecuperar += inv.iss || 0;
          acc.csllRecuperar += inv.csll || 0;
          acc.irpjRecuperar += inv.irpj || 0;
          acc.simplesRecuperar += inv.simplesNacional || 0;
          acc.totalEntries += Math.abs(inv.value);
        } else {
          acc.pisRecolher += inv.pis || 0;
          acc.cofinsRecolher += inv.cofins || 0;
          acc.icmsRecolher += inv.icms || 0;
          acc.issRecolher += inv.iss || 0;
          acc.csllRecolher += inv.csll || 0;
          acc.irpjRecolher += inv.irpj || 0;
          acc.simplesRecolher += inv.simplesNacional || 0;
          acc.totalExits += inv.value;
        }
        acc.totalValue += inv.value;
        return acc;
      },
      {
        pisRecuperar: 0,
        pisRecolher: 0,
        cofinsRecuperar: 0,
        cofinsRecolher: 0,
        icmsRecuperar: 0,
        icmsRecolher: 0,
        issRecuperar: 0,
        issRecolher: 0,
        csllRecuperar: 0,
        csllRecolher: 0,
        irpjRecuperar: 0,
        irpjRecolher: 0,
        simplesRecuperar: 0,
        simplesRecolher: 0,
        totalValue: 0,
        totalEntries: 0,
        totalExits: 0,
      },
    );
  }, [invoicesParaResumo]);

  /**
   * A tabela "Notas Fiscais" só deve listar documentos fiscais (NF-e/NFS-e/CT-e/etc).
   * O "Resumo de Impostos" importado do PDF Domínio (buildResumoImpostoInvoice) gera
   * lançamentos sintéticos de apuração (PIS/COFINS/ISS/CSLL/IRPJ/DIFAL) que entram no
   * mesmo array `invoices` só para alimentar o cálculo da aba Impostos — eles não são
   * notas fiscais e não devem aparecer nessa lista.
   */
  const notasFiscaisInvoices = useMemo(
    () => invoices.filter((inv) => !isImpostoInvoice(inv)),
    [invoices],
  );

  const dailySummaries = useMemo<DailyTaxSummary[]>(() => {
    const groups: Record<string, DailyTaxSummary> = {};

    invoices.forEach((inv) => {
      if (!groups[inv.date]) {
        groups[inv.date] = {
          date: inv.date,
          pisRecuperar: 0,
          pisRecolher: 0,
          cofinsRecuperar: 0,
          cofinsRecolher: 0,
          icmsRecuperar: 0,
          icmsRecolher: 0,
          issRecuperar: 0,
          issRecolher: 0,
          csllRecuperar: 0,
          csllRecolher: 0,
          irpjRecuperar: 0,
          irpjRecolher: 0,
          simplesRecuperar: 0,
          simplesRecolher: 0,
          totalEntradas: 0,
          totalSaidas: 0,
        };
      }

      const day = groups[inv.date];
      if (inv.type === 'entrada') {
        day.pisRecuperar += inv.pis || 0;
        day.cofinsRecuperar += inv.cofins || 0;
        day.icmsRecuperar += inv.icms || 0;
        day.issRecuperar += inv.iss || 0;
        day.csllRecuperar += inv.csll || 0;
        day.irpjRecuperar += inv.irpj || 0;
        day.simplesRecuperar += inv.simplesNacional || 0;
        day.totalEntradas += Math.abs(inv.value);
      } else {
        day.pisRecolher += inv.pis || 0;
        day.cofinsRecolher += inv.cofins || 0;
        day.icmsRecolher += inv.icms || 0;
        day.issRecolher += inv.iss || 0;
        day.csllRecolher += inv.csll || 0;
        day.irpjRecolher += inv.irpj || 0;
        day.simplesRecolher += inv.simplesNacional || 0;
        day.totalSaidas += inv.value;
      }
    });

    return Object.values(groups).sort((a, b) => a.date.localeCompare(b.date));
  }, [invoices]);

  /**
   * Agrupa as notas já importadas (invoices) por acumulador (accountCode) dentro de cada
   * seção (entradas/saídas/serviços), e — se o "Resumo por Acumulador" (PDF Domínio) foi
   * importado — junta a referência oficial pra comparar código a código.
   */
  const acumuladoresPorSecao = useMemo(() => {
    const build = (secao: 'entradas' | 'saidas' | 'servicos'): AcumuladorLinhaComparada[] => {
      const doSistema = new Map<string, { total: number; count: number }>();
      for (const inv of invoices) {
        if (categorizarInvoiceFiscal(inv) !== secao) continue;
        const codigo = inv.accountCode?.trim();
        if (!codigo) continue;
        const atual = doSistema.get(codigo) ?? { total: 0, count: 0 };
        atual.total += Math.abs(inv.value);
        atual.count += 1;
        doSistema.set(codigo, atual);
      }

      const doPdf = new Map<string, { descricao: string; total: number }>();
      for (const linha of resumoAcumuladorPdf?.linhas ?? []) {
        if (linha.secao !== secao) continue;
        doPdf.set(linha.codigo, { descricao: linha.descricao, total: linha.valorContabil });
      }

      const codigos = new Set([...doSistema.keys(), ...doPdf.keys()]);
      return Array.from(codigos)
        .map((codigo) => {
          const sistema = doSistema.get(codigo);
          const pdf = doPdf.get(codigo);
          return {
            codigo,
            descricao: pdf?.descricao ?? '',
            qtdNfs: sistema?.count ?? 0,
            totalSistema: sistema?.total ?? 0,
            totalPdf: pdf?.total,
          };
        })
        .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));
    };

    return {
      entradas: build('entradas'),
      saidas: build('saidas'),
      servicos: build('servicos'),
    };
  }, [invoices, resumoAcumuladorPdf]);

  return (
    <div className="w-full min-h-screen bg-brand-bg text-brand-text font-sans p-2 sm:p-4 space-y-4">
      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={txtInputRef}
        accept=".txt"
        className="hidden"
        onChange={handleTxtFileChange}
        aria-label="Upload TXT SPED"
      />
      <input
        type="file"
        ref={pdfLancamentosInputRef}
        accept=".pdf"
        className="hidden"
        onChange={handlePdfLancamentosFileChange}
        aria-label="Upload PDF Lançamentos"
      />
      <input
        type="file"
        ref={pdfImpostosInputRef}
        accept=".pdf"
        className="hidden"
        onChange={handlePdfImpostosFileChange}
        aria-label="Upload PDF Impostos"
      />
      <input
        type="file"
        ref={resumoImpostosInputRef}
        accept=".pdf"
        className="hidden"
        onChange={handleResumoImpostosFileChange}
        aria-label="Upload PDF Resumo de Impostos Domínio"
      />
      <input
        type="file"
        ref={acompanhamentoInputRef}
        accept=".pdf"
        className="hidden"
        onChange={handleAcompanhamentoFileChange}
        aria-label="Upload PDF Acompanhamento Domínio (Entradas/Saídas/Serviços)"
      />
      <input
        type="file"
        ref={resumoAcumuladorInputRef}
        accept=".pdf"
        className="hidden"
        onChange={handleResumoAcumuladorFileChange}
        aria-label="Upload PDF Resumo por Acumulador Domínio"
      />

      {/* Header Bar */}
      <div className="technical-panel bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] rounded-none p-4 space-y-3">
        {/* Top Header Row: Title on Left, Main SPED Import, Rules & Clear on Right */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-brand-border/30">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-brand-text text-white rounded-none border border-brand-border flex items-center justify-center shadow-[2px_2px_0_0_#141414] shrink-0">
              <Database size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black uppercase tracking-wider text-brand-text">Módulo Fiscal & SPED</h2>
                <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider bg-brand-sidebar text-brand-text border border-brand-border">
                  GERENCIADOR FISCAL
                </span>
              </div>
              <p className="text-xs text-brand-text/60 font-mono mt-0.5">
                {companyName || selectedCompany || 'Seleção por TXT SPED ou Recorte Direto de PDF'}
                {fileName ? ` · ${fileName}` : ''}
                {periodoInicio && periodoFim ? ` · Período: ${periodoInicio.substring(0,2)}/${periodoInicio.substring(2,4)}/${periodoInicio.substring(4,8)} a ${periodoFim.substring(0,2)}/${periodoFim.substring(2,4)}/${periodoFim.substring(4,8)}` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
            {invoices.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  value={limparCategoria}
                  onChange={(e) => setLimparCategoria(e.target.value as typeof limparCategoria)}
                  className="h-9 text-xs font-mono font-bold bg-white border border-brand-border px-2 shadow-[1px_1px_0_0_#141414] focus:outline-none"
                  aria-label="Categoria de lançamentos a excluir"
                >
                  <option value="entradas">Entradas</option>
                  <option value="saidas">Saídas</option>
                  <option value="servicos">Serviços</option>
                  <option value="impostos">Impostos</option>
                  <option value="tudo">Tudo</option>
                </select>
                <select
                  value={limparEscopo}
                  onChange={(e) => setLimparEscopo(e.target.value as typeof limparEscopo)}
                  className="h-9 text-xs font-mono font-bold bg-white border border-brand-border px-2 shadow-[1px_1px_0_0_#141414] focus:outline-none"
                  aria-label="Excluir todos ou só um período"
                >
                  <option value="todos">Todos</option>
                  <option value="periodo">Escolher data</option>
                </select>
                {limparEscopo === 'periodo' && (
                  <>
                    <input
                      type="date"
                      value={limparDataInicio}
                      onChange={(e) => setLimparDataInicio(e.target.value)}
                      className="h-9 text-[10px] font-mono font-bold bg-white border border-brand-border px-1.5 shadow-[1px_1px_0_0_#141414] focus:outline-none"
                      aria-label="Excluir a partir de"
                      title="De"
                    />
                    <input
                      type="date"
                      value={limparDataFim}
                      onChange={(e) => setLimparDataFim(e.target.value)}
                      className="h-9 text-[10px] font-mono font-bold bg-white border border-brand-border px-1.5 shadow-[1px_1px_0_0_#141414] focus:outline-none"
                      aria-label="Excluir até"
                      title="Até"
                    />
                  </>
                )}
                <button
                  type="button"
                  onClick={handleLimparSelecionado}
                  className="technical-button border-rose-700 text-rose-800 hover:bg-rose-700 hover:text-white text-xs h-9 px-3 flex items-center gap-1 font-bold"
                  title="Excluir os lançamentos da categoria e período escolhidos"
                >
                  <RefreshCw size={13} />
                  Limpar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {acompanhamentoMsg && (
        <p className="text-xs font-mono font-bold p-2 border border-brand-border bg-white shadow-[1px_1px_0_0_#141414]">
          {acompanhamentoMsg}
        </p>
      )}

      {/* Nav Tabs */}
      <div className="flex items-center justify-between border-b border-brand-border pb-2">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setActiveTab('notas')}
            className={`flex items-center space-x-2 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider border border-brand-border transition-all ${
              activeTab === 'notas'
                ? 'bg-brand-text text-white shadow-[2px_2px_0_0_#141414]'
                : 'bg-white text-brand-text hover:bg-brand-sidebar/40'
            }`}
          >
            <FileText size={15} />
            <span>Notas Fiscais</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('impostos')}
            className={`flex items-center space-x-2 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider border border-brand-border transition-all ${
              activeTab === 'impostos'
                ? 'bg-brand-text text-white shadow-[2px_2px_0_0_#141414]'
                : 'bg-white text-brand-text hover:bg-brand-sidebar/40'
            }`}
          >
            <LayoutDashboard size={15} />
            <span>Impostos</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('acumuladores')}
            className={`flex items-center space-x-2 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider border border-brand-border transition-all ${
              activeTab === 'acumuladores'
                ? 'bg-brand-text text-white shadow-[2px_2px_0_0_#141414]'
                : 'bg-white text-brand-text hover:bg-brand-sidebar/40'
            }`}
          >
            <Layers size={15} />
            <span>Acumuladores</span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-brand-text">
          <span className="flex items-center gap-1.5 bg-white px-3 py-1 border border-brand-border shadow-[2px_2px_0_0_#141414]">
            <CheckCircle2 size={14} className="text-emerald-700" />
            <strong>{invoices.length}</strong> registro(s)
          </span>
        </div>
      </div>

      {/* Main Content Area — cada subaba só mostra as ferramentas que têm a ver com ela.
          Sem mode="wait": se a aba estiver em background (rAF suspenso pelo navegador),
          a animação de saída pode nunca terminar e travaria a troca pra sempre. */}
      <AnimatePresence>
        {activeTab === 'notas' && (
          <motion.div key="notas" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            {/* Ferramentas — só Notas Fiscais */}
            <div className="technical-panel bg-brand-sidebar/20 border border-brand-border p-2.5 flex flex-wrap items-center justify-between gap-3 shadow-[1px_1px_0_0_#141414]">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => pdfLancamentosInputRef.current?.click()}
                  className="technical-button text-xs h-8 px-3 flex items-center gap-1.5 font-bold bg-white"
                  title="Recortar PDF para extrair notas fiscais"
                >
                  <Scissors size={14} className="text-blue-700" />
                  Recortar PDF Notas Fiscais
                </button>
                <button
                  type="button"
                  onClick={() => setRegrasNotasOpen(true)}
                  className="technical-button text-xs h-8 px-3 flex items-center gap-1.5 font-bold bg-white"
                  title="Regras de classificação e contas Débito/Crédito para Notas Fiscais"
                >
                  <Settings size={14} className="text-amber-600" />
                  Regras Notas Fiscais
                </button>

                <div className="flex items-center gap-1.5">
                  <select
                    value={tipoImportDominio}
                    onChange={(e) => setTipoImportDominio(e.target.value as typeof tipoImportDominio)}
                    className="h-8 text-xs font-mono font-bold bg-white border border-brand-border px-2 shadow-[1px_1px_0_0_#141414] focus:outline-none"
                    aria-label="Tipo de arquivo do Sistema Domínio a importar"
                  >
                    <option value="entrada">Entradas</option>
                    <option value="saida">Saídas</option>
                    <option value="servico">Serviços</option>
                    <option value="pgdas">PGDAS-D</option>
                    <option value="impostos_fiscais">Impostos Fiscais</option>
                    <option value="sped_notas">TXT SPED (só Notas Fiscais)</option>
                    <option value="sped_impostos">TXT SPED (só Impostos)</option>
                    <option value="sped_tudo">TXT SPED (Notas + Impostos)</option>
                    <option value="resumo_acumulador">Resumo por Acumulador</option>
                  </select>
                  <button
                    type="button"
                    disabled={acompanhamentoLoading || resumoImpostosLoading}
                    onClick={handleImportarDominioSelecionado}
                    className="technical-button text-xs h-8 px-3 flex items-center gap-1.5 font-bold bg-white disabled:opacity-50"
                    title="Importa o arquivo do Sistema Domínio para o tipo escolhido ao lado"
                  >
                    {tipoImportDominio.startsWith('sped_') ? (
                      <FileCode size={14} className="text-indigo-700" />
                    ) : (
                      <FileBarChart2 size={14} className="text-indigo-700" />
                    )}
                    {acompanhamentoLoading ? 'Lendo PDF…' : 'Importar PDF Sistema Domínio / SPED'}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-white border border-brand-border px-2 py-1 shadow-[1px_1px_0_0_#141414]" title="Data de referência das notas fiscais (xx/xx/xxxx)">
                <Calendar size={12} className="text-brand-text/60 shrink-0" />
                <span className="text-[9px] font-mono font-bold uppercase text-brand-text/60">Data:</span>
                <input
                  type="text"
                  value={dataLancamentosPdf}
                  onChange={(e) => setDataLancamentosPdf(formatMaskDate(e.target.value))}
                  placeholder="xx/xx/xxxx"
                  maxLength={10}
                  className="w-20 text-[10px] font-mono font-bold bg-transparent text-center focus:outline-none placeholder:text-brand-text/40 text-brand-text"
                  aria-label="Data das notas fiscais (xx/xx/xxxx)"
                />
              </div>
            </div>

            <InvoiceTable invoices={notasFiscaisInvoices} />
          </motion.div>
        )}
        {activeTab === 'impostos' && (
          <motion.div key="imp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            {/* Ferramentas — só Impostos */}
            <div className="technical-panel bg-brand-sidebar/20 border border-brand-border p-2.5 flex flex-wrap items-center justify-between gap-3 shadow-[1px_1px_0_0_#141414]">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTipoImpostoSelecionado('icms');
                    pdfImpostosInputRef.current?.click();
                  }}
                  className="technical-button text-xs h-8 px-3 flex items-center gap-1.5 font-bold bg-white"
                  title="Recortar PDF para extrair apurações de impostos"
                >
                  <Scissors size={14} className="text-rose-700" />
                  Recortar PDF Impostos
                </button>
                <button
                  type="button"
                  onClick={() => setRegrasImpostosOpen(true)}
                  className="technical-button text-xs h-8 px-3 flex items-center gap-1.5 font-bold bg-white"
                  title="Regras de apuração e contas Débito/Crédito para Impostos"
                >
                  <Settings size={14} className="text-purple-600" />
                  Regras Impostos
                </button>
                <div className="flex items-center gap-1.5">
                  <select
                    value={tipoImportDominio}
                    onChange={(e) => setTipoImportDominio(e.target.value as typeof tipoImportDominio)}
                    className="h-8 text-xs font-mono font-bold bg-white border border-brand-border px-2 shadow-[1px_1px_0_0_#141414] focus:outline-none"
                    aria-label="Tipo de arquivo do Sistema Domínio a importar"
                  >
                    <option value="entrada">Entradas</option>
                    <option value="saida">Saídas</option>
                    <option value="servico">Serviços</option>
                    <option value="pgdas">PGDAS-D</option>
                    <option value="impostos_fiscais">Impostos Fiscais</option>
                    <option value="sped_notas">TXT SPED (só Notas Fiscais)</option>
                    <option value="sped_impostos">TXT SPED (só Impostos)</option>
                    <option value="sped_tudo">TXT SPED (Notas + Impostos)</option>
                    <option value="resumo_acumulador">Resumo por Acumulador</option>
                  </select>
                  <button
                    type="button"
                    disabled={acompanhamentoLoading || resumoImpostosLoading}
                    onClick={handleImportarDominioSelecionado}
                    className="technical-button text-xs h-8 px-3 flex items-center gap-1.5 font-bold bg-white disabled:opacity-50"
                    title="Importa o arquivo do Sistema Domínio para o tipo escolhido ao lado"
                  >
                    {tipoImportDominio.startsWith('sped_') ? (
                      <FileCode size={14} className="text-indigo-700" />
                    ) : (
                      <FileBarChart2 size={14} className="text-indigo-700" />
                    )}
                    {acompanhamentoLoading ? 'Lendo PDF…' : 'Importar PDF Sistema Domínio / SPED'}
                  </button>
                </div>
              </div>
            </div>

            {resumoImpostosMsg && (
              <p className="text-xs font-mono font-bold p-2 border border-brand-border bg-white shadow-[1px_1px_0_0_#141414]">
                {resumoImpostosMsg}
              </p>
            )}

            {pendingResumoConflito && (
              <div className="p-3 border border-amber-400 bg-amber-50 shadow-[1px_1px_0_0_#141414] space-y-2">
                <p className="text-xs font-mono font-bold text-amber-900">
                  {pendingResumoConflito.conflitantes.length} tributo(s) deste PDF já têm valor lançado no mesmo mês.
                  O que fazer?
                </p>
                <ul className="text-[10px] font-mono text-amber-900/80 list-disc list-inside">
                  {pendingResumoConflito.conflitantes.map((c, i) => (
                    <li key={i}>
                      {c.imposto} · {c.competencia} · PDF traz R$ {c.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleResolverConflitoResumoImpostos('ignorar')}
                    className="technical-button text-xs h-8 px-3 font-bold bg-white"
                    title="Mantém os valores já lançados e ignora os conflitantes deste PDF"
                  >
                    Ignorar (manter o que já está lançado)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolverConflitoResumoImpostos('sobrescrever')}
                    className="technical-button-primary text-xs h-8 px-3 font-bold bg-rose-700 border-rose-800 hover:bg-rose-800"
                    title="Substitui os valores já lançados pelos deste PDF"
                  >
                    Sobrescrever com este PDF
                  </button>
                </div>
              </div>
            )}

            {pendingSpedImpostosConflito && (
              <div className="p-3 border border-amber-400 bg-amber-50 shadow-[1px_1px_0_0_#141414] space-y-2">
                <p className="text-xs font-mono font-bold text-amber-900">
                  {pendingSpedImpostosConflito.descricoesConflitantes.length} descrição(ões) deste TXT SPED já têm
                  lançamento no mesmo mês. O que fazer com elas? (as demais descrições do arquivo entram normalmente)
                </p>
                <ul className="text-[10px] font-mono text-amber-900/80 list-disc list-inside">
                  {pendingSpedImpostosConflito.descricoesConflitantes.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleResolverConflitoSpedImpostos('ignorar')}
                    className="technical-button text-xs h-8 px-3 font-bold bg-white"
                    title="Mantém os lançamentos já existentes com essas descrições e ignora os do TXT"
                  >
                    Ignorar (manter o que já está lançado)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolverConflitoSpedImpostos('sobrescrever')}
                    className="technical-button-primary text-xs h-8 px-3 font-bold bg-rose-700 border-rose-800 hover:bg-rose-800"
                    title="Substitui os lançamentos já existentes com essas descrições pelos do TXT"
                  >
                    Sobrescrever com este TXT
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[9px] font-bold uppercase text-brand-text/50 font-mono">
                Ver por período:
              </label>
              <input
                type="month"
                value={periodoImpostosFiltro === 'todos' ? '' : periodoImpostosFiltro}
                onChange={(e) => setPeriodoImpostosFiltro(e.target.value || 'todos')}
                className="text-[10px] font-mono font-bold bg-white border border-brand-border px-2 py-1 shadow-[1px_1px_0_0_#141414] focus:outline-none"
                aria-label="Escolher o mês para ver os cards de imposto"
                title="Escolha qualquer mês, mesmo sem dados importados ainda"
              />
              {mesesDisponiveis.length > 0 && (
                <select
                  value={periodoImpostosFiltro}
                  onChange={(e) => setPeriodoImpostosFiltro(e.target.value)}
                  className="text-[10px] font-mono font-bold bg-white border border-brand-border px-2 py-1 shadow-[1px_1px_0_0_#141414] focus:outline-none"
                  aria-label="Escolher entre os meses já importados"
                >
                  <option value="todos">Todos os meses (total acumulado)</option>
                  {mesesDisponiveis.map((mes) => {
                    const [yyyy, mm] = mes.split('-');
                    return (
                      <option key={mes} value={mes}>
                        {mm}/{yyyy}
                      </option>
                    );
                  })}
                </select>
              )}
              {periodoImpostosFiltro !== 'todos' && (
                <button
                  type="button"
                  onClick={() => setPeriodoImpostosFiltro('todos')}
                  className="text-[9px] font-bold uppercase text-rose-700 hover:underline"
                  title="Voltar para o total acumulado de todos os meses"
                >
                  Ver todos
                </button>
              )}
            </div>

            <TaxSummary summary={taxSummary} />
            <TaxDetailTable summary={taxSummary} />
            <DailyTaxTable dailySummaries={dailySummaries} />
          </motion.div>
        )}
        {activeTab === 'acumuladores' && (
          <motion.div key="acum" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            <div className="technical-panel bg-brand-sidebar/20 border border-brand-border p-2.5 flex flex-wrap items-center justify-between gap-3 shadow-[1px_1px_0_0_#141414]">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={acompanhamentoLoading}
                  onClick={() => resumoAcumuladorInputRef.current?.click()}
                  className="technical-button text-xs h-8 px-3 flex items-center gap-1.5 font-bold bg-white disabled:opacity-50"
                  title="Importa o Resumo por Acumulador (PDF Domínio) para comparar com os totais já lançados"
                >
                  <FileBarChart2 size={14} className="text-indigo-700" />
                  {acompanhamentoLoading ? 'Lendo PDF…' : 'Importar Resumo por Acumulador (PDF Domínio)'}
                </button>
              </div>
              {resumoAcumuladorPdf && (
                <span className="text-[9px] font-mono font-bold uppercase text-brand-text/50">
                  Referência: {resumoAcumuladorPdf.periodoInicio} até {resumoAcumuladorPdf.periodoFim}
                </span>
              )}
            </div>

            {!resumoAcumuladorPdf && (
              <p className="text-[9px] font-mono text-brand-text/50 leading-relaxed">
                Sem o PDF "Resumo por Acumulador" importado, a tabela abaixo mostra só o que já
                foi lançado no sistema (Entradas/Saídas/Serviços/TXT SPED), agrupado por
                acumulador — sem a coluna de comparação com o Domínio.
              </p>
            )}

            <AcumuladorSecaoTable titulo="Entradas por acumulador" rows={acumuladoresPorSecao.entradas} />
            <AcumuladorSecaoTable titulo="Saídas por acumulador" rows={acumuladoresPorSecao.saidas} />
            <AcumuladorSecaoTable titulo="Serviços por acumulador" rows={acumuladoresPorSecao.servicos} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* PDF Crop Modal for Notas Fiscais */}
      {pendingPdfFile && pdfCropTarget === 'lancamentos' && (
        <Suspense fallback={null}>
          <LeitorRecortadorModal
            file={pendingPdfFile}
            dataType="fiscal"
            title="Recortar PDF — Notas Fiscais (Escolha as colunas)"
            confirmLabel="Confirmar Recorte de Notas Fiscais"
            campoDefs={FISCAL_ALL_CAMPOS}
            dataColIds={['data', 'descricao', 'acumulador', 'cfop', 'valor']}
            companyName={selectedCompany}
            onCancel={() => {
              setPendingPdfFile(null);
              setPdfCropTarget(null);
            }}
            onConfirm={handleConfirmLancamentosPdf}
          />
        </Suspense>
      )}

      {/* PDF Crop Modal for Impostos */}
      {pendingPdfFile && pdfCropTarget === 'impostos' && (
        <Suspense fallback={null}>
          <LeitorRecortadorModal
            file={pendingPdfFile}
            dataType="fiscal"
            title="Recortar PDF — Impostos (Escolha as colunas)"
            confirmLabel="Confirmar Recorte de Impostos"
            campoDefs={FISCAL_ALL_CAMPOS}
            dataColIds={['data', 'descricao', 'valor', 'debito', 'credito']}
            companyName={selectedCompany}
            onCancel={() => {
              setPendingPdfFile(null);
              setPdfCropTarget(null);
            }}
            onConfirm={handleConfirmImpostosPdf}
          />
        </Suspense>
      )}

      {/* Modal de Regras para Notas Fiscais (Com Entradas vs Saídas) */}
      {regrasNotasOpen && (
        <Suspense fallback={null}>
          <FiscalAcumuladorRegrasModal
            open={regrasNotasOpen}
            company={selectedCompany}
            regras={fiscalRegras}
            planoOptions={planoOptionsRegras}
            acumuladores={[]}
            nfAcumuladores={nfAcumuladoresOptions}
            acumuladorResumoOptions={acumuladorResumoOptions}
            invoices={invoices}
            tituloModal="Regras de contas — Notas Fiscais"
            isNotasFiscais={true}
            onClose={() => setRegrasNotasOpen(false)}
            onChange={(next) => setFiscalRegras(next)}
          />
        </Suspense>
      )}

      {/* Modal de Regras para Impostos (Com A Recolher vs A Recuperar) */}
      {regrasImpostosOpen && (
        <Suspense fallback={null}>
          <FiscalAcumuladorRegrasModal
            open={regrasImpostosOpen}
            company={selectedCompany}
            regras={fiscalRegras}
            planoOptions={planoOptionsRegras}
            acumuladores={[]}
            nfAcumuladores={[
              { key: 'ICMS', label: 'Imposto ICMS' },
              { key: 'PIS', label: 'Imposto PIS' },
              { key: 'COFINS', label: 'Imposto COFINS' },
              { key: 'ISS', label: 'Imposto ISS' },
              { key: 'CSLL', label: 'Imposto CSLL' },
              { key: 'IRPJ', label: 'Imposto IRPJ' },
              { key: 'SIMPLES', label: 'Simples Nacional' },
            ]}
            invoices={invoices}
            tituloModal="Regras de contas — Impostos"
            isNotasFiscais={false}
            onClose={() => setRegrasImpostosOpen(false)}
            onChange={(next) => setFiscalRegras(next)}
          />
        </Suspense>
      )}

      <BalancetePeriodoModal
        isOpen={periodoModalFiscalOpen}
        onConfirm={handlePeriodoFiscalConfirmado}
        onCancel={() => setPeriodoModalFiscalOpen(false)}
      />
    </div>
  );
}
