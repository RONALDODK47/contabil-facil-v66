/**
 * AppModal — modal próprio do sistema que substitui alert() e confirm() do navegador.
 *
 * Uso:
 *   const { openModal, openConfirm } = useAppModal();
 *   openModal({ title: 'Sucesso', body: <p>Lançamentos enviados!</p>, type: 'success' });
 *   const ok = await openConfirm({ title: 'Confirmar?', body: <p>Deseja continuar?</p> });
 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { X, CheckCircle2, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ModalType = 'info' | 'success' | 'warning' | 'error';

export interface ModalOptions {
  title: string;
  body: ReactNode;
  type?: ModalType;
  okLabel?: string;
  /** If true, shows Cancel button and resolves with boolean */
  confirm?: boolean;
  cancelLabel?: string;
  /** Extra wide modal for tables/lists */
  wide?: boolean;
}

interface ModalState extends ModalOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface AppModalContextValue {
  /** Show an informational/success/warning modal. Returns a promise that resolves when dismissed. */
  openModal: (opts: ModalOptions) => Promise<void>;
  /** Show a confirm dialog. Returns true if confirmed, false if cancelled. */
  openConfirm: (opts: Omit<ModalOptions, 'confirm'>) => Promise<boolean>;
}

const AppModalContext = createContext<AppModalContextValue | null>(null);

export function useAppModal(): AppModalContextValue {
  const ctx = useContext(AppModalContext);
  if (!ctx) throw new Error('useAppModal must be used within <AppModalProvider>');
  return ctx;
}

// ─── Icon helper ─────────────────────────────────────────────────────────────

function ModalIcon({ type }: { type: ModalType }) {
  const cls = 'shrink-0 mt-0.5';
  if (type === 'success') return <CheckCircle2 className={cn(cls, 'text-emerald-400')} size={20} />;
  if (type === 'warning') return <AlertTriangle className={cn(cls, 'text-amber-400')} size={20} />;
  if (type === 'error')   return <AlertCircle   className={cn(cls, 'text-red-400')}    size={20} />;
  return <Info className={cn(cls, 'text-sky-400')} size={20} />;
}

// ─── Modal UI ────────────────────────────────────────────────────────────────

function ModalDialog({
  modal,
  onClose,
}: {
  modal: ModalState;
  onClose: (ok: boolean) => void;
}) {
  const type = modal.type ?? 'info';
  const accentMap: Record<ModalType, string> = {
    info:    'border-sky-500/30',
    success: 'border-emerald-500/30',
    warning: 'border-amber-500/30',
    error:   'border-red-500/30',
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={() => !modal.confirm && onClose(true)}
    >
      {/* Panel */}
      <div
        className={cn(
          'relative bg-[#0f0f0f] border text-white shadow-2xl',
          'animate-in fade-in zoom-in-95 duration-150',
          accentMap[type],
          modal.wide ? 'w-full max-w-3xl' : 'w-full max-w-md',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-white/10">
          <ModalIcon type={type} />
          <h2 className="flex-1 text-sm font-black uppercase tracking-widest leading-tight">
            {modal.title}
          </h2>
          {!modal.confirm && (
            <button
              type="button"
              onClick={() => onClose(true)}
              aria-label="Fechar"
              className="text-white/40 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-4 text-[13px] text-white/80 max-h-[60vh] overflow-y-auto">
          {modal.body}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-3 border-t border-white/10 bg-white/5">
          {modal.confirm && (
            <button
              type="button"
              onClick={() => onClose(false)}
              className="px-5 py-2 text-[11px] font-black uppercase tracking-widest border border-white/20 text-white/60 hover:border-white/50 hover:text-white transition-all"
            >
              {modal.cancelLabel ?? 'CANCELAR'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onClose(true)}
            className={cn(
              'px-6 py-2 text-[11px] font-black uppercase tracking-widest transition-all',
              type === 'error'
                ? 'bg-red-700 hover:bg-red-600 text-white'
                : type === 'warning'
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-white text-black hover:bg-white/90',
            )}
          >
            {modal.okLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function AppModalProvider({ children }: { children: ReactNode }) {
  const [modals, setModals] = useState<ModalState[]>([]);
  const counterRef = useRef(0);

  const push = useCallback(
    (opts: ModalOptions): Promise<boolean> =>
      new Promise((resolve) => {
        const id = ++counterRef.current;
        setModals((prev) => [...prev, { ...opts, id, resolve }]);
      }),
    [],
  );

  const handleClose = useCallback((id: number, ok: boolean) => {
    setModals((prev) => {
      const modal = prev.find((m) => m.id === id);
      modal?.resolve(ok);
      return prev.filter((m) => m.id !== id);
    });
  }, []);

  const openModal = useCallback(
    async (opts: ModalOptions) => {
      await push(opts);
    },
    [push],
  );

  const openConfirm = useCallback(
    (opts: Omit<ModalOptions, 'confirm'>): Promise<boolean> =>
      push({ ...opts, confirm: true }),
    [push],
  );

  return (
    <AppModalContext.Provider value={{ openModal, openConfirm }}>
      {children}
      {modals.map((modal) => (
        <ModalDialog key={modal.id} modal={modal} onClose={(ok) => handleClose(modal.id, ok)} />
      ))}
    </AppModalContext.Provider>
  );
}
