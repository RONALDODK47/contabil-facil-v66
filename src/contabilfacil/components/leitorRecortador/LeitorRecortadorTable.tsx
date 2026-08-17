/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dummy comment to trigger VS Code TS cache reload
import React from 'react';
import type { ExtractedRow } from '../../../lib/leitorRecortador/types';
import { Trash2, TrendingDown, TrendingUp, HelpCircle, FileSpreadsheet, Plus, AlertCircle, Filter, X, Check, EyeOff, Wallet, DollarSign, Image, PencilLine } from 'lucide-react';
import { analyzeValueString, loadExtractedRowPrunePrefs, pruneExtractedRows, saveExtractedRowPrunePrefs } from '../../../lib/leitorRecortador/cropper';
import { loadSavedTextFilterRules, saveTextFilterRules } from '../../../lib/leitorRecortador/savedTextFilters';
import { FreeNumericInput } from '../FreeNumericInput';
import { parseLocaleNumber } from '../../../lib/localeNumber';

interface TableViewerProps {
  rows: ExtractedRow[];
  setRows: React.Dispatch<React.SetStateAction<ExtractedRow[]>>;
  onExportCsv: () => void;
  onExportOfx?: () => void;
  onClearAll: () => void;
  exclusionRules: string[];
  setExclusionRules: React.Dispatch<React.SetStateAction<string[]>>;
  cleanupRules: string[];
  setCleanupRules: React.Dispatch<React.SetStateAction<string[]>>;
  pruneStorageKey?: string;
  /** Escopo (ex.: empresa + banco) usado para Salvar/Carregar os filtros manualmente —
   * nunca preenche os filtros sozinho, só quando o usuário clica em "Carregar salvos". */
  filterStorageScope?: string;
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normaliza texto para comparação: remove acentos, maiúsculas, espaços extras, sinais.
 * Preserva o original, usado APENAS para matching em filtros/exclusões.
 * 
 * Exemplos:
 * - "SALDO: ANTERIOR" → "SALDO ANTERIOR"
 * - "sáldo-antérior" → "SALDO ANTERIOR"
 * - "SALDO  .  ANTERIOR" → "SALDO ANTERIOR"
 */
function normalizeTextForMatching(text: string): string {
  return String(text ?? '')
    .normalize('NFD')                   // Decompõe acentos
    .replace(/[\u0300-\u036f]/g, '')   // Remove diacríticos
    .replace(/[^\w\s]/g, ' ')          // Remove sinais, mantém apenas letras/números/espaço
    .replace(/\s+/g, ' ')              // Normaliza espaços múltiplos
    .toUpperCase()                      // Converte para maiúsculas
    .trim();
}

export function LeitorRecortadorTable({
  rows,
  setRows,
  onExportCsv,
  onExportOfx,
  onClearAll,
  exclusionRules,
  setExclusionRules,
  cleanupRules,
  setCleanupRules,
  pruneStorageKey = '',
  filterStorageScope = '',
}: TableViewerProps) {

  const [hoveredRowId, setHoveredRowId] = React.useState<string | null>(null);
  const [newRule, setNewRule] = React.useState('');
  const [newCleanupRule, setNewCleanupRule] = React.useState('');
  const [savedRulesMsg, setSavedRulesMsg] = React.useState<string | null>(null);

  const handleSaveExclusionRules = () => {
    saveTextFilterRules(filterStorageScope, 'exclusao', exclusionRules);
    setSavedRulesMsg('Filtros de exclusão salvos.');
  };
  const handleLoadExclusionRules = () => {
    setExclusionRules(loadSavedTextFilterRules(filterStorageScope, 'exclusao'));
    setSavedRulesMsg('Filtros de exclusão salvos carregados.');
  };
  const handleSaveCleanupRules = () => {
    saveTextFilterRules(filterStorageScope, 'limpeza', cleanupRules);
    setSavedRulesMsg('Termos de limpeza salvos.');
  };
  const handleLoadCleanupRules = () => {
    setCleanupRules(loadSavedTextFilterRules(filterStorageScope, 'limpeza'));
    setSavedRulesMsg('Termos de limpeza salvos carregados.');
  };

  React.useEffect(() => {
    if (!savedRulesMsg) return;
    const t = setTimeout(() => setSavedRulesMsg(null), 4000);
    return () => clearTimeout(t);
  }, [savedRulesMsg]);
  const [showMonthlyBalanceModal, setShowMonthlyBalanceModal] = React.useState(false);
  const [saldoAnterior, setSaldoAnterior] = React.useState<number>(() => {
    const saved = localStorage.getItem('saldo_anterior');
    return saved ? parseLocaleNumber(saved, 0) : 0;
  });
  
  // 1. Clean history text using cleanup rules
  const cleanedRows = React.useMemo(() => {
    if (cleanupRules.length === 0) return rows;
    return rows.map((row) => {
      let historyText = row.historyText || '';
      cleanupRules.forEach((rule) => {
        const trimmed = rule.trim();
        if (!trimmed) return;
        
        // Normaliza a regra para matching mas remove do original
        const normalized = normalizeTextForMatching(trimmed);
        let regexStr = escapeRegExp(normalized);
        if (/^[a-zA-Z0-9]+$/.test(normalized)) {
          regexStr = '\\b' + regexStr + '\\b';
        }
        
        // Testa se a versão normalizada do histórico contém a regra normalizada
        const normalizedHistory = normalizeTextForMatching(historyText);
        if (normalizedHistory.includes(normalized) || new RegExp(regexStr, 'i').test(normalizedHistory)) {
          // Dividir em palavras e remover a sequência correspondente
          const historyWords = historyText.split(/\s+/);
          const normalizedWords = normalizedHistory.split(/\s+/);
          const ruleWords = normalized.split(/\s+/).filter(Boolean);
          
          if (ruleWords.length > 0) {
            // Procura pela sequência de palavras
            for (let i = 0; i <= normalizedWords.length - ruleWords.length; i++) {
              const segment = normalizedWords.slice(i, i + ruleWords.length).join(' ');
              if (segment === ruleWords.join(' ')) {
                historyWords.splice(i, ruleWords.length);
                historyText = historyWords.join(' ');
                break;
              }
            }
          }
        }
      });
      historyText = historyText.replace(/\s+/g, ' ').trim();
      return { ...row, historyText };
    });
  }, [rows, cleanupRules]);

  // Filter rows based on exclusion rules (normalized matching)
  const filteredRows = React.useMemo(() => {
    if (exclusionRules.length === 0) return cleanedRows;
    return cleanedRows.filter((row) => {
      const historyText = row.historyText || '';
      const historyUpper = historyText.toUpperCase();
      return !exclusionRules.some((rule) => {
        if (!rule.trim()) return false;
        const ruleUpper = rule.trim().toUpperCase();

        // Se a regra tem múltiplas palavras/espaços, busca exata da frase
        // "IOF BLOQUEADO" só encontra "IOF BLOQUEADO"
        if (ruleUpper.includes(' ')) {
          return historyUpper.includes(ruleUpper);
        }

        // Se a regra é uma palavra única, busca parcial com normalização
        // "IOF" encontra "DÉB.IOF DOC.: IOF/2-3", "IOF BLOQUEADO", etc
        const normalizedRule = normalizeTextForMatching(ruleUpper);
        const normalizedHistory = normalizeTextForMatching(historyUpper);
        return normalizedHistory.includes(normalizedRule);
      });
    });
  }, [cleanedRows, exclusionRules]);

  const excludedRowsCount = rows.length - filteredRows.length;

  const handleAddRule = (ruleText: string) => {
    const trimmed = ruleText.trim();
    if (!trimmed) return;
    if (exclusionRules.some(r => r.toUpperCase() === trimmed.toUpperCase())) {
      setNewRule('');
      return;
    }
    setExclusionRules(prev => [...prev, trimmed]);
    setNewRule('');
  };

  const handleRemoveRule = (ruleToRemove: string) => {
    setExclusionRules(prev => prev.filter(r => r !== ruleToRemove));
  };

  const handleTextChange = (
    rowId: string,
    field: 'dateText' | 'historyText' | 'valueText',
    newVal: string
  ) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;

        const updatedRow = { ...row, [field]: newVal };

        // If editing the value field, re-run our parser automatically
        if (field === 'valueText') {
          const { isNegative, parsedValue } = analyzeValueString(newVal);
          updatedRow.isNegative = isNegative;
          updatedRow.parsedValue = parsedValue;
        }

        return updatedRow;
      })
    );
  };

  const handleToggleSign = (rowId: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        
        const isNegative = !row.isNegative;
        // Flip the sign of the parsed number as well
        const parsedValue = row.parsedValue !== null ? -row.parsedValue : null;

        return {
          ...row,
          isNegative,
          parsedValue,
        };
      })
    );
  };

  const handleDeleteRow = (rowId: string) => {
    setRows((prev) => prev.filter((row) => row.id !== rowId));
  };

  const handleDeleteRowsWithoutValue = () => {
    saveExtractedRowPrunePrefs(pruneStorageKey, { removeNoNumericValue: true });
    setRows((prev) => pruneExtractedRows(prev, { removeNoNumericValue: true }));
  };

  const handleDeleteRowsWithoutHistory = () => {
    saveExtractedRowPrunePrefs(pruneStorageKey, { removeNoHistory: true });
    setRows((prev) => pruneExtractedRows(prev, { removeNoHistory: true }));
  };

  const handleDeleteRowsWithoutDate = () => {
    saveExtractedRowPrunePrefs(pruneStorageKey, { removeNoDate: true });
    setRows((prev) => pruneExtractedRows(prev, { removeNoDate: true }));
  };

  const handleAddRow = () => {
    const newRow: ExtractedRow = {
      id: `manual-row-${Date.now()}`,
      dateText: new Date().toLocaleDateString('pt-BR'),
      historyText: 'LANÇAMENTO MANUAL',
      valueText: '0,00',
      dateCropUrl: '',
      historyCropUrl: '',
      valueCropUrl: '',
      isNegative: false,
      parsedValue: 0,
      y: 0,
      height: 0,
    };
    setRows((prev) => [...prev, newRow]);
  };

  return (
    <div id="table-results-card" className="bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] overflow-hidden flex flex-col h-full min-h-[400px]">
      {/* Table Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-white border-b border-brand-border">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-brand-text/60" />
            <h2 className="font-semibold text-brand-text text-base">Dados Recortados & Tabelados</h2>
            {rows.length > 0 && (
              <span className="text-xs bg-brand-sidebar text-brand-text font-semibold px-2.5 py-0.5 border border-brand-border flex items-center">
                {filteredRows.length} {filteredRows.length === 1 ? 'linha' : 'linhas'}
                {excludedRowsCount > 0 && (
                  <span className="text-[10px] text-amber-400 font-medium ml-1.5 border-l border-brand-border pl-1.5">
                    ({excludedRowsCount} excluída{excludedRowsCount === 1 ? '' : 's'} por texto)
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {rows.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">


            <button
              onClick={handleAddRow}
              className="technical-button flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              Inserir Linha
            </button>
            <button
              id="export-csv-btn"
              onClick={onExportCsv}
              className="technical-button flex items-center gap-2 px-4 py-1.5 text-xs font-semibold"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Exportar para Excel / CSV
            </button>
            {onExportOfx && (
              <button
                type="button"
                onClick={onExportOfx}
                className="technical-button flex items-center gap-2 px-4 py-1.5 text-xs font-semibold"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Exportar OFX Money
              </button>
            )}
          </div>
        )}
      </div>

      {/* Saldos Diários Button Bar */}
      {rows.length > 0 && (
        <div className="flex items-center justify-between px-6 py-2 bg-brand-sidebar border-b border-brand-border">
          <span className="text-[10px] font-bold text-brand-text/50 uppercase tracking-widest">Dados Convertidos (Texto Editável)</span>
          <button
            onClick={() => setShowMonthlyBalanceModal(true)}
            className="technical-button flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold cursor-pointer"
            title="Visualizar os saldos acumulados por dia"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Saldos Diários
          </button>
        </div>
      )}

      {/* Bento Grid containing Saldo Anterior, Entradas, Saídas and Saldo Final */}
      {rows.length > 0 && (() => {
        // Contar TODAS as linhas (não só filtradas)
        const totalEntradas = filteredRows
          .filter(r => !r.isNegative && r.parsedValue !== null)
          .reduce((sum, r) => sum + (r.parsedValue || 0), 0);

        const totalSaidas = Math.abs(
          filteredRows
            .filter(r => r.isNegative && r.parsedValue !== null)
            .reduce((sum, r) => sum + (r.parsedValue || 0), 0)
        );

        // Se saldoAnterior é positivo, conta como entrada. Se negativo, conta como saída
        const saldoAnteriorValue = saldoAnterior || 0;
        const totalEntradasComSaldo = totalEntradas + (saldoAnteriorValue > 0 ? saldoAnteriorValue : 0);
        const totalSaidasComSaldo = totalSaidas + (saldoAnteriorValue < 0 ? Math.abs(saldoAnteriorValue) : 0);

        // Saldo final = Entradas - Saídas
        const saldoFinalRaw = totalEntradasComSaldo - totalSaidasComSaldo;
        // Evita -0,00 por ponto flutuante quando entradas = saídas.
        const saldoFinal =
          Math.abs(saldoFinalRaw) < 0.005 ? 0 : Math.round(saldoFinalRaw * 100) / 100;
        const saldoZerado = Math.abs(saldoFinal) < 0.005;
        const saldoPositivo = saldoFinal > 0.005;

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-6 py-5 bg-white border-b border-brand-border animate-fade-in">
            {/* Card 1: Saldo Anterior */}
            <div className="bg-brand-sidebar/20 border border-brand-border p-4 flex flex-col justify-between gap-2.5 transition-all hover:border-brand-border shadow-[2px_2px_0_0_#141414]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-brand-sidebar border border-brand-border text-brand-text flex items-center justify-center">
                  <Wallet className="w-3.5 h-3.5" />
                </div>
                <span className="text-[10px] font-bold text-brand-text/60 uppercase tracking-wider">Saldo Anterior</span>
              </div>
              <div className="relative flex items-center mt-1">
                <span className="absolute left-3 text-brand-text/50 font-mono text-xs font-bold z-[1]">R$</span>
                <FreeNumericInput
                  aria-label="Saldo anterior"
                  value={saldoAnterior}
                  onChange={(val) => {
                    setSaldoAnterior(val);
                    // ⚠️ DISABLED: Salva SOMENTE no Docker
                    // localStorage.setItem('saldo_anterior', String(val));
                  }}
                  displayDecimals={2}
                  hideZeroWhenBlurred={false}
                  placeholder="0,00"
                  className="w-full bg-white border border-brand-border focus:border-brand-border hover:border-brand-border pl-9 pr-3 py-1.5 text-xs font-mono font-bold text-brand-text outline-none transition-all placeholder-brand-text/40"
                />
              </div>
            </div>

            {/* Card 2: Entradas */}
            <div className="bg-brand-sidebar/20 border border-brand-border p-4 flex flex-col justify-between gap-2.5 transition-all hover:border-brand-border shadow-[2px_2px_0_0_#141414]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5" />
                </div>
                <span className="text-[10px] font-bold text-brand-text/60 uppercase tracking-wider">Entradas</span>
              </div>
              <div className="mt-1">
                <span className="text-lg font-mono font-bold text-emerald-700">
                  R$ {totalEntradasComSaldo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Card 3: Saídas */}
            <div className="bg-brand-sidebar/20 border border-brand-border p-4 flex flex-col justify-between gap-2.5 transition-all hover:border-brand-border shadow-[2px_2px_0_0_#141414]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center">
                  <TrendingDown className="w-3.5 h-3.5" />
                </div>
                <span className="text-[10px] font-bold text-brand-text/60 uppercase tracking-wider">Saídas</span>
              </div>
              <div className="mt-1">
                <span className="text-lg font-mono font-bold text-rose-600">
                  R$ {totalSaidasComSaldo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Card 4: Saldo Final */}
            <div className={`border p-4 flex flex-col justify-between gap-2.5 transition-all shadow-[2px_2px_0_0_#141414] ${ saldoZerado || saldoPositivo ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200' }`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 flex items-center justify-center border ${ saldoZerado || saldoPositivo ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-600 border-rose-200' }`}>
                    <DollarSign className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[10px] font-bold text-brand-text/80 uppercase tracking-wider">Saldo Final</span>
                </div>
                <span className={`text-[9px] font-bold px-2 py-0.5 border ${ saldoZerado || saldoPositivo ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-600 border-rose-200' }`}>
                  {saldoZerado ? 'Zerado' : saldoPositivo ? 'Positivo' : 'Devedor'}
                </span>
              </div>
              <div className="mt-1">
                <span className={`text-lg font-mono font-bold ${saldoZerado || saldoPositivo ? 'text-emerald-700' : 'text-rose-600'}`}>
                  R$ {saldoFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Botões de exclusão em lote — acima dos filtros por texto */}
      {rows.length > 0 && (
        <div className="px-6 py-4 bg-white border-b border-brand-border flex flex-wrap items-center gap-2 animate-fade-in">
          <span className="text-[10px] font-bold text-brand-text/60 uppercase tracking-wider mr-1">
            Limpar linhas:
          </span>
          <button
            type="button"
            onClick={handleDeleteRowsWithoutValue}
            className="technical-button flex items-center gap-1.5 px-3 py-1.5 text-rose-600 text-xs font-semibold hover:bg-rose-50"
            title="Remove linhas sem número na coluna Valor (ex.: Agência, VALORES)"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Excluir sem valor
          </button>
          <button
            type="button"
            onClick={handleDeleteRowsWithoutHistory}
            className="technical-button flex items-center gap-1.5 px-3 py-1.5 text-rose-600 text-xs font-semibold hover:bg-rose-50"
            title="Remove linhas com coluna Histórico vazia"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Excluir sem histórico
          </button>
          <button
            type="button"
            onClick={handleDeleteRowsWithoutDate}
            className="technical-button flex items-center gap-1.5 px-3 py-1.5 text-rose-600 text-xs font-semibold hover:bg-rose-50"
            title="Remove linhas com coluna Data vazia"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Excluir sem data
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="technical-button flex items-center gap-1.5 px-3 py-1.5 text-rose-600 text-xs font-semibold hover:bg-rose-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Limpar Tudo
          </button>
        </div>
      )}

      {/* Exclusion Rules Management Card */}
      {rows.length > 0 && (
        <div className="px-6 py-5 bg-white/60 border-b border-brand-border flex flex-col gap-4 animate-fade-in">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 bg-amber-950/30 text-amber-500 border border-amber-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Filter className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-xs text-brand-text uppercase tracking-wider flex items-center gap-2">
                  Filtros de Exclusão por Texto (Saldos, Taxas & Metadados)
                </h3>
                <p className="text-[11px] text-brand-text/60 leading-normal mt-0.5">
                  Digite palavras ou frases. Se o histórico da transação for exatamente igual ao filtro cadastrado (sem diferenciar maiúsculas/minúsculas), ela será automaticamente removida da visualização e da exportação. Para descrições mais longas, você pode primeiro remover palavras com a ferramenta de limpeza abaixo.
                </p>
              </div>
            </div>

          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start bg-brand-bg p-4 border border-brand-border">
            {/* Input Form */}
            <div className="lg:col-span-4 flex flex-col gap-2">
              <span className="text-[10px] font-bold text-brand-text/60 uppercase tracking-wider block">Cadastrar Novo Filtro (Correspondência Exata)</span>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAddRule(newRule);
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={newRule}
                  onChange={(e) => setNewRule(e.target.value)}
                  placeholder="Ex: SALDO ANTERIOR"
                  className="flex-1 text-xs font-semibold bg-white border border-brand-border focus:border-brand-border hover:border-brand-border px-3 py-2 text-brand-text placeholder-brand-text/40 outline-none transition-all"
                />
                <button
                  type="submit"
                  className="technical-button-primary px-3.5 py-2 text-xs font-bold cursor-pointer font-sans"
                >
                  Adicionar
                </button>
              </form>
            </div>

            {/* Active Rules List */}
            <div className="lg:col-span-8 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-brand-text/60 uppercase tracking-wider block">Filtros Ativos ({exclusionRules.length})</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={handleSaveExclusionRules}
                    className="technical-button px-2 py-1 text-[9px] font-bold uppercase"
                    title="Salvar esta lista de filtros para reutilizar depois"
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadExclusionRules}
                    className="technical-button px-2 py-1 text-[9px] font-bold uppercase"
                    title="Carregar a última lista de filtros salva (não é automático)"
                  >
                    Carregar salvos
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 items-center max-h-[120px] overflow-y-auto pr-1">
                {exclusionRules.length === 0 ? (
                  <span className="text-xs text-brand-text/50 italic py-1">Nenhum filtro ativo no momento. Escreva acima para filtrar.</span>
                ) : (
                  exclusionRules.map((rule, idx) => (
                    <div
                      key={rule + '-' + idx}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand-sidebar/50 text-brand-text border border-brand-border text-xs font-semibold transition-all group hover:bg-brand-sidebar"
                    >
                      <Filter className="w-3 h-3 text-brand-text animate-pulse" />
                      <span>{rule}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveRule(rule)}
                        className="p-0.5 hover:bg-rose-50 hover:text-rose-600 transition-colors text-brand-text cursor-pointer"
                        title="Remover este filtro"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Suggestions */}
              <div className="flex flex-wrap gap-2 items-center text-[10px] text-brand-text/60 mt-1 border-t border-brand-border/60 pt-2">
                <span className="font-medium text-brand-text/50">Sugestões rápidas:</span>
                {['SALDO ANTERIOR', 'SALDO DO DIA', 'SALDO ATUAL', 'SALDO DISPONÍVEL', 'TOTAL DISPONÍVEL', 'SDO ANTERIOR', 'TAR COMP'].map((suggest) => {
                  const alreadyActive = exclusionRules.some(r => r.toUpperCase() === suggest.toUpperCase());
                  if (alreadyActive) return null;
                  return (
                    <button
                      key={suggest}
                      type="button"
                      onClick={() => handleAddRule(suggest)}
                      className="px-2 py-0.5 bg-white hover:bg-brand-sidebar border border-brand-border text-brand-text/60 hover:text-brand-text text-[10px] font-medium transition-all cursor-pointer"
                    >
                      + {suggest}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cleanup Rules Management Card */}
      {rows.length > 0 && (
        <div className="px-6 py-5 bg-white/60 border-b border-brand-border flex flex-col gap-4 animate-fade-in">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 bg-emerald-950/30 text-emerald-500 border border-emerald-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-xs text-brand-text uppercase tracking-wider flex items-center gap-2">
                  Limpeza do Histórico (Remover Palavras / Códigos)
                </h3>
                <p className="text-[11px] text-brand-text/60 leading-normal mt-0.5">
                  Digite palavras, códigos ou números que você deseja remover automaticamente do histórico de todas as transações (ex: "50921", "33369075000101"). Isso ajuda a limpar descrições poluídas para que os filtros de correspondência exata funcionem de forma precisa.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start bg-brand-bg p-4 border border-brand-border">
            {/* Input Form */}
            <div className="lg:col-span-4 flex flex-col gap-2">
              <span className="text-[10px] font-bold text-brand-text/60 uppercase tracking-wider block">Cadastrar Termo para Remover</span>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newCleanupRule.trim()) return;
                  if (!cleanupRules.some(r => r.toUpperCase() === newCleanupRule.trim().toUpperCase())) {
                    setCleanupRules(prev => [...prev, newCleanupRule.trim()]);
                  }
                  setNewCleanupRule('');
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={newCleanupRule}
                  onChange={(e) => setNewCleanupRule(e.target.value)}
                  placeholder="Ex: 33369075000101"
                  className="flex-1 text-xs font-semibold bg-white border border-brand-border focus:border-brand-border hover:border-brand-border px-3 py-2 text-brand-text placeholder-brand-text/40 outline-none transition-all"
                />
                <button
                  type="submit"
                  className="technical-button-primary px-3.5 py-2 text-xs font-bold cursor-pointer font-sans"
                >
                  Remover
                </button>
              </form>
            </div>

            {/* Active Cleanup Rules List */}
            <div className="lg:col-span-8 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-brand-text/60 uppercase tracking-wider block">Termos de Remoção Ativos ({cleanupRules.length})</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={handleSaveCleanupRules}
                    className="technical-button px-2 py-1 text-[9px] font-bold uppercase"
                    title="Salvar esta lista de termos para reutilizar depois"
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadCleanupRules}
                    className="technical-button px-2 py-1 text-[9px] font-bold uppercase"
                    title="Carregar a última lista de termos salva (não é automático)"
                  >
                    Carregar salvos
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 items-center max-h-[120px] overflow-y-auto pr-1">
                {cleanupRules.length === 0 ? (
                  <span className="text-xs text-brand-text/50 italic py-1">Nenhum termo cadastrado para remoção. Digite ao lado.</span>
                ) : (
                  cleanupRules.map((rule, idx) => (
                    <div
                      key={'clean-' + rule + '-' + idx}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand-sidebar/50 text-brand-text border border-brand-border text-xs font-semibold transition-all group hover:bg-brand-sidebar"
                    >
                      <Trash2 className="w-3 h-3 text-brand-text" />
                      <span>"{rule}"</span>
                      <button
                        type="button"
                        onClick={() => setCleanupRules(prev => prev.filter(r => r !== rule))}
                        className="p-0.5 hover:bg-rose-50 hover:text-rose-600 transition-colors text-brand-text cursor-pointer"
                        title="Remover regra de limpeza"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table Workspace */}
      <div className="flex-1 overflow-x-auto bg-brand-bg p-4 lg:p-6">
        {rows.length > 0 ? (
          <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center gap-2 px-1 py-1">
                <span className="w-2.5 h-2.5 bg-emerald-500"></span>
                <h3 className="text-xs font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                  <PencilLine className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  Dados Convertidos (Texto Editável)
                </h3>
              </div>
              <div className="overflow-x-auto border border-brand-border bg-brand-sidebar/30 shadow-[2px_2px_0_0_#141414]">
                <table className="w-full text-left border-collapse table-fixed">
                  <thead>
                    <tr className="bg-white border-b border-brand-border text-xs font-bold text-brand-text/60 uppercase tracking-wider whitespace-nowrap">
                      <th className="py-3 px-3 w-10 text-center border-b border-brand-border">Nº</th>
                      <th className="py-3 px-3 w-[20%] border-b border-brand-border">Data</th>
                      <th className="py-3 px-3 w-[45%] border-b border-brand-border">Histórico</th>
                      <th className="py-3 px-3 w-[20%] border-b border-brand-border">Valor (R$)</th>
                      <th className="py-3 px-3 w-[15%] border-b border-brand-border">Sinal / Status</th>
                      <th className="py-3 px-3 w-10 text-center border-b border-brand-border"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-border bg-brand-sidebar/30">
                    {filteredRows.map((row, index) => {
                      const isHovered = hoveredRowId === row.id;
                      return (
                        <tr
                          key={row.id}
                          onMouseEnter={() => setHoveredRowId(row.id)}
                          onMouseLeave={() => setHoveredRowId(null)}
                          className={`transition-colors border-b border-brand-border ${ isHovered ? 'bg-brand-sidebar/40 border-brand-border' : 'hover:bg-brand-sidebar/20' }`}
                          style={{ height: '80px' }}
                        >
                          {/* index */}
                          <td className="py-3 px-3 text-center text-xs font-mono text-brand-text/50 font-bold">
                            {index + 1}
                          </td>

                          {/* Date Input */}
                          <td className="py-1 px-2">
                            <input
                              type="text"
                              value={row.dateText}
                              onChange={(e) => handleTextChange(row.id, 'dateText', e.target.value)}
                              className="text-sm font-mono font-bold text-brand-text bg-white hover:bg-brand-sidebar focus:bg-brand-sidebar border border-brand-border hover:border-brand-border focus:border-brand-border px-2 py-1 outline-none transition-all w-full text-center"
                              style={{ height: '58px' }}
                              placeholder="Data"
                            />
                          </td>

                          {/* History Input */}
                          <td className="py-1 px-2">
                            <textarea
                              value={row.historyText}
                              onChange={(e) => handleTextChange(row.id, 'historyText', e.target.value)}
                              className="text-sm font-bold text-brand-text bg-white hover:bg-brand-sidebar focus:bg-brand-sidebar border border-brand-border hover:border-brand-border focus:border-brand-border px-2 py-1 outline-none transition-all w-full resize-none leading-tight"
                              style={{ height: '58px' }}
                              placeholder="Histórico"
                            />
                          </td>

                          {/* Value Input */}
                          <td className="py-1 px-2">
                            <input
                              type="text"
                              value={row.valueText}
                              onChange={(e) => handleTextChange(row.id, 'valueText', e.target.value)}
                              className={`text-sm font-mono font-extrabold bg-white hover:bg-brand-sidebar focus:bg-brand-sidebar border border-brand-border hover:border-brand-border focus:border-brand-border px-2 py-1 outline-none transition-all w-full text-center ${ row.isNegative ? 'text-rose-600' : 'text-emerald-700' }`}
                              style={{ height: '58px' }}
                              placeholder="Valor"
                            />
                          </td>

                          {/* Positive/Negative Status Sign */}
                          <td className="py-3 px-3">
                            <div className="flex flex-col gap-0.5 justify-center">
                              <button
                                onClick={() => handleToggleSign(row.id)}
                                className={`inline-flex items-center gap-1 px-1.5 py-1 text-[10px] font-bold w-fit cursor-pointer border select-none transition-all active:scale-95 ${ row.isNegative ? 'bg-rose-50 border-rose-300 hover:border-rose-400 text-rose-600' : 'bg-emerald-50 border-emerald-300 hover:border-emerald-400 text-emerald-700' }`}
                                title="Clique para alternar sinal"
                              >
                                {row.isNegative ? (
                                  <>
                                    <TrendingDown className="w-3 h-3 text-rose-600" />
                                    <span>Despesa</span>
                                  </>
                                ) : (
                                  <>
                                    <TrendingUp className="w-3 h-3 text-emerald-700" />
                                    <span>Receita</span>
                                  </>
                                )}
                              </button>
                              
                              {row.parsedValue !== null ? (
                                <span className="text-[9px] font-mono text-brand-text/50 truncate" title={`R$ ${row.parsedValue}`}>
                                  R$ {row.parsedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              ) : (
                                <span className="text-[9px] font-mono text-rose-600 flex items-center gap-0.5">
                                  <AlertCircle className="w-2.5 h-2.5" /> Ilegível
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-3 text-center">
                            <button
                              onClick={() => handleDeleteRow(row.id)}
                              className="p-1 text-brand-text/40 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              title="Remover linha"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center p-12 bg-white max-w-lg mx-auto my-8 border border-brand-border">
            <div className="w-14 h-14 bg-brand-sidebar text-brand-text/50 flex items-center justify-center mb-4 border border-brand-border shadow-[2px_2px_0_0_#141414]">
              <FileSpreadsheet className="w-7 h-7" />
            </div>
            <h3 className="font-semibold text-brand-text text-sm mb-1.5">Tabela Vazia</h3>
            <p className="text-brand-text/60 text-xs leading-relaxed mb-6">
              Nenhuma linha foi recortada ou mapeada ainda. Alinhe as colunas de Data, Histórico e Valor acima e clique no botão <strong>Recortar & Analisar</strong> para iniciar o processamento e preencher a tabela.
            </p>
            <div className="flex items-center gap-4">
              <button
                onClick={handleAddRow}
                className="technical-button px-4 py-2 font-semibold text-xs"
              >
                Inserir Linha Manual
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Table Footer Instructions */}
      {rows.length > 0 && (
        <div className="px-6 py-4 bg-white border-t border-brand-border flex items-center justify-between gap-4 text-xs text-brand-text/60">
          <div className="flex items-center gap-1.5 mx-auto">
            <HelpCircle className="w-3.5 h-3.5 text-brand-text animate-pulse" />
            <span>Todos os dados e recortes podem ser editados diretamente na tabela antes de exportar.</span>
          </div>
        </div>
      )}

      {showMonthlyBalanceModal && (() => {
        const dailyGroups = new Map<string, { day: number; month: number; year: number; positive: number; negative: number }>();

        filteredRows.forEach((row) => {
          if (!row.dateText) return;
          const parts = row.dateText.split('/');
          if (parts.length < 2) return;
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10);
          let year = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
          if (isNaN(day) || isNaN(month) || isNaN(year)) return;
          if (year < 100) year += 2000;

          const key = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
          let val = 0;
          if (row.valueText) {
            const clean = row.valueText.replace(/[CDcd]/g, '').replace(/\s/g, '');
            const parsed = parseLocaleNumber(clean, 0);
            val = Math.abs(parsed);
          }

          if (!dailyGroups.has(key)) {
            dailyGroups.set(key, { day, month, year, positive: 0, negative: 0 });
          }
          const group = dailyGroups.get(key)!;
          if (row.isNegative) {
            group.negative += val;
          } else {
            group.positive += val;
          }
        });

        const sortedGroups = Array.from(dailyGroups.entries()).sort((a, b) => {
          const yearDiff = a[1].year - b[1].year;
          if (yearDiff !== 0) return yearDiff;
          const monthDiff = a[1].month - b[1].month;
          if (monthDiff !== 0) return monthDiff;
          return a[1].day - b[1].day;
        });

        // Compute running balance: each day opens with previous day's closing balance
        let runningBalance = saldoAnterior || 0;
        const groupsWithBalance = sortedGroups.map(([key, group]) => {
          const openingBalance = runningBalance;
          const net = group.positive - group.negative;
          const closingBalance = Math.abs(openingBalance + net) < 0.005 ? 0 : Math.round((openingBalance + net) * 100) / 100;
          runningBalance = closingBalance;
          return { key, group, openingBalance, net, closingBalance };
        });

        const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        return (
          <div className="fixed inset-0 bg-brand-text/50 backdrop-blur-[2px] flex items-center justify-center z-50 p-4 pointer-events-auto">
            <div className="bg-white border border-brand-border shadow-[4px_4px_0_0_#141414] w-full max-w-3xl max-h-[85vh] flex flex-col">
              <div className="px-6 py-4 border-b border-brand-border flex items-center justify-between bg-brand-sidebar">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-semibold text-brand-text text-sm">Resumo de Saldos Diários</h3>
                  {saldoAnterior !== 0 && (
                    <span className="text-[10px] text-brand-text/50 font-mono bg-brand-sidebar border border-brand-border px-2 py-0.5">
                      Saldo Anterior: R$ {fmt(saldoAnterior)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowMonthlyBalanceModal(false)}
                  className="text-brand-text/50 hover:text-brand-text text-lg cursor-pointer border-none bg-transparent font-bold"
                  aria-label="Fechar"
                >
                  &times;
                </button>
              </div>

              <div className="p-4 overflow-y-auto flex flex-col gap-3">
                <div className="border border-brand-border">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-brand-sidebar border-b border-brand-border text-[10px] font-bold text-brand-text/80 uppercase">
                      <tr>
                        <th className="p-3">Data</th>
                        <th className="p-3 text-right">Receitas (+)</th>
                        <th className="p-3 text-right">Despesas (-)</th>
                        <th className="p-3 text-right font-bold">Saldo do Dia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupsWithBalance.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-4 text-center text-brand-text/50">
                            Nenhuma transação com data válida disponível.
                          </td>
                        </tr>
                      ) : (
                        groupsWithBalance.map(({ key, group, net, closingBalance }) => {
                          const isAccNeg = closingBalance < -0.005;

                          return (
                            <tr key={key} className="border-b border-brand-border hover:bg-brand-sidebar/30">
                              <td className="p-3 font-semibold text-brand-text">{key}</td>
                              <td className="p-3 text-right text-emerald-600">
                                R$ {fmt(group.positive)}
                              </td>
                              <td className="p-3 text-right text-rose-600">
                                R$ {fmt(group.negative)}
                              </td>
                              <td className={`p-3 text-right font-bold ${isAccNeg ? 'text-rose-600' : closingBalance > 0.005 ? 'text-emerald-600' : 'text-brand-text'}`}>
                                R$ {fmt(closingBalance)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    {groupsWithBalance.length > 0 && (
                      <tfoot className="bg-brand-sidebar border-t-2 border-brand-border text-[10px] font-bold uppercase">
                        <tr>
                          <td className="p-3 text-brand-text/60">Total</td>
                          <td className="p-3 text-right text-emerald-600">
                            R$ {fmt(groupsWithBalance.reduce((s, g) => s + g.group.positive, 0))}
                          </td>
                          <td className="p-3 text-right text-rose-600">
                            R$ {fmt(groupsWithBalance.reduce((s, g) => s + g.group.negative, 0))}
                          </td>
                          <td className="p-3 text-right font-bold text-brand-text">—</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-brand-border flex justify-end bg-brand-sidebar">
                <button
                  onClick={() => setShowMonthlyBalanceModal(false)}
                  className="technical-button px-4 py-2 text-xs font-semibold cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
