import React, { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, X } from 'lucide-react';
import {
  clearFiscalPgdasImportFolder,
  isFiscalPgdasFolderConfigured,
  isFiscalPgdasFolderSupported,
  loadFiscalPgdasFolderSettings,
  pickFiscalPgdasImportFolder,
  type FiscalPgdasFolderSettings,
} from '../logic/fiscalPgdasFolderStore';
import {
  syncFiscalPgdasFromConfiguredFolder,
  type FiscalPgdasSyncResult,
} from '../logic/fiscalPgdasAutomation';

type Props = {
  selectedCompany: string;
  onSynced?: () => void;
};

export default function FiscalPgdasFolderPanel({ selectedCompany, onSynced }: Props) {
  const [settings, setSettings] = useState<FiscalPgdasFolderSettings>(() =>
    loadFiscalPgdasFolderSettings(selectedCompany),
  );
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadFiscalPgdasFolderSettings(selectedCompany));
  }, [selectedCompany]);

  const formatSyncResult = (r: FiscalPgdasSyncResult): string => {
    const parts: string[] = [];
    if (r.imported > 0) parts.push(`${r.imported} PGDAS-D novo(s)`);
    if (r.replaced > 0) parts.push(`${r.replaced} período(s) atualizado(s)`);
    if (r.skipped > 0) parts.push(`${r.skipped} já no balancete`);
    if (r.razaoGerados > 0) parts.push(`${r.razaoGerados} lançamento(s) no balancete`);
    if (!parts.length) parts.push('Nada novo para importar');
    return parts.join(' · ');
  };

  const runSync = async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const result = await syncFiscalPgdasFromConfiguredFolder(selectedCompany);
      setSettings(loadFiscalPgdasFolderSettings(selectedCompany));
      const msg = formatSyncResult(result);
      const pend = result.razaoPendencias.length ? ` · ${result.razaoPendencias[0]}` : '';
      setFeedback(msg + pend);
      onSynced?.();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Falha ao sincronizar pasta PGDAS-D.');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!settings.automationEnabled || !isFiscalPgdasFolderConfigured(selectedCompany)) return;
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao abrir / trocar empresa
  }, [selectedCompany]);

  const pickFolder = async () => {
    try {
      const next = await pickFiscalPgdasImportFolder(selectedCompany);
      setSettings(next);
      setFeedback(`Pasta «${next.folderLabel}» configurada.`);
      await runSync();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Não foi possível escolher a pasta.');
    }
  };

  const clearFolder = async () => {
    if (!settings.folderLabel) return;
    if (!window.confirm('Remover pasta de importação PGDAS-D configurada?')) return;
    await clearFiscalPgdasImportFolder(selectedCompany);
    setSettings(loadFiscalPgdasFolderSettings(selectedCompany));
    setFeedback(null);
  };

  const supported = isFiscalPgdasFolderSupported();

  return (
    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/30 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-widest">Pasta de importação PGDAS-D</h3>
          <p className="text-[9px] font-bold uppercase opacity-50 mt-1 max-w-2xl leading-snug">
            Coloque os extratos PGDAS-D (PDF, TXT ou REC) em subpastas por mês. O sistema entra em{' '}
            <strong className="text-brand-text">todas as subpastas</strong>, em qualquer nível, encontra os
            arquivos e importa o mais recente de cada período.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {supported ? (
            <button
              type="button"
              onClick={() => void pickFolder()}
              className="technical-button-primary text-[10px] px-3 py-2 flex items-center gap-2 font-bold"
            >
              <FolderOpen size={14} />
              Escolher pasta
            </button>
          ) : null}
          {settings.folderLabel ? (
            <>
              <button
                type="button"
                disabled={syncing}
                onClick={() => void runSync()}
                className="technical-button text-[10px] px-3 py-2 flex items-center gap-2 font-bold"
              >
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
              </button>
              <button
                type="button"
                onClick={() => void clearFolder()}
                className="technical-button border-red-800 text-red-800 text-[10px] px-2 py-2"
                aria-label="Remover pasta"
              >
                <X size={14} />
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="px-4 py-3 flex flex-wrap gap-6 text-[10px] font-mono">
        <div>
          <span className="opacity-50 uppercase text-[9px] font-black">Pasta</span>
          <p className="font-bold mt-0.5">{settings.folderLabel || '— não configurada —'}</p>
        </div>
        {settings.lastSyncAt ? (
          <div>
            <span className="opacity-50 uppercase text-[9px] font-black">Última sync</span>
            <p className="font-bold mt-0.5">
              {new Date(settings.lastSyncAt).toLocaleString('pt-BR')}
            </p>
          </div>
        ) : null}
      </div>

      {!supported && (
        <p className="px-4 pb-3 text-[10px] text-amber-900 bg-amber-50 border-t border-amber-200">
          Use Chrome ou Edge para escolher a pasta e clique em Sincronizar agora.
        </p>
      )}

      {feedback && (
        <p className="px-4 py-2 text-[10px] font-bold uppercase text-emerald-900 bg-emerald-50 border-t border-emerald-200">
          {feedback}
        </p>
      )}
    </div>
  );
}
