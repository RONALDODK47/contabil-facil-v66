import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import type { SavedAplicacao } from '../logic/aplicacaoStorage';
import DominioDebitoCreditoBlock from './DominioDebitoCreditoBlock';
import {
  CF_FIELD_COL,
  CF_FIELD_ROW,
  CF_FORM_INPUT_LONG,
  CF_FORM_INPUT_MED,
  CF_FORM_INPUT_SHORT,
} from '../lib/formFieldClasses';
import { cn } from '../lib/utils';

export interface AppsContasTabProps {
  selectedCompany: string;
  items: SavedAplicacao[];
  onSave: (items: SavedAplicacao[]) => void;
}

type ContasDraft = Pick<
  SavedAplicacao,
  | 'nomeAplicacao'
  | 'accAplicacaoDebit'
  | 'accAplicacaoCredit'
  | 'temReceitaJuros'
  | 'accReceitaJurosDebit'
  | 'accReceitaJurosCredit'
  | 'temIRRF'
  | 'accIRRFDebit'
  | 'accIRRFCredit'
  | 'temIOF'
  | 'accIOFDebit'
  | 'accIOFCredit'
  | 'dominioCodigoHistoricoStr'
  | 'dominioComplementoHistoricoStr'
>;

function draftFromItem(item: SavedAplicacao): ContasDraft {
  return {
    nomeAplicacao: item.nomeAplicacao ?? '',
    accAplicacaoDebit: item.accAplicacaoDebit ?? '',
    accAplicacaoCredit: item.accAplicacaoCredit ?? '',
    temReceitaJuros: !!item.temReceitaJuros,
    accReceitaJurosDebit: item.accReceitaJurosDebit ?? '',
    accReceitaJurosCredit: item.accReceitaJurosCredit ?? '',
    temIRRF: !!item.temIRRF,
    accIRRFDebit: item.accIRRFDebit ?? '',
    accIRRFCredit: item.accIRRFCredit ?? '',
    temIOF: !!item.temIOF,
    accIOFDebit: item.accIOFDebit ?? '',
    accIOFCredit: item.accIOFCredit ?? '',
    dominioCodigoHistoricoStr: item.dominioCodigoHistoricoStr ?? '',
    dominioComplementoHistoricoStr: item.dominioComplementoHistoricoStr ?? '',
  };
}

function ToggleSection({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          aria-label={typeof label === 'string' ? label : 'Alternar opção'}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-brand-border w-4 h-4"
        />
        <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
      </label>
      <div className={cn(!checked && 'opacity-45 pointer-events-none')}>{children}</div>
    </div>
  );
}

export default function AppsContasTab({ selectedCompany, items, onSave }: AppsContasTabProps) {
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<ContasDraft | null>(null);
  const [dirty, setDirty] = useState(false);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    if (items.length === 0) {
      setSelectedId('');
      setDraft(null);
      setDirty(false);
      return;
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  useEffect(() => {
    if (!selectedItem) {
      setDraft(null);
      setDirty(false);
      return;
    }
    setDraft(draftFromItem(selectedItem));
    setDirty(false);
  }, [selectedItem?.id]);

  const patchDraft = useCallback((patch: Partial<ContasDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const handleSave = () => {
    if (!selectedItem || !draft) return;
    const updated = items.map((item) =>
      item.id === selectedItem.id ? { ...item, ...draft } : item,
    );
    onSave(updated);
    setDirty(false);
  };

  if (items.length === 0) {
    return (
      <div className="technical-panel p-12 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
        Cadastre uma aplicação para configurar as contas do TXT+ Domínio.
      </div>
    );
  }

  if (!draft || !selectedItem) return null;

  const label = (draft.nomeAplicacao || selectedItem.nomeAplicacao || selectedItem.numeroAplicacao || 'Aplicação').trim();

  return (
    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
      <div className="p-4 border-b border-brand-border bg-brand-sidebar/30 flex flex-col md:flex-row md:items-end gap-3 justify-between">
        <div className="space-y-2 flex-1">
          <h3 className="text-[10px] font-black uppercase tracking-widest">Contas TXT+ Domínio</h3>
          <p className="text-[9px] font-mono opacity-60 max-w-2xl">
            Débito e crédito exportados para o Domínio. Marque juros, IRRF ou IOF quando esses lançamentos forem gerados.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 max-w-2xl">
            {items.length > 1 && (
              <div className="sm:w-48 shrink-0">
                <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">Registro</label>
                <select
                  aria-label="Selecionar aplicação cadastrada"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="w-full border border-brand-border bg-brand-bg px-3 py-2 text-xs font-mono font-bold"
                >
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {(item.nomeAplicacao || item.numeroAplicacao || 'SEM NOME').toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={CF_FIELD_COL}>
              <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">Nome da aplicação</label>
              <input
                type="text"
                aria-label="Nome da aplicação"
                value={draft.nomeAplicacao ?? ''}
                onChange={(e) => patchDraft({ nomeAplicacao: e.target.value.toUpperCase() })}
                placeholder="EX.: SICREDINVEST EXCLUSIVO"
                className={CF_FORM_INPUT_MED}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty}
            className="technical-button-primary flex items-center gap-2 text-[10px] font-black uppercase px-4 py-2 disabled:opacity-40"
          >
            <Save size={14} />
            Salvar contas
          </button>
        </div>
      </div>

      <div className="module-table-viewport p-4 space-y-4">
        <div className={`${CF_FIELD_ROW} border border-brand-border bg-brand-sidebar/5 p-4`}>
          <div className={CF_FIELD_COL}>
            <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">Cód. histórico Domínio</label>
            <input aria-label="Cód. histórico Domínio"
              type="text"
              value={draft.dominioCodigoHistoricoStr ?? ''}
              onChange={(e) => patchDraft({ dominioCodigoHistoricoStr: e.target.value })}
              className={CF_FORM_INPUT_SHORT}
              placeholder="Opcional"
            />
          </div>
          <div className={CF_FIELD_COL}>
            <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">Complemento histórico</label>
            <input aria-label="Complemento histórico"
              type="text"
              value={draft.dominioComplementoHistoricoStr ?? ''}
              onChange={(e) => patchDraft({ dominioComplementoHistoricoStr: e.target.value })}
              className={CF_FORM_INPUT_LONG}
              placeholder={label.slice(0, 40)}
            />
          </div>
        </div>

        <DominioDebitoCreditoBlock
          titulo="Conta aplicação"
          historico="APLICACAO FINANCEIRA / APLICACAO DO MES"
          debito={draft.accAplicacaoDebit ?? ''}
          credito={draft.accAplicacaoCredit ?? ''}
          onDebitoChange={(v) => patchDraft({ accAplicacaoDebit: v })}
          onCreditoChange={(v) => patchDraft({ accAplicacaoCredit: v })}
        />

        <ToggleSection
          label="Receita de juros"
          checked={!!draft.temReceitaJuros}
          onChange={(checked) => patchDraft({ temReceitaJuros: checked })}
        >
          <DominioDebitoCreditoBlock
            titulo="Receita de juros"
            historico="RECEITA DE JUROS APLICACAO · último dia do mês"
            debito={draft.accReceitaJurosDebit ?? ''}
            credito={draft.accReceitaJurosCredit ?? ''}
            onDebitoChange={(v) => patchDraft({ accReceitaJurosDebit: v })}
            onCreditoChange={(v) => patchDraft({ accReceitaJurosCredit: v })}
          />
        </ToggleSection>

        <ToggleSection
          label="IRRF"
          checked={!!draft.temIRRF}
          onChange={(checked) => patchDraft({ temIRRF: checked })}
        >
          <DominioDebitoCreditoBlock
            titulo="IRRF"
            historico="IRRF SOBRE RENDIMENTO DE APLICACAO"
            debito={draft.accIRRFDebit ?? ''}
            credito={draft.accIRRFCredit ?? ''}
            onDebitoChange={(v) => patchDraft({ accIRRFDebit: v })}
            onCreditoChange={(v) => patchDraft({ accIRRFCredit: v })}
          />
        </ToggleSection>

        <ToggleSection
          label="IOF"
          checked={!!draft.temIOF}
          onChange={(checked) => patchDraft({ temIOF: checked })}
        >
          <DominioDebitoCreditoBlock
            titulo="IOF"
            historico="IOF SOBRE APLICACAO"
            debito={draft.accIOFDebit ?? ''}
            credito={draft.accIOFCredit ?? ''}
            onDebitoChange={(v) => patchDraft({ accIOFDebit: v })}
            onCreditoChange={(v) => patchDraft({ accIOFCredit: v })}
          />
        </ToggleSection>
      </div>
    </div>
  );
}
