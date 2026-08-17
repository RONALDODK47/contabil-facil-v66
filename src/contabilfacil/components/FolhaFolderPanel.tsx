import React, { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, X } from 'lucide-react';
import {
  clearFolhaImportFolder,
  isFolhaFolderConfigured,
  isFolhaFolderSupported,
  loadFolhaFolderSettings,
  pickFolhaImportFolder,
  saveFolhaFolderSettings,
  type FolhaFolderSettings,
} from '../logic/folhaFolderStore';
import { syncFolhaFromConfiguredFolder, type FolhaSyncResult } from '../logic/folhaAutomation';

type Props = {
  selectedCompany: string;
  onSynced?: () => void;
};

export default function FolhaFolderPanel({ selectedCompany, onSynced }: Props) {
  const [settings, setSettings] = useState<FolhaFolderSettings>(() =>
    loadFolhaFolderSettings(selectedCompany),
  );
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadFolhaFolderSettings(selectedCompany));
  }, [selectedCompany]);

  const formatSyncResult = (r: FolhaSyncResult): string => {
    const parts: string[] = [];
    if (r.relatorioNovos > 0) parts.push(`${r.relatorioNovos} lançamento(s) relatório`);
    if (r.payrollNovos > 0) parts.push(`${r.payrollNovos} colaborador(es)`);
    if (r.razaoGerados > 0) parts.push(`${r.razaoGerados} partida(s) no balancete`);
    if (!parts.length) parts.push('Nada novo para importar');
    return parts.join(' · ');
  };

  const runSync = async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const result = await syncFolhaFromConfiguredFolder(selectedCompany);
      setSettings(loadFolhaFolderSettings(selectedCompany));
      const msg = formatSyncResult(result);
      const pend = result.razaoPendencias.length ? ` · ${result.razaoPendencias[0]}` : '';
      setFeedback(msg + pend);
      onSynced?.();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Falha ao sincronizar pasta da folha.');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!settings.automationEnabled || !isFolhaFolderConfigured(selectedCompany)) return;
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao abrir / trocar empresa
  }, [selectedCompany]);

  const pickFolder = async () => {
    try {
      const next = await pickFolhaImportFolder(selectedCompany);
      setSettings(next);
      setFeedback(`Pasta «${next.folderLabel}» configurada.`);
      await runSync();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Não foi possível escolher a pasta.');
    }
  };

  const clearFolder = async () => {
    if (!settings.folderLabel) return;
    if (!window.confirm('Remover pasta de importação da folha configurada?')) return;
    await clearFolhaImportFolder(selectedCompany);
    setSettings(loadFolhaFolderSettings(selectedCompany));
    setFeedback(null);
  };

  const supported = isFolhaFolderSupported();

  return (
    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/30 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-widest">Pasta de importação — folha</h3>
          <p className="text-[9px] font-bold uppercase opacity-50 mt-1 max-w-2xl leading-snug">
            Coloque os TXT da folha (Domínio, TXT+ ou Nome;Salário). O sistema identifica salários, pró-labore e
            encargos (INSS, FGTS, IRRF — a recolher e a recuperar). Com as contas configuradas, lança
            automaticamente no balancete.
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
            <p className="font-bold mt-0.5">{new Date(settings.lastSyncAt).toLocaleString('pt-BR')}</p>
          </div>
        ) : null}
      </div>

      {!supported && (
        <p className="px-4 pb-3 text-[10px] text-amber-900 bg-amber-50 border-t border-amber-200">
          Use Chrome ou Edge para escolher a pasta. Você ainda pode importar manualmente na coluna ao lado.
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
