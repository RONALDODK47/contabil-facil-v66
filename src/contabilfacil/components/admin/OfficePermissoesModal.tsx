import { useEffect, useMemo, useState } from 'react';
import { Settings2, X } from 'lucide-react';
import { GESTAO_PAGES } from '../../../gestaoContabil/gestaoPages';
import { cn } from '../../lib/utils';
import {
  EYE_VISION_MODULE_LABELS,
  type EyeVisionModuleAccess,
  type EyeVisionModuleKey,
  type EyeVisionOfficeView,
  type EyeVisionStaffUser,
  type GestaoTabAccess,
} from '../../logic/eyeVisionAdmin';

type Props = {
  open: boolean;
  office: EyeVisionOfficeView;
  users: EyeVisionStaffUser[];
  isSaving: boolean;
  onClose: () => void;
  onSaveOffice: (payload: {
    moduleAccess: EyeVisionModuleAccess;
    gestaoTabAccess: GestaoTabAccess;
  }) => Promise<void>;
  onSaveUser: (payload: {
    email: string;
    moduleAccess: EyeVisionModuleAccess;
    gestaoTabAccess: GestaoTabAccess;
    canEditModuleAccess: boolean;
  }) => Promise<void>;
};

function moduleSummary(access: EyeVisionModuleAccess): string {
  const parts = (Object.keys(EYE_VISION_MODULE_LABELS) as EyeVisionModuleKey[])
    .filter((k) => access[k])
    .map((k) => EYE_VISION_MODULE_LABELS[k]);
  return parts.length ? parts.join(' · ') : 'Nenhum';
}

function gestaoTabsSummary(access: GestaoTabAccess): string {
  const enabled = GESTAO_PAGES.filter((p) => access[p.id] !== false);
  if (enabled.length === GESTAO_PAGES.length) return 'Todas as abas';
  if (!enabled.length) return 'Nenhuma aba';
  return `${enabled.length} aba(s)`;
}

export default function OfficePermissoesModal({
  open,
  office,
  users,
  isSaving,
  onClose,
  onSaveOffice,
  onSaveUser,
}: Props) {
  const [moduleAccess, setModuleAccess] = useState(office.moduleAccess);
  const [gestaoTabAccess, setGestaoTabAccess] = useState(office.gestaoTabAccess);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [userModules, setUserModules] = useState<EyeVisionModuleAccess | null>(null);
  const [userGestaoTabs, setUserGestaoTabs] = useState<GestaoTabAccess | null>(null);
  const [userCanEdit, setUserCanEdit] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setModuleAccess(office.moduleAccess);
    setGestaoTabAccess(office.gestaoTabAccess);
    setSelectedEmail(null);
    setUserModules(null);
    setUserGestaoTabs(null);
    setUserCanEdit(false);
    setFeedback(null);
  }, [open, office]);

  const selectedUser = useMemo(
    () => users.find((u) => u.email === selectedEmail) ?? null,
    [selectedEmail, users],
  );

  useEffect(() => {
    if (!selectedUser) {
      setUserModules(null);
      setUserGestaoTabs(null);
      setUserCanEdit(false);
      return;
    }
    setUserModules({ ...selectedUser.moduleAccess });
    setUserGestaoTabs({ ...selectedUser.gestaoTabAccess });
    setUserCanEdit(selectedUser.canEditModuleAccess);
  }, [selectedUser]);

  if (!open) return null;

  const toggleOfficeModule = (key: EyeVisionModuleKey) => {
    setModuleAccess((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleOfficeGestaoTab = (id: (typeof GESTAO_PAGES)[number]['id']) => {
    setGestaoTabAccess((prev) => ({ ...prev, [id]: !(prev[id] !== false) }));
  };

  const toggleUserModule = (key: EyeVisionModuleKey) => {
    if (!userModules) return;
    setUserModules({ ...userModules, [key]: !userModules[key] });
  };

  const toggleUserGestaoTab = (id: (typeof GESTAO_PAGES)[number]['id']) => {
    if (!userGestaoTabs) return;
    setUserGestaoTabs({ ...userGestaoTabs, [id]: !(userGestaoTabs[id] !== false) });
  };

  const saveOffice = async () => {
    try {
      await onSaveOffice({ moduleAccess, gestaoTabAccess });
      setFeedback('Permissões da empresa aplicadas.');
      window.setTimeout(() => setFeedback(null), 2500);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Não foi possível salvar.');
    }
  };

  const saveUser = async () => {
    if (!selectedUser || !userModules || !userGestaoTabs) return;
    try {
      await onSaveUser({
        email: selectedUser.email,
        moduleAccess: userModules,
        gestaoTabAccess: userGestaoTabs,
        canEditModuleAccess: userCanEdit,
      });
      setFeedback(`Permissões de ${selectedUser.displayName} aplicadas.`);
      window.setTimeout(() => setFeedback(null), 2500);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Não foi possível salvar.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[240] flex items-center justify-center p-4 bg-brand-text/40"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col technical-panel shadow-[8px_8px_0_0_#141414] bg-brand-bg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-brand-border flex items-start justify-between gap-2 bg-brand-sidebar/30">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
              <Settings2 size={14} />
              Abas e permissões — {office.name}
            </h3>
            <p className="text-[9px] font-mono opacity-50 mt-1 break-all">{office.token}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 border border-brand-border hover:bg-brand-border hover:text-brand-bg"
            aria-label="Fechar"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <section className="border border-brand-border bg-brand-sidebar/15 p-4 space-y-3">
            <div>
              <p className="text-[10px] font-black uppercase">Softwares desta empresa</p>
              <p className="text-[9px] opacity-60 mt-1">
                Quais mini softwares aparecem no launcher para quem usa este token.
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              {(Object.keys(EYE_VISION_MODULE_LABELS) as EyeVisionModuleKey[]).map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-2 text-[10px] font-black uppercase cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="accent-brand-border"
                    checked={moduleAccess[key]}
                    onChange={() => toggleOfficeModule(key)}
                  />
                  {EYE_VISION_MODULE_LABELS[key]}
                </label>
              ))}
            </div>
            <p className="text-[9px] font-mono opacity-50">Ativo: {moduleSummary(moduleAccess)}</p>
          </section>

          {moduleAccess.gestao && (
            <section className="border border-brand-border bg-white p-4 space-y-3">
              <div>
                <p className="text-[10px] font-black uppercase">Abas do Gestão Empresarial</p>
                <p className="text-[9px] opacity-60 mt-1">
                  Sidebar interna do módulo Gestão — calendário, empresas, chat, etc.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {GESTAO_PAGES.map((page) => (
                  <label
                    key={page.id}
                    className="flex items-center gap-2 text-[9px] font-bold uppercase cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="accent-brand-border shrink-0"
                      checked={gestaoTabAccess[page.id] !== false}
                      onChange={() => toggleOfficeGestaoTab(page.id)}
                    />
                    <span className="truncate">{page.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-[9px] font-mono opacity-50">{gestaoTabsSummary(gestaoTabAccess)}</p>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void saveOffice()}
              className="technical-button-primary text-[10px] px-5"
            >
              Aplicar empresa
            </button>
            {feedback?.includes('empresa') && (
              <span className="text-[10px] font-bold text-green-800">{feedback}</span>
            )}
          </div>

          <section className="border border-brand-border bg-brand-sidebar/15 p-4 space-y-3">
            <div>
              <p className="text-[10px] font-black uppercase">Utilizadores</p>
              <p className="text-[9px] opacity-60 mt-1">
                Restrinja abas por pessoa e escolha quem pode editar estas configurações.
              </p>
            </div>

            {users.length === 0 ? (
              <p className="text-[10px] opacity-60">
                Nenhum utilizador vinculado. Após o primeiro login com o token, a equipa aparece aqui.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {users.map((u) => (
                    <button
                      key={u.email}
                      type="button"
                      onClick={() => setSelectedEmail(u.email)}
                      className={cn(
                        'text-[10px] font-black uppercase px-3 py-1.5 border border-brand-border transition-colors',
                        selectedEmail === u.email
                          ? 'bg-brand-border text-brand-bg'
                          : 'bg-white hover:bg-brand-sidebar/30',
                      )}
                    >
                      {u.displayName}
                    </button>
                  ))}
                </div>

                {selectedUser && userModules && userGestaoTabs ? (
                  <div className="border border-brand-border bg-white p-4 space-y-4">
                    <div>
                      <p className="text-xs font-black uppercase">{selectedUser.displayName}</p>
                      <p className="text-[9px] font-mono opacity-50">{selectedUser.email}</p>
                    </div>

                    <label className="flex items-center gap-2 text-[10px] font-black uppercase cursor-pointer border border-brand-border/40 p-2 bg-amber-50/50">
                      <input
                        type="checkbox"
                        className="accent-brand-border"
                        checked={userCanEdit}
                        onChange={() => setUserCanEdit((v) => !v)}
                      />
                      Pode editar abas desta empresa
                    </label>

                    <div>
                      <p className="text-[9px] font-black uppercase opacity-50 mb-2">Softwares</p>
                      <div className="flex flex-wrap gap-3">
                        {(Object.keys(EYE_VISION_MODULE_LABELS) as EyeVisionModuleKey[]).map((key) => (
                          <label
                            key={key}
                            className={cn(
                              'flex items-center gap-2 text-[9px] font-bold uppercase cursor-pointer',
                              !moduleAccess[key] && 'opacity-40 pointer-events-none',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="accent-brand-border"
                              checked={userModules[key] && moduleAccess[key]}
                              disabled={!moduleAccess[key]}
                              onChange={() => toggleUserModule(key)}
                            />
                            {EYE_VISION_MODULE_LABELS[key]}
                          </label>
                        ))}
                      </div>
                    </div>

                    {moduleAccess.gestao && (
                      <div>
                        <p className="text-[9px] font-black uppercase opacity-50 mb-2">
                          Abas Gestão Empresarial
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {GESTAO_PAGES.map((page) => {
                            const officeOk = gestaoTabAccess[page.id] !== false;
                            return (
                              <label
                                key={page.id}
                                className={cn(
                                  'flex items-center gap-2 text-[9px] font-bold uppercase cursor-pointer',
                                  !officeOk && 'opacity-40 pointer-events-none',
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className="accent-brand-border shrink-0"
                                  checked={officeOk && userGestaoTabs[page.id] !== false}
                                  disabled={!officeOk}
                                  onChange={() => toggleUserGestaoTab(page.id)}
                                />
                                <span className="truncate">{page.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => void saveUser()}
                      className="technical-button-primary text-[10px] px-5"
                    >
                      Aplicar utilizador
                    </button>
                  </div>
                ) : (
                  <p className="text-[10px] opacity-60">Selecione um utilizador para ajustar permissões.</p>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="px-4 py-3 border-t border-brand-border flex justify-end gap-2 bg-brand-sidebar/30">
          <button type="button" onClick={onClose} className="technical-button text-[10px]">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
