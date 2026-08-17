import { useEffect, useMemo, useState, useRef } from 'react';
import { LogOut, Save, Upload, Download } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ActiveTab } from '../types';
import {
  TAB_LAUNCHER_CATALOG,
  type TabLauncherEntry,
} from '../tabLauncher/tabLauncherCatalog';
import {
  getBrowserConsoleIssueCount,
  subscribeBrowserConsole,
} from '../agent/browserConsoleBridge';
import { useAuth } from '../../gestaoContabil/gestaoAuth';
import { useEyeVisionModuleAccess } from '../logic/useEyeVisionModuleAccess';
import { canAccessEyeVisionModule } from '../logic/eyeVisionAdmin';
import { BackupService } from '../../services/backupService';

export interface TabLauncherProps {
  onOpenModule: (tab: ActiveTab) => void;
}

function ModuleCard({
  entry,
  debugIssues,
  onOpen,
}: {
  entry: TabLauncherEntry;
  debugIssues: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'text-left border border-brand-border p-5 transition-all',
        'hover:bg-brand-sidebar/30 hover:shadow-[4px_4px_0_0_#141414] active:translate-x-0.5 active:translate-y-0.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            'w-12 h-12 border-2 border-brand-border flex items-center justify-center text-lg font-black shrink-0',
            entry.primary ? 'bg-brand-border text-brand-bg' : 'bg-brand-bg',
          )}
        >
          {entry.symbol}
        </div>
      </div>
      <h2 className="mt-4 text-sm font-black uppercase tracking-tight">{entry.name}</h2>
      <p className="mt-1 text-[10px] font-mono opacity-55 leading-relaxed">{entry.description}</p>
      <p className="mt-3 text-[9px] font-mono uppercase opacity-40">{entry.folder}</p>
    </button>
  );
}

export function TabLauncher({ onOpenModule }: TabLauncherProps) {
  const [debugIssueCount, setDebugIssueCount] = useState(0);
  const { user, logout } = useAuth();
  const { isAdminEmail, moduleAccess } = useEyeVisionModuleAccess();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [salvando, setSalvando] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<'success' | 'error' | 'none'>('none');

  const showStatus = (msg: string, type: 'success' | 'error') => {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => {
      setStatusMsg(null);
      setStatusType('none');
    }, 4000);
  };

  const handleExportarBackup = () => {
    try {
      BackupService.downloadBackup();
      showStatus('Backup exportado com sucesso!', 'success');
    } catch (err) {
      showStatus('Falha ao exportar backup', 'error');
    }
  };

  const handleImportarBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        const result = BackupService.importData(content);
        if (result.ok && result.failedKeys.length === 0) {
          showStatus('Backup importado! Recarregando módulos...', 'success');
          // Força um pequeno delay para o usuário ver o sucesso antes de talvez precisar atualizar manualmente ou refletir no estado
          setTimeout(() => window.location.reload(), 1500);
        } else if (result.ok) {
          // Armazenamento do navegador cheio: parte dos dados não foi gravada de verdade —
          // recarregar agora faria esses dados sumirem (só existem em memória). Mantém a
          // página como está para o usuário poder exportar/liberar espaço antes de recarregar.
          showStatus(
            `Armazenamento do navegador cheio — ${result.failedKeys.length} item(ns) do backup não couberam e não foram salvos. Libere espaço (ex.: exclua empresas não usadas) e importe de novo. Não recarregue a página agora.`,
            'error',
          );
        } else {
          showStatus('Arquivo de backup inválido.', 'error');
        }
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    let throttle: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (throttle) return;
      throttle = setTimeout(() => {
        throttle = null;
        setDebugIssueCount(getBrowserConsoleIssueCount());
      }, 2000);
    };
    setDebugIssueCount(getBrowserConsoleIssueCount());
    return subscribeBrowserConsole(bump);
  }, []);

  const visibleEntries = useMemo(() => {
    return TAB_LAUNCHER_CATALOG.filter((entry) => {
      if (entry.id === 'admin') return isAdminEmail;
      return canAccessEyeVisionModule(moduleAccess, entry.id, isAdminEmail);
    });
  }, [isAdminEmail, moduleAccess]);

  const primary = visibleEntries.filter((e) => e.primary);
  const secondary = visibleEntries.filter((e) => !e.primary);

  return (
    <div className="h-screen bg-brand-bg text-brand-text font-sans flex flex-col overflow-hidden">
      <header className="h-auto border-b border-brand-border px-6 shrink-0">
        <div className="h-14 flex items-center justify-between">
          <div className="font-black text-xl tracking-tighter">EYE VISION</div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={handleExportarBackup}
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-brand-border text-[10px] font-bold uppercase tracking-wide hover:bg-brand-sidebar"
              title="Salvar todos os dados em um arquivo JSON"
            >
              <Download size={12} />
              Exportar Saves
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-brand-border text-[10px] font-bold uppercase tracking-wide hover:bg-brand-sidebar"
              title="Importar dados de um arquivo JSON"
            >
              <Upload size={12} />
              Importar Saves
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImportarBackup}
              accept=".json"
              className="hidden"
            />

            {user ? (
              <button
                type="button"
                onClick={() => void logout()}
                className="technical-button flex items-center gap-2 text-[10px]"
                title="Sair"
              >
                <LogOut size={14} />
                Sair
              </button>
            ) : null}
          </div>
        </div>
        {statusMsg && (
          <div className="pb-1.5 flex items-center gap-2">
            <span className={cn(
              "text-[9px] font-bold uppercase",
              statusType === 'success' ? "text-emerald-600" : "text-rose-600"
            )}>
              {statusType === 'success' ? '✓' : '⚠'} {statusMsg}
            </span>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-6 md:p-10">
        <div className="max-w-5xl mx-auto space-y-8">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-50">Selecione o módulo</p>
            <h1 className="text-2xl font-black uppercase tracking-tighter mt-1">Escolha o software</h1>
            <p className="text-[11px] font-mono opacity-60 mt-2 max-w-xl">
              Cada aba roda sozinha — só o módulo escolhido carrega na memória. Use a seta para voltar aqui.
              <br />
              <span className="font-bold">Dica:</span> Use "Exportar Saves" para criar um backup local dos seus dados.
            </p>
          </div>

          {primary.length > 0 ? (
            <section>
              <h3 className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-4">Contábil</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-4">
                {primary.map((entry) => (
                  <ModuleCard
                    key={entry.id}
                    entry={entry}
                    debugIssues={0}
                    onOpen={() => onOpenModule(entry.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {secondary.length > 0 ? (
            <section>
              <h3 className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-4">Sistema</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                {secondary.map((entry) => (
                  <ModuleCard
                    key={entry.id}
                    entry={entry}
                    debugIssues={debugIssueCount}
                    onOpen={() => onOpenModule(entry.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
