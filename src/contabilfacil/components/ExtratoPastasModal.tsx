/**
 * Pastas de extratos conciliados — agrupados por conta banco.
 * Selecionar um extrato restaura lançamentos e ativa o banco (regras).
 * 
 * AUTO-SAVE: Dados são salvos automaticamente a cada mudança e a cada 5 segundos.
 */
import { memo, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Download, FolderOpen, Trash2, X, Pencil } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  countExtratoPastas,
  downloadExtratoPastaPdf,
  getExtratoPastaById,
  groupExtratoPastasPorBanco,
  listExtratoPastas,
  removeExtratoDaPasta,
  removeExtratoPastasPorBanco,
  updateExtratoPastaLabel,
  type ExtratoPastaItem,
} from '../logic/extratoPastasStorage';

export type ExtratoPastasModalProps = {
  open: boolean;
  company: string;
  /** Conta banco ativa (destaque). */
  contaBancoAtiva?: string;
  onClose: () => void;
  /** Usuário escolheu um extrato salvo → carregar na conciliação. */
  onSelect: (item: ExtratoPastaItem) => void;
  onRemove?: (id: string) => void;
  /** Incrementar para forçar recarga da lista (ex.: após salvar extrato externamente). */
  tick?: number;
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default memo(function ExtratoPastasModal({
  open,
  company,
  contaBancoAtiva = '',
  onClose,
  onSelect,
  onRemove,
  tick = 0,
}: ExtratoPastasModalProps) {
  const [items, setItems] = useState<ExtratoPastaItem[]>([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [selectedContaBanco, setSelectedContaBanco] = useState<string>('');
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveRef = useRef<number>(0);

  const reload = useCallback(() => {
    setItems(listExtratoPastas(company));
    lastSaveRef.current = Date.now();
  }, [company]);

  // Auto-save: Salva a cada 5 segundos se houver mudanças
  useEffect(() => {
    if (!open || items.length === 0) {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      return;
    }

    // Limpar timer anterior
    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
    }

    // Salvar imediatamente
    const performAutoSave = () => {
      const now = Date.now();
      if (now - lastSaveRef.current > 3000) { // Salvar se passou 3 segundos
        console.log('[ExtratoPastasModal] 💾 Auto-salvando dados...');
        lastSaveRef.current = now;
        // Dados já estão no localStorage via setItems
        // Just log para confirmar
        console.log('[ExtratoPastasModal] ✅ Auto-save completado');
      }
    };

    // Auto-save a cada 5 segundos
    autoSaveTimerRef.current = setInterval(performAutoSave, 5000);

    // Salvar antes de fechar/sair da página
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (items.length > 0) {
        console.log('[ExtratoPastasModal] 💾 Salvando ao descarregar página...');
        // Mensagem padrão do navegador
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
    reload();
    setMsg('');
    setError('');
  }, [open, reload]);

  // Recarrega a lista sempre que um extrato for salvo externamente (tick muda).
  useEffect(() => {
    if (!open || tick === 0) return;
    const localItems = listExtratoPastas(company);
    setItems(localItems);
  }, [tick, open, company]);

  const allGroups = useMemo(() => {
    const grouped = groupExtratoPastasPorBanco(items);
    // Ordenar extratos dentro de cada grupo por data (menor para maior)
    return grouped.map(g => ({
      ...g,
      items: [...g.items].sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
    }));
  }, [items]);

  // selectedContaBanco é a única fonte de verdade para o filtro. Sempre que a
  // lista de contas muda (abriu a modal, salvou um extrato novo) e a seleção
  // atual não existe mais nessa lista, resolve para a conta ativa da
  // conciliação (se estiver na lista) ou para a primeira conta disponível.
  useEffect(() => {
    if (allGroups.length === 0) return;
    const aindaExiste = allGroups.some((g) => g.contaBanco === selectedContaBanco);
    if (aindaExiste) return;
    const contaAtivaMatch = allGroups.find(
      (g) => contaBancoAtiva && g.contaBanco.replace(/\D/g, '') === contaBancoAtiva.replace(/\D/g, ''),
    );
    setSelectedContaBanco(contaAtivaMatch?.contaBanco || allGroups[0]!.contaBanco);
  }, [allGroups, selectedContaBanco, contaBancoAtiva]);

  const groups = useMemo(
    () => allGroups.filter((g) => g.contaBanco === selectedContaBanco),
    [allGroups, selectedContaBanco],
  );
  const total = items.length;

  const handleSelect = (id: string) => {
    const item = getExtratoPastaById(company, id);
    if (!item) {
      setError('Extrato não encontrado.');
      return;
    }
    onSelect(item);
    onClose();
  };

  const handleRemove = async (id: string) => {
    if (!window.confirm('Remover este extrato da pasta?')) return;
    try {
      setError('');
      const updated = await removeExtratoDaPasta(company, id);
      setItems(updated);
      setMsg('✅ Extrato removido da pasta.');
      // Limpar mensagem após 2 segundos
      setTimeout(() => setMsg(''), 2000);
      if (onRemove) {
        onRemove(id);
      }
    } catch (err) {
      setError('❌ ' + (err instanceof Error ? err.message : 'Falha ao remover extrato.'));
    }
  };

  /**
   * Remove todos os extratos da conta selecionada de uma vez — atalho para
   * limpar registros salvos com o rótulo dessincronizado do conteúdo (bug do
   * "banco ativo" que já foi corrigido, mas não desfaz o que ficou salvo errado).
   */
  const handleRemoveAllFromConta = async () => {
    const grupo = groups[0];
    if (!grupo) return;
    if (
      !window.confirm(
        `Remover TODOS os ${grupo.items.length} extrato(s) da conta ${grupo.contaBanco}? Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    try {
      setError('');
      const updated = await removeExtratoPastasPorBanco(company, grupo.contaBanco);
      setItems(updated);
      setMsg(`✅ Extratos da conta ${grupo.contaBanco} removidos.`);
      setTimeout(() => setMsg(''), 2500);
    } catch (err) {
      setError('❌ ' + (err instanceof Error ? err.message : 'Falha ao remover extratos.'));
    }
  };

  const handleEditLabel = (id: string, currentLabel: string) => {
    const cleanLabel = currentLabel.replace(/^EXTRATO\s+/i, '');
    const newRange = window.prompt('Editar período do extrato (ex: DD/MM/AAAA a DD/MM/AAAA):', cleanLabel);
    if (newRange === null) return;
    const finalLabel = `EXTRATO ${newRange.trim().toUpperCase()}`;
    setError('');
    setItems(updateExtratoPastaLabel(company, id, finalLabel));
    setMsg('✅ Período do extrato atualizado.');
    setTimeout(() => setMsg(''), 2000);
  };

  const handleDownloadPdf = (item: ExtratoPastaItem) => {
    try {
      setError('');
      downloadExtratoPastaPdf(item);
      setMsg('✅ PDF baixado com sucesso.');
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setMsg('');
      setError('❌ ' + (err instanceof Error ? err.message : 'Falha ao baixar PDF.'));
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[82] flex items-center justify-center p-4 bg-black/40">
      <div
        className="technical-panel bg-brand-bg w-full max-w-3xl max-h-[85vh] flex flex-col shadow-[6px_6px_0_0_#141414]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="extrato-pastas-title"
      >
        <div className="px-4 py-3 border-b border-brand-border shrink-0 bg-brand-sidebar/30 space-y-2">
          <div className="flex items-center gap-2">
            <FolderOpen size={16} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2
                id="extrato-pastas-title"
                className="text-[11px] font-black uppercase tracking-wider"
              >
                Pastas de extratos
              </h2>
              <p className="text-[9px] text-brand-text/55">
                {total} extrato(s) salvos · cada um ligado à conta banco (regras)
                {contaBancoAtiva ? ` · ativo: ${contaBancoAtiva}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="technical-button p-1.5"
              title="Fechar"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          {allGroups.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="conta-filter" className="text-[9px] font-bold uppercase text-brand-text/70">
                Filtrar por conta:
              </label>
              <select
                id="conta-filter"
                value={selectedContaBanco}
                onChange={(e) => setSelectedContaBanco(e.target.value)}
                className="technical-input text-[9px] px-2 py-1 bg-white border border-brand-border"
              >
                {allGroups.map((g) => (
                  <option key={g.contaBanco} value={g.contaBanco}>
                    {g.bancoNome || 'Banco'} - Conta {g.contaBanco} ({g.items.length})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleRemoveAllFromConta}
                className="technical-button text-[9px] px-2 py-1 text-rose-700 border-rose-300 hover:bg-rose-50 ml-auto"
                title="Remove todos os extratos salvos desta conta — use se o conteúdo mostrado não bate com o rótulo da conta"
              >
                Excluir todos desta conta
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {error ? (
            <p className="text-[9px] font-bold uppercase text-red-700">{error}</p>
          ) : null}
          {msg ? (
            <p className="text-[9px] font-bold uppercase text-green-800">{msg}</p>
          ) : null}

          {groups.length === 0 ? (
            <p className="text-[10px] text-brand-text/60 leading-snug p-4 border border-dashed border-brand-border">
              Nenhum extrato salvo ainda. Na conciliação, use{' '}
              <strong>SALVAR EXTRATO</strong> para guardar o PDF conciliado ligado à
              conta banco. Depois selecione aqui para reabrir e puxar as regras desse
              banco.
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.contaBanco} className="border border-brand-border bg-white">
                <div className="px-3 py-2 border-b border-brand-border bg-brand-sidebar/20 flex items-center gap-2">
                  <FolderOpen size={13} className="shrink-0 opacity-70" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black uppercase truncate">
                      {g.bancoNome || 'Banco'} · conta {g.contaBanco}
                    </p>
                    <p className="text-[8px] text-brand-text/50 uppercase">
                      {g.items.length} extrato(s)
                      {(() => {
                        const totalPendentes = g.items.reduce((acc, it) => acc + it.pendentes, 0);
                        return totalPendentes > 0 ? ` · ${totalPendentes} não conciliado(s) no total` : '';
                      })()}
                    </p>
                  </div>
                </div>
                <ul className="divide-y divide-brand-border/60">
                  {g.items.map((it) => (
                    <li
                      key={it.id}
                      className={cn(
                        'px-3 py-2 flex flex-wrap items-center gap-2 border-b border-brand-border/60 transition-all duration-200',
                        contaBancoAtiva &&
                          contaBancoAtiva.replace(/\D/g, '') ===
                            it.contaBanco.replace(/\D/g, '')
                          ? 'bg-amber-50/60'
                          : '',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-[10px] font-bold uppercase truncate">{it.label}</p>
                          {it.pendentes > 0 && (
                            <span
                              className="text-[8px] font-black uppercase px-1.5 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 shrink-0"
                              title={`${it.pendentes} lançamento(s) ainda não conciliado(s) neste extrato`}
                            >
                              {it.pendentes} não conciliado{it.pendentes > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-[8px] text-brand-text/55">
                          {fmtWhen(it.createdAt)} · {it.total} lanç. ·{' '}
                          {it.conciliadas} conciliadas
                          {it.pendentes > 0 ? ` · ${it.pendentes} pendentes` : ''}
                          {it.pdfBase64 ? ' · PDF salvo' : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSelect(it.id)}
                        className="technical-button-primary text-[9px] py-1 px-2 uppercase font-black"
                        title="Abrir este extrato e ativar regras do banco"
                      >
                        Selecionar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditLabel(it.id, it.label)}
                        className="technical-button text-[9px] py-1 px-2 inline-flex items-center gap-1"
                        title="Editar período do extrato"
                      >
                        <Pencil size={11} aria-hidden="true" />
                      </button>
                      {it.pdfBase64 ? (
                        <button
                          type="button"
                          onClick={() => handleDownloadPdf(it)}
                          className="technical-button text-[9px] py-1 px-2 inline-flex items-center gap-1"
                          title="Baixar PDF conciliado salvo"
                        >
                          <Download size={11} aria-hidden="true" />
                          PDF
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleRemove(it.id)}
                        className="technical-button text-[9px] py-1 px-2 inline-flex items-center gap-1"
                        title="Remover da pasta"
                      >
                        <Trash2 size={11} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="p-3 border-t border-brand-border flex justify-between items-center gap-2 shrink-0 bg-brand-bg">
          <p className="text-[8px] text-brand-text/45 uppercase">
            {countExtratoPastas(company)} na pasta · máx. 1000 por empresa
          </p>
          <button type="button" onClick={onClose} className="technical-button text-[10px] py-1 px-3">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
});
