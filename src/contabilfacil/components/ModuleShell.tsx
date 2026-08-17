import type { ReactNode } from 'react';
import { ArrowLeft, Download, Upload, Lock, LogOut, Unlock } from 'lucide-react';
import { launcherEntry } from '../tabLauncher/tabLauncherCatalog';
import type { ActiveTab } from '../types';
import ApiStatusBar from './ApiStatusBar';
import PersistenceStatusBar from './PersistenceStatusBar';
import AdminOfficeTokenSwitcher from './AdminOfficeTokenSwitcher';
import WorkspaceOfflineBanner from './WorkspaceOfflineBanner';
import { useCloudAccess } from '../../gestaoContabil/useCloudAccessFallback';
import { useAuth } from '../../gestaoContabil/gestaoAuth';
import { useState, useEffect, useRef } from 'react';
import {
  fecharPeriodoContabil,
  isValidBrDate,
  reabrirPeriodoContabil,
  readAutomatizacaoContaConfig,
  type AutomacaoContaConfig,
} from '../../extratoVision/utils/automatizacaoContaConfig';
import { BackupService } from '../../services/backupService';
import { cn } from '../../lib/utils';
import { saveFolderHandleForKey, loadFolderHandleForKey } from '../../lib/localFolderDbHandleStore';

const EXPORT_DIR_KEY = 'backup-export-dir';
const IMPORT_DIR_KEY = 'backup-import-dir';

function formatIsoParaExibicao(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface ModuleShellProps {
  activeTab: ActiveTab;
  onBack: () => void;
  children: ReactNode;
  selectedCompany?: string;
}

export function ModuleShell({ activeTab, onBack, children, selectedCompany }: ModuleShellProps) {
  const meta = launcherEntry(activeTab);
  const { user, logout } = useAuth();
  const { isAdminEmail } = useCloudAccess();
  const adminMode = activeTab === 'admin' && isAdminEmail;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [periodoConfig, setPeriodoConfig] = useState<AutomacaoContaConfig>({});
  const [periodoPanelOpen, setPeriodoPanelOpen] = useState(false);
  const [fecharDraft, setFecharDraft] = useState('');
  const [fecharErro, setFecharErro] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<'success' | 'error' | 'none'>('none');
  const [exportDirHandle, setExportDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [importDirHandle, setImportDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const supportsFsAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  useEffect(() => {
    if (!supportsFsAccess) return;
    loadFolderHandleForKey(EXPORT_DIR_KEY).then((h) => h && setExportDirHandle(h));
    loadFolderHandleForKey(IMPORT_DIR_KEY).then((h) => h && setImportDirHandle(h));
  }, [supportsFsAccess]);

  const showStatus = (msg: string, type: 'success' | 'error') => {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => {
      setStatusMsg(null);
      setStatusType('none');
    }, 4000);
  };

  const handleExportarBackup = async () => {
    if ('showSaveFilePicker' in window) {
      try {
        const suggestedName = `backup_gestao_contabil_${new Date().toISOString().split('T')[0]}.json`;
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName,
          startIn: exportDirHandle ?? 'downloads',
          types: [{ description: 'Backup JSON', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(BackupService.exportAllData(exportDirHandle?.name));
        await writable.close();
        showStatus(`Backup salvo em: ${fileHandle.name}`, 'success');
      } catch (err: any) {
        if (err?.name !== 'AbortError') showStatus('Erro ao exportar', 'error');
      }
      return;
    }
    try {
      BackupService.downloadBackup(exportDirHandle?.name);
      showStatus('Backup exportado!', 'success');
    } catch (err) {
      showStatus('Erro ao exportar', 'error');
    }
  };

  const handleEscolherPastaExportar = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      setExportDirHandle(handle);
      await saveFolderHandleForKey(EXPORT_DIR_KEY, handle);
      showStatus(`Pasta de exportação definida: ${handle.name}`, 'success');
    } catch {
      // usuário cancelou o seletor — ok ignorar
    }
  };

  const handleEscolherPastaImportar = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
      setImportDirHandle(handle);
      await saveFolderHandleForKey(IMPORT_DIR_KEY, handle);
      showStatus(`Pasta de importação definida: ${handle.name}`, 'success');
    } catch {
      // usuário cancelou o seletor — ok ignorar
    }
  };

  const aplicarBackupImportado = (content: string) => {
    const result = BackupService.importData(content);
    if (result.ok && result.failedKeys.length === 0) {
      showStatus('Sucesso! Recarregando...', 'success');
      setTimeout(() => window.location.reload(), 1500);
    } else if (result.ok) {
      // Armazenamento do navegador cheio — parte dos dados só existe em memória agora.
      // Não recarrega: recarregar faria esses dados sumirem antes de serem salvos de verdade.
      showStatus(
        `Armazenamento do navegador cheio — ${result.failedKeys.length} item(ns) não foram salvos. Libere espaço e importe de novo sem recarregar a página.`,
        'error',
      );
    } else {
      showStatus('Backup inválido', 'error');
    }
  };

  const handleImportarBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') aplicarBackupImportado(content);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClickImportar = async () => {
    if (importDirHandle && 'showOpenFilePicker' in window) {
      try {
        const [fileHandle] = await (window as any).showOpenFilePicker({
          startIn: importDirHandle,
          types: [{ description: 'Backup JSON', accept: { 'application/json': ['.json'] } }],
        });
        const file = await fileHandle.getFile();
        const content = await file.text();
        aplicarBackupImportado(content);
      } catch {
        // usuário cancelou o seletor — ok ignorar
      }
      return;
    }
    fileInputRef.current?.click();
  };

  useEffect(() => {
    if (selectedCompany) {
      setPeriodoConfig(readAutomatizacaoContaConfig(selectedCompany));
    }
  }, [selectedCompany]);

  useEffect(() => {
    const sync = () => {
      if (selectedCompany) {
        setPeriodoConfig(readAutomatizacaoContaConfig(selectedCompany));
      }
    };
    window.addEventListener('contabilfacil:config-updated', sync);
    return () => window.removeEventListener('contabilfacil:config-updated', sync);
  }, [selectedCompany]);

  const historicoPeriodoFechado = periodoConfig.historicoPeriodoFechado ?? [];
  const fechamentoAtivo = historicoPeriodoFechado.find((h) => !h.reabertoEmIso);

  const formatBrDateMaskPeriodo = (val: string): string => {
    const clean = val.replace(/\D/g, '').slice(0, 8);
    if (clean.length >= 5) return `${clean.slice(0, 2)}/${clean.slice(2, 4)}/${clean.slice(4)}`;
    if (clean.length >= 3) return `${clean.slice(0, 2)}/${clean.slice(2)}`;
    return clean;
  };

  const handleFecharPeriodo = () => {
    if (!selectedCompany) return;
    const val = fecharDraft.trim();
    if (!isValidBrDate(val)) {
      setFecharErro('Informe uma data válida no formato DD/MM/AAAA.');
      return;
    }
    setFecharErro(null);
    const next = fecharPeriodoContabil(selectedCompany, val);
    setPeriodoConfig(next);
    setFecharDraft('');
    window.dispatchEvent(new CustomEvent('contabilfacil:config-updated'));
  };

  const handleReabrirPeriodo = (id: string) => {
    if (!selectedCompany) return;
    const next = reabrirPeriodoContabil(selectedCompany, id);
    setPeriodoConfig(next);
    window.dispatchEvent(new CustomEvent('contabilfacil:config-updated'));
  };

  return (
    <div className="h-screen bg-brand-bg text-brand-text font-sans flex flex-col overflow-hidden">
      <header className="border-b border-brand-border px-4 md:px-6 shrink-0">
        <div className="h-14 flex items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-2 px-3 py-2 border border-brand-border hover:bg-brand-sidebar transition-colors shrink-0"
              aria-label="Voltar à seleção de módulos"
            >
              <ArrowLeft size={18} />
              <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Módulos</span>
            </button>
            <div className="h-8 w-px bg-brand-border opacity-30 shrink-0 hidden sm:block" />
            <div className="min-w-0">
              <p className="text-[9px] font-mono uppercase opacity-40 truncate">{meta?.folder ?? 'modules'}</p>
              <p className="text-sm font-black uppercase tracking-tight truncate">{meta?.name ?? activeTab}</p>
            </div>
          </div>

          <div className="flex items-start gap-2 shrink-0">
          {activeTab === 'manager' && selectedCompany && (
            <div className="relative mr-2 flex flex-col items-stretch gap-0.5">
              <button
                type="button"
                onClick={() => setPeriodoPanelOpen((v) => !v)}
                className={
                  fechamentoAtivo
                    ? 'flex items-center gap-1.5 px-2.5 py-1.5 border border-green-800/40 bg-green-50 text-green-800 text-[10px] font-bold uppercase tracking-wide'
                    : 'flex items-center gap-1.5 px-2.5 py-1.5 border border-brand-border text-[10px] font-bold uppercase tracking-wide hover:bg-brand-sidebar'
                }
                title="Fechar ou reabrir período contábil"
              >
                {fechamentoAtivo ? <Lock size={12} /> : <Unlock size={12} />}
                {fechamentoAtivo ? `Fechado até ${fechamentoAtivo.ate}` : 'Período Fechado'}
              </button>
              {supportsFsAccess && <span className="h-[13px]" aria-hidden="true" />}

              {periodoPanelOpen && (
                <>
                  <div className="fixed inset-0 z-[299]" onClick={() => setPeriodoPanelOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-[300] w-80 technical-panel bg-brand-bg shadow-[6px_6px_0_0_#141414] p-3 space-y-3 text-left">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest">Período Fechado</p>
                      <p className="text-[9px] opacity-60 leading-snug mt-0.5">
                        Bloqueia edição e lançamentos até a data informada — só é possível mexer a partir do mês
                        seguinte à data de fechamento.
                      </p>
                    </div>

                    {fechamentoAtivo ? (
                      <div className="flex items-center justify-between gap-2 border border-green-800/30 bg-green-50 px-2 py-1.5">
                        <span className="text-[10px] font-mono font-bold text-green-800">
                          Fechado até {fechamentoAtivo.ate}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleReabrirPeriodo(fechamentoAtivo.id)}
                          className="technical-button text-[9px] py-1 px-2"
                        >
                          Reabrir
                        </button>
                      </div>
                    ) : (
                      <p className="text-[9px] opacity-50">Nenhum período fechado no momento.</p>
                    )}

                    <div>
                      <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                        Fechar período até
                      </label>
                      <div className="flex flex-wrap gap-2 items-end">
                        <input
                          type="text"
                          value={fecharDraft}
                          onChange={(e) => {
                            setFecharDraft(formatBrDateMaskPeriodo(e.target.value));
                            if (fecharErro) setFecharErro(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleFecharPeriodo();
                            }
                          }}
                          placeholder="DD/MM/AAAA"
                          className="flex-1 min-w-[110px] px-2 py-1.5 bg-white border border-brand-border text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-brand-border"
                          aria-label="Nova data de fechamento"
                        />
                        <button
                          type="button"
                          onClick={handleFecharPeriodo}
                          className="technical-button-primary text-[10px] py-1.5 px-3"
                        >
                          Fechar
                        </button>
                      </div>
                      {fecharErro && <p className="text-[9px] font-bold text-rose-600 mt-1">{fecharErro}</p>}
                    </div>

                    {historicoPeriodoFechado.length > 0 && (
                      <div>
                        <p className="text-[9px] font-bold uppercase opacity-50 mb-1">Histórico de fechamentos</p>
                        <ul className="max-h-40 overflow-y-auto divide-y divide-brand-border/20 border border-brand-border/30">
                          {historicoPeriodoFechado.map((h) => (
                            <li key={h.id} className="px-2 py-1.5 text-[9px] leading-snug">
                              <span className="font-mono font-bold">Até {h.ate}</span>
                              <span className="opacity-50"> · fechado em {formatIsoParaExibicao(h.fechadoEmIso)}</span>
                              {h.reabertoEmIso && (
                                <span className="opacity-50"> · reaberto em {formatIsoParaExibicao(h.reabertoEmIso)}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

            <div className="flex flex-col items-stretch gap-0.5">
              <button
                type="button"
                onClick={handleExportarBackup}
                className="flex items-center gap-1.5 px-2.5 py-1.5 border border-brand-border text-[10px] font-bold uppercase tracking-wide hover:bg-brand-sidebar"
                title={exportDirHandle ? `Exportar backup JSON (pasta: ${exportDirHandle.name})` : 'Exportar backup JSON'}
              >
                <Download size={12} />
                Exportar
              </button>
              {supportsFsAccess && (
                <button
                  type="button"
                  onClick={handleEscolherPastaExportar}
                  className="text-[9px] font-mono underline opacity-70 hover:opacity-100 text-center"
                  title={exportDirHandle ? `Pasta atual: ${exportDirHandle.name}` : 'Pasta padrão (Downloads)'}
                >
                  escolher pasta
                </button>
              )}
            </div>

            <div className="flex flex-col items-stretch gap-0.5">
              <button
                type="button"
                onClick={handleClickImportar}
                className="flex items-center gap-1.5 px-2.5 py-1.5 border border-brand-border text-[10px] font-bold uppercase tracking-wide hover:bg-brand-sidebar"
                title={importDirHandle ? `Importar backup JSON (pasta: ${importDirHandle.name})` : 'Importar backup JSON'}
              >
                <Upload size={12} />
                Importar
              </button>
              {supportsFsAccess && (
                <button
                  type="button"
                  onClick={handleEscolherPastaImportar}
                  className="text-[9px] font-mono underline opacity-70 hover:opacity-100 text-center"
                  title={importDirHandle ? `Pasta atual: ${importDirHandle.name}` : 'Pasta padrão (seletor de arquivo)'}
                >
                  escolher pasta
                </button>
              )}
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImportarBackup}
              accept=".json"
              className="hidden"
            />

            {adminMode ? (
              <AdminOfficeTokenSwitcher adminMode />
            ) : null}
            {user ? (
              <div className="flex flex-col items-stretch gap-0.5">
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 border border-brand-border text-[10px] font-bold uppercase tracking-wide hover:bg-brand-sidebar"
                  title="Sair"
                >
                  <LogOut size={12} />
                  <span className="hidden sm:inline">Sair</span>
                </button>
                {supportsFsAccess && <span className="h-[13px]" aria-hidden="true" />}
              </div>
            ) : null}
          </div>
        </div>
        {statusMsg && (
          <div className="pb-1.5 px-4 md:px-6 flex items-center gap-2">
            <span className={cn(
              "text-[9px] font-bold uppercase",
              statusType === 'success' ? "text-emerald-600" : "text-rose-600"
            )}>
              {statusType === 'success' ? '✓' : '⚠'} {statusMsg}
            </span>
          </div>
        )}
      </header>

      {activeTab !== 'admin' ? <WorkspaceOfflineBanner /> : null}

      <main className="flex-1 overflow-y-auto bg-white/60 p-4 md:p-6">
        {children}
      </main>

      <footer className="border-t border-brand-border bg-brand-sidebar shrink-0">
        <div className="h-7 flex items-center justify-between px-6 text-[9px] font-mono opacity-60">
          <span className="uppercase truncate">{meta?.folder}</span>
          <span className="font-bold">v2.5 · módulo isolado</span>
        </div>
      </footer>
    </div>
  );
}
