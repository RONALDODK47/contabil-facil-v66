import { Suspense, useCallback, useEffect, useState } from 'react';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { AnimatePresence, motion } from 'motion/react';
import type { ActiveTab } from './types';
import TabLoadingFallback from './components/TabLoadingFallback';
import { TabLauncher } from './components/TabLauncher';
import { ModuleShell } from './components/ModuleShell';
import { useCompanyWorkspace } from './logic/useCompanyWorkspace';
import { invalidateManagerDataCache } from './logic/companyWorkspace';
import { hydrateOfficeFromRestoreResult } from './logic/eyeVisionCloudSync';
import { safeLocalStorageSetItem } from '../lib/safeLocalStorage';
import { registerOperationalStorageLifecycle } from './logic/localFolderAutoSave';
import {
  flushAllEyeVisionPersistence,
  registerEyeVisionAutoSaveLifecycle,
} from './logic/eyeVisionPersistenceFlush';
import { resolveDebugContextFromActiveTab, setDebugContext } from './agent/debugContext';
import { notifyDebugModuleLoaded } from './agent/browserConsoleBridge';
import { AppModalProvider } from './components/AppModal';

const ManagerModule = lazyWithRetry(() => import('./components/ManagerModule'));
const FerramentasModule = lazyWithRetry(() => import('./components/FerramentasModule'));

/**
 * Build "Setup Interface" (VITE_ENABLE_ADMIN=false, via `npm run build:interface`)
 * nunca deve empacotar o código do Admin — não é só esconder o botão, o chunk
 * não pode nem existir no bundle compartilhado. Por isso o import() fica atrás
 * de um branch que o Vite consegue eliminar em build time.
 */
const ADMIN_ENABLED = import.meta.env.VITE_ENABLE_ADMIN !== 'false';
const AdminModule = ADMIN_ENABLED ? lazyWithRetry(() => import('./components/AdminModule')) : null;
const EyeVisionAdminLoginGate = ADMIN_ENABLED
  ? lazyWithRetry(() => import('./components/EyeVisionAdminLoginGate'))
  : null;

type AppView = 'launcher' | 'module';

export default function ContabilFacilApp() {
  const [view, setView] = useState<AppView>('module');
  const [activeTab, setActiveTab] = useState<ActiveTab | null>('manager');
  const [storageVersion, setStorageVersion] = useState(0);
  const [adminLoginPending, setAdminLoginPending] = useState(false);

  const {
    selectedCompany,
    setSelectedCompany,
    createCompany,
    renameCompany,
    deleteCompany,
    companyOptions,
    refreshCompanies,
    workspaceVersion,
  } = useCompanyWorkspace();

  const openModule = useCallback((tab: ActiveTab) => {
    try {
      if (tab === 'admin') {
        if (!ADMIN_ENABLED) return;
        setAdminLoginPending(true);
        return;
      }
      setActiveTab(tab);
      setView('module');
    } catch (error) {
      console.error('Erro ao abrir módulo:', error);
    }
  }, []);

  const handleAdminLoginSuccess = useCallback(() => {
    try {
      setAdminLoginPending(false);
      setActiveTab('admin');
      setView('module');
    } catch (error) {
      console.error('Erro ao processar login admin:', error);
    }
  }, []);

  const handleAdminLoginCancel = useCallback(() => {
    try {
      setAdminLoginPending(false);
    } catch (error) {
      console.error('Erro ao cancelar login admin:', error);
    }
  }, []);

  const backToLauncher = useCallback(() => {
    try {
      void flushAllEyeVisionPersistence();
      setView('launcher');
      setActiveTab(null);
    } catch (error) {
      console.error('Erro ao voltar ao launcher:', error);
      // Pelo menos tenta mudar o estado sem flush
      setView('launcher');
      setActiveTab(null);
    }
  }, []);

  const dataVersion = storageVersion + workspaceVersion;
  const bumpStorage = useCallback(() => {
    try {
      setStorageVersion((v) => v + 1);
      refreshCompanies();
    } catch (error) {
      console.error('Erro ao atualizar storage:', error);
    }
  }, [refreshCompanies]);

  useEffect(() => registerEyeVisionAutoSaveLifecycle(), []);
  useEffect(() => registerOperationalStorageLifecycle(), []);

  // Inicializa sincronização automática (salvar a cada 1 minuto)
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    void import('../lib/autoSyncScheduler').then(({ startAutoSync, stopAutoSync }) => {
      startAutoSync();
      cleanup = stopAutoSync;
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  useEffect(() => {
    const onCloudHydrated = () => {
      invalidateManagerDataCache();
      bumpStorage();
    };
    window.addEventListener('contabilfacil:data-hydrated', onCloudHydrated);
    return () => {
      window.removeEventListener('contabilfacil:data-hydrated', onCloudHydrated);
    };
  }, [bumpStorage]);

  // Escuta evento disparado pela página restore-docker.html
  // Os dados vêm via CustomEvent e são injetados via safeLocalStorage (memória),
  // nunca via localStorage.setItem direto — evita QuotaExceededError.
  useEffect(() => {
    const onDockerHydrate = (e: Event) => {
      const { office, managers, extratoPastas } = (e as CustomEvent).detail ?? {};
      if (!office) return;
      hydrateOfficeFromRestoreResult(
        office as Record<string, unknown>,
        managers ?? [],
      );
      // Pastas de extrato → também via safeLocalStorage (memória)
      if (extratoPastas && typeof extratoPastas === 'object') {
        for (const [slug, pastas] of Object.entries(extratoPastas as Record<string, unknown>)) {
          if (Array.isArray(pastas) && pastas.length > 0) {
            safeLocalStorageSetItem(
              `contabilfacil_${slug}_extrato_pastas_v1`,
              JSON.stringify(pastas),
            );
          }
        }
      }
      invalidateManagerDataCache();
      bumpStorage();
      window.dispatchEvent(new CustomEvent('contabilfacil:data-hydrated'));
    };
    window.addEventListener('contabilfacil:docker-hydrate', onDockerHydrate);
    return () => {
      window.removeEventListener('contabilfacil:docker-hydrate', onDockerHydrate);
    };
  }, [bumpStorage]);

  useEffect(() => {
    if (view !== 'module' || !activeTab) return;
    const t = window.setTimeout(() => notifyDebugModuleLoaded(), 800);
    return () => clearTimeout(t);
  }, [view, activeTab]);

  useEffect(() => {
    if (view === 'launcher') {
      setDebugContext({
        module: 'launcher',
        moduleLabel: 'Seletor de módulos',
      });
      return;
    }
    if (activeTab) {
      setDebugContext(resolveDebugContextFromActiveTab(activeTab));
    }
  }, [view, activeTab]);

  const renderModule = (tab: ActiveTab) => {
    const companyProps = {
      selectedCompany,
      companyOptions,
      onCompanyChange: setSelectedCompany,
      onCreateCompany: createCompany,
      onRenameCompany: renameCompany,
      onDeleteCompany: deleteCompany,
    };
    const commonProps = { ...companyProps, storageVersion: dataVersion };

    switch (tab) {
      case 'manager':
        return <ManagerModule key={selectedCompany || '__sem_empresa__'} {...commonProps} />;
      case 'ferramentas':
        return <FerramentasModule key={selectedCompany || '__sem_empresa__'} {...commonProps} />;
      case 'admin':
        return AdminModule ? <AdminModule /> : null;
      default:
        return null;
    }
  };

  return (
    <AppModalProvider>
      <AnimatePresence mode="wait">
        {view === 'launcher' ? (
          <motion.div
            key="launcher"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="h-screen"
          >
            <TabLauncher onOpenModule={openModule} />
          </motion.div>
        ) : activeTab ? (
          <motion.div
            key={`module-${activeTab}`}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.14 }}
            className="h-screen"
          >
            <ModuleShell activeTab={activeTab} onBack={backToLauncher} selectedCompany={selectedCompany}>
              <Suspense fallback={<TabLoadingFallback />}>{renderModule(activeTab)}</Suspense>
            </ModuleShell>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {adminLoginPending && EyeVisionAdminLoginGate ? (
        <Suspense fallback={<TabLoadingFallback />}>
          <EyeVisionAdminLoginGate
            onSuccess={handleAdminLoginSuccess}
            onCancel={handleAdminLoginCancel}
          />
        </Suspense>
      ) : null}
    </AppModalProvider>
  );
}
