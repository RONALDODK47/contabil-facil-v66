import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import type { SavedParcelamento } from '../logic/parcelamentoStorage';
import DominioDebitoCreditoBlock from './DominioDebitoCreditoBlock';
import {
  CF_FIELD_COL,
  CF_FIELD_ROW,
  CF_FORM_INPUT_LONG,
  CF_FORM_INPUT_SHORT,
  CF_SELECT_WIDE,
} from '../lib/formFieldClasses';

export interface InstallmentContasTabProps {
  selectedCompany: string;
  items: SavedParcelamento[];
  onSave: (items: SavedParcelamento[]) => void;
}

type ContasDraft = Pick<
  SavedParcelamento,
  | 'accEmprestimoDebit'
  | 'accEmprestimoCredit'
  | 'accParcelaDebit'
  | 'accParcelaCredit'
  | 'accPagamentoDebit'
  | 'accPagamentoCredit'
  | 'accJurosAproDebit'
  | 'accJurosAproCredit'
  | 'accApropriacaoDebit'
  | 'accApropriacaoCredit'
  | 'accTransferenciaDebit'
  | 'accTransferenciaCredit'
  | 'dominioCodigoHistoricoStr'
  | 'dominioComplementoHistoricoStr'
>;

function draftFromItem(item: SavedParcelamento): ContasDraft {
  return {
    accEmprestimoDebit: item.accEmprestimoDebit ?? '',
    accEmprestimoCredit: item.accEmprestimoCredit ?? '',
    accParcelaDebit: item.accParcelaDebit ?? '',
    accParcelaCredit: item.accParcelaCredit ?? '',
    accPagamentoDebit: item.accPagamentoDebit ?? '',
    accPagamentoCredit: item.accPagamentoCredit ?? '',
    accJurosAproDebit: item.accJurosAproDebit ?? '',
    accJurosAproCredit: item.accJurosAproCredit ?? '',
    accApropriacaoDebit: item.accApropriacaoDebit ?? '',
    accApropriacaoCredit: item.accApropriacaoCredit ?? '',
    accTransferenciaDebit: item.accTransferenciaDebit ?? '',
    accTransferenciaCredit: item.accTransferenciaCredit ?? '',
    dominioCodigoHistoricoStr: item.dominioCodigoHistoricoStr ?? '',
    dominioComplementoHistoricoStr: item.dominioComplementoHistoricoStr ?? '',
  };
}

export default function InstallmentContasTab({ selectedCompany, items, onSave }: InstallmentContasTabProps) {
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
        Cadastre um cronograma para configurar as contas do TXT+ Domínio.
      </div>
    );
  }

  if (!draft || !selectedItem) return null;

  const label =
    selectedItem.numeroParcelamento ||
    selectedItem.nomeParcelamento ||
    selectedItem.clienteNome ||
    'Cronograma';

  return (
    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
      <div className="p-4 border-b border-brand-border bg-brand-sidebar/30 flex flex-col md:flex-row md:items-end gap-3 justify-between">
        <div className="space-y-2 flex-1">
          <h3 className="text-[10px] font-black uppercase tracking-widest">Contas TXT+ Domínio</h3>
          <p className="text-[9px] font-mono opacity-60 max-w-2xl">
            Débito e crédito de cada lançamento exportado. Mesma lógica da interface antiga — só o visual ContabilFacil.
          </p>
          <div>
            <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">Cronograma</label>
            <select
              aria-label="Cronograma para configurar contas"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full max-w-md border border-brand-border bg-brand-bg px-3 py-2 text-xs font-mono font-bold"
            >
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {(item.numeroParcelamento || item.nomeParcelamento || item.clienteNome || 'SEM NOME').toUpperCase()}
                  {item.clienteNome ? ` · ${item.clienteNome}` : ''}
                </option>
              ))}
            </select>
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

      <div className="module-table-viewport p-4 space-y-3">
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
          titulo="Conta de valor total"
          historico="CONTA PARCELAMENTOS · soma do cronograma"
          debito={draft.accEmprestimoDebit ?? ''}
          credito={draft.accEmprestimoCredit ?? ''}
          onDebitoChange={(v) => patchDraft({ accEmprestimoDebit: v })}
          onCreditoChange={(v) => patchDraft({ accEmprestimoCredit: v })}
        />
        <DominioDebitoCreditoBlock
          titulo="Conta de parcela"
          historico="PROVISAO PARCELA MENSAL · a cada vencimento"
          debito={draft.accParcelaDebit ?? ''}
          credito={draft.accParcelaCredit ?? ''}
          onDebitoChange={(v) => patchDraft({ accParcelaDebit: v })}
          onCreditoChange={(v) => patchDraft({ accParcelaCredit: v })}
        />
        <DominioDebitoCreditoBlock
          titulo="Conta de pagamento"
          historico="PAGAMENTO PARCELA MENSAL · pagamento principal"
          debito={draft.accPagamentoDebit ?? ''}
          credito={draft.accPagamentoCredit ?? ''}
          onDebitoChange={(v) => patchDraft({ accPagamentoDebit: v })}
          onCreditoChange={(v) => patchDraft({ accPagamentoCredit: v })}
        />
        <DominioDebitoCreditoBlock
          titulo="Provisão juros a apropriar"
          historico="PROVISAO DE JUROS A APROPRIAR · 1º dia do mês"
          debito={draft.accJurosAproDebit ?? ''}
          credito={draft.accJurosAproCredit ?? ''}
          onDebitoChange={(v) => patchDraft({ accJurosAproDebit: v })}
          onCreditoChange={(v) => patchDraft({ accJurosAproCredit: v })}
        />
        <DominioDebitoCreditoBlock
          titulo="Apropriação de juros"
          historico="APROPRIACAO DE JUROS · último dia do mês"
          debito={draft.accApropriacaoDebit ?? ''}
          credito={draft.accApropriacaoCredit ?? ''}
          onDebitoChange={(v) => patchDraft({ accApropriacaoDebit: v })}
          onCreditoChange={(v) => patchDraft({ accApropriacaoCredit: v })}
        />
        <DominioDebitoCreditoBlock
          titulo="Transferência LP → CP"
          historico="TRANSFERENCIA DO LONGO PARA O CURTO PRAZO · 31/12"
          debito={draft.accTransferenciaDebit ?? ''}
          credito={draft.accTransferenciaCredit ?? ''}
          onDebitoChange={(v) => patchDraft({ accTransferenciaDebit: v })}
          onCreditoChange={(v) => patchDraft({ accTransferenciaCredit: v })}
        />
      </div>
    </div>
  );
}
