import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Plus, Trash2 } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';
import { readManagerData } from '../logic/companyWorkspace';
import type { FiscalSpedArquivoSalvo } from '../logic/fiscalSpedAutomation';
import { sanitizeParsedSpedFiscal } from '../../extratoVision/utils/spedFiscalParser';
import { notaFiscalRotulo } from '../logic/fiscalAcumuladorModel';
import {
  regrasPresetRemessa,
  separarNotasFiscais,
  type FiscalNotaBloqueioConfig,
  type FiscalNotaBloqueioRegraTipo,
} from '../logic/fiscalNotaBloqueio';
import {
  addFiscalNotaBloqueioRegra,
  loadFiscalNotaBloqueio,
  mergeFiscalNotaBloqueioRegras,
  patchFiscalNotaBloqueioValorZero,
  patchFiscalNotaBloqueioRemessa,
  removeFiscalNotaBloqueioRegra,
  saveFiscalNotaBloqueio,
} from '../logic/fiscalNotaBloqueioStorage';
import { CF_FORM_INPUT_LONG, CF_SELECT_WIDE } from '../lib/formFieldClasses';
import { normalizeExtratoRegraTexto } from '../logic/extratoRegrasContasStorage';

type Props = {
  selectedCompany: string;
  onChange?: (config: FiscalNotaBloqueioConfig) => void;
};

function carregarNotas(empresa: string) {
  return readManagerData<FiscalSpedArquivoSalvo>(empresa, 'fiscalSped').flatMap((arq) => {
    const parsed = sanitizeParsedSpedFiscal(arq.parsed);
    return parsed.notasFiscais ?? [];
  });
}

function formatDataIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function FiscalNotaBloqueioPanel({ selectedCompany, onChange }: Props) {
  const [config, setConfig] = useState<FiscalNotaBloqueioConfig>(() =>
    loadFiscalNotaBloqueio(selectedCompany),
  );
  const [draftTipo, setDraftTipo] = useState<FiscalNotaBloqueioRegraTipo>('texto');
  const [draftValor, setDraftValor] = useState('');
  const [draftRotulo, setDraftRotulo] = useState('');

  useEffect(() => {
    setConfig(loadFiscalNotaBloqueio(selectedCompany));
  }, [selectedCompany]);

  const persist = useCallback(
    (next: FiscalNotaBloqueioConfig) => {
      const saved = saveFiscalNotaBloqueio(selectedCompany, next);
      setConfig(saved);
      onChange?.(saved);
      window.dispatchEvent(new CustomEvent('contabilfacil-fiscal-sped-updated'));
    },
    [onChange, selectedCompany],
  );

  const preview = useMemo(() => {
    const notas = carregarNotas(selectedCompany);
    return separarNotasFiscais(notas, config);
  }, [config, selectedCompany]);

  const handleToggleValorZero = useCallback(
    (checked: boolean) => {
      persist(patchFiscalNotaBloqueioValorZero(selectedCompany, checked));
    },
    [persist, selectedCompany],
  );

  const handleToggleRemessa = useCallback(
    (checked: boolean) => {
      persist(patchFiscalNotaBloqueioRemessa(selectedCompany, checked));
    },
    [persist, selectedCompany],
  );

  const handleAdd = useCallback(() => {
    const valor =
      draftTipo === 'cfop'
        ? draftValor.replace(/\D/g, '').slice(0, 4)
        : normalizeExtratoRegraTexto(draftValor);
    if (!valor) return;
    const next = addFiscalNotaBloqueioRegra(selectedCompany, {
      tipo: draftTipo,
      valor,
      rotulo: draftRotulo.trim() || (draftTipo === 'cfop' ? `CFOP ${valor}` : valor.slice(0, 40)),
    });
    persist(next);
    setDraftValor('');
    setDraftRotulo('');
  }, [draftRotulo, draftTipo, draftValor, persist, selectedCompany]);

  const handleRemove = useCallback(
    (id: string) => {
      persist(removeFiscalNotaBloqueioRegra(selectedCompany, id));
    },
    [persist, selectedCompany],
  );

  const handlePresetRemessa = useCallback(() => {
    persist(mergeFiscalNotaBloqueioRegras(selectedCompany, regrasPresetRemessa()));
  }, [persist, selectedCompany]);

  return (
    <div className="space-y-4">
      <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/30 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Ban size={14} className="opacity-60 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest">Bloqueio de notas fiscais</h3>
              <p className="text-[9px] font-bold uppercase opacity-50 mt-0.5 max-w-2xl">
                Cadastre um histórico de regras para não extrair notas indesejadas (remessa, valor zero, CFOP
                etc.). As NFs bloqueadas não aparecem nos acumuladores.
              </p>
            </div>
          </div>
          <div className="text-right text-[9px] font-mono uppercase opacity-70">
            <p>
              <strong className="text-brand-text">{preview.bloqueadas.length}</strong> bloqueada
              {preview.bloqueadas.length !== 1 ? 's' : ''} ·{' '}
              <strong className="text-brand-text">{preview.aceitas.length}</strong> liberada
              {preview.aceitas.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="px-4 py-4 border-b border-brand-border/20 space-y-4">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={config.bloquearValorZero}
              onChange={(e) => handleToggleValorZero(e.target.checked)}
              className="accent-brand-text"
            />
            <span className="text-[10px] font-black uppercase tracking-wide">
              Bloquear notas com valor total zero
            </span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={config.bloquearRemessa}
              onChange={(e) => handleToggleRemessa(e.target.checked)}
              className="accent-brand-text"
            />
            <span className="text-[10px] font-black uppercase tracking-wide">
              Bloquear NF de remessa automaticamente (entrada 1.9xx / 2.9xx e saída 5.9xx / 6.9xx)
            </span>
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handlePresetRemessa}
              className="technical-button text-[9px] px-3 py-1.5 font-bold"
            >
              + Pacote remessa (texto + CFOPs)
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
            <div className="sm:col-span-2">
              <label className="block text-[8px] font-bold uppercase opacity-50 mb-1">Tipo</label>
              <select
                value={draftTipo}
                onChange={(e) => setDraftTipo(e.target.value as FiscalNotaBloqueioRegraTipo)}
                className={CF_SELECT_WIDE}
              >
                <option value="texto">Texto</option>
                <option value="cfop">CFOP</option>
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className="block text-[8px] font-bold uppercase opacity-50 mb-1">
                {draftTipo === 'cfop' ? 'CFOP (4 dígitos)' : 'Texto na NF'}
              </label>
              <input
                type="text"
                value={draftValor}
                onChange={(e) => setDraftValor(e.target.value)}
                placeholder={draftTipo === 'cfop' ? '5901' : 'remessa'}
                className={cn(CF_FORM_INPUT_LONG, 'h-[26px] text-[10px] uppercase')}
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block text-[8px] font-bold uppercase opacity-50 mb-1">
                Histórico / rótulo
              </label>
              <input
                type="text"
                value={draftRotulo}
                onChange={(e) => setDraftRotulo(e.target.value)}
                placeholder="Ex.: Notas de remessa"
                className={cn(CF_FORM_INPUT_LONG, 'h-[26px] text-[10px]')}
              />
            </div>
            <div className="sm:col-span-3">
              <button
                type="button"
                onClick={handleAdd}
                disabled={!draftValor.trim()}
                className="technical-button-primary w-full text-[9px] px-3 py-2 flex items-center justify-center gap-1 font-bold disabled:opacity-40"
              >
                <Plus size={12} />
                Adicionar regra
              </button>
            </div>
          </div>
        </div>

        <div className="module-table-viewport max-h-[280px] overflow-y-auto">
          {config.regras.length === 0 ? (
            <p className="py-10 text-center text-slate-400 uppercase text-[10px] px-4">
              Nenhuma regra no histórico. Ative valor zero ou adicione texto/CFOP acima.
            </p>
          ) : (
            <table className="w-full text-left text-[10px] font-mono">
              <thead className="technical-grid-header sticky top-0 z-10">
                <tr>
                  {['Histórico', 'Tipo', 'Valor', 'Incluída em', ''].map((h) => (
                    <th
                      key={h || 'acao'}
                      className="px-3 py-2 text-[8px] font-black uppercase border-r border-brand-border/30 last:border-r-0"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border/10">
                {config.regras.map((regra) => (
                  <tr key={regra.id} className="hover:bg-brand-sidebar/10">
                    <td className="px-3 py-2 font-bold">{regra.rotulo}</td>
                    <td className="px-3 py-2 uppercase opacity-70">{regra.tipo}</td>
                    <td className="px-3 py-2">{regra.valor}</td>
                    <td className="px-3 py-2 whitespace-nowrap opacity-60">{formatDataIso(regra.criadoEm)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemove(regra.id)}
                        className="technical-button border-red-800 text-red-800 p-1.5"
                        aria-label="Remover regra"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {preview.bloqueadas.length > 0 && (
        <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
          <div className="px-4 py-2 border-b border-brand-border/30 bg-amber-50/80">
            <p className="text-[9px] font-black uppercase text-amber-900">
              Prévia — notas bloqueadas ({preview.bloqueadas.length})
            </p>
          </div>
          <div className="module-table-viewport max-h-[min(40vh,360px)] overflow-y-auto">
            <table className="w-full text-left text-[10px] font-mono">
              <thead className="technical-grid-header sticky top-0 z-10">
                <tr>
                  {['NF / Fornecedor', 'CFOP', 'Valor', 'Motivo'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-[8px] font-black uppercase border-r border-brand-border/30 last:border-r-0"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border/10">
                {preview.bloqueadas.slice(0, 80).map(({ nota, motivo }) => (
                  <tr key={`${nota.linha}-${nota.chave || nota.numero}`} className="opacity-70">
                    <td className="px-3 py-1.5 max-w-[280px] truncate" title={notaFiscalRotulo(nota)}>
                      {notaFiscalRotulo(nota)}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">{nota.cfop || '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums">{formatCurrency(nota.valorTotal)}</td>
                    <td className="px-3 py-1.5 text-amber-800 font-bold">{motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.bloqueadas.length > 80 && (
              <p className="text-[9px] text-center py-2 opacity-50 uppercase">
                + {preview.bloqueadas.length - 80} notas bloqueadas
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
