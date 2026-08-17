import { useState } from 'react';
import { Copy, KeyRound, Settings2, UserRound, Trash2 } from 'lucide-react';
import { ModulePageHeader } from '../ModulePageHeader';
import {
  CF_FIELD_COL,
  CF_FIELD_ROW,
  CF_FORM_INPUT_LONG,
  CF_LABEL,
} from '../../lib/formFieldClasses';
import { cn } from '../../lib/utils';
import { useEyeVisionAdmin } from '../../logic/useEyeVisionAdmin';
import {
  EYE_VISION_MODULE_LABELS,
  type EyeVisionModuleKey,
  type EyeVisionStaffUser,
} from '../../logic/eyeVisionAdmin';
import OfficePermissoesModal from './OfficePermissoesModal';

function copyText(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => {
    /* ignore */
  });
}

function formatUserModules(user: EyeVisionStaffUser): string {
  const parts = (Object.keys(EYE_VISION_MODULE_LABELS) as EyeVisionModuleKey[])
    .filter((k) => user.effectiveModuleAccess[k])
    .map((k) => EYE_VISION_MODULE_LABELS[k]);
  if (!parts.length) return 'Sem módulos';
  let text = parts.join(' · ');
  if (user.canEditModuleAccess) text += ' · pode editar abas';
  return text;
}

function UserCard({ user }: { user: EyeVisionStaffUser }) {
  return (
    <div className="border border-brand-border bg-white/80 px-3 py-2 flex items-center gap-2">
      <UserRound size={14} className="opacity-50 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-black uppercase truncate">{user.displayName}</p>
        <p className="text-[9px] font-mono opacity-50 truncate">{user.email}</p>
        <p className="text-[8px] font-bold uppercase opacity-45 mt-1">{formatUserModules(user)}</p>
      </div>
      {!user.isActive ? (
        <span className="text-[8px] font-black uppercase text-red-700 shrink-0">Inativo</span>
      ) : null}
    </div>
  );
}

function officeModulesSummary(
  moduleAccess: { manager: boolean; pricing: boolean; gestao: boolean },
): string {
  const parts = (Object.keys(EYE_VISION_MODULE_LABELS) as EyeVisionModuleKey[])
    .filter((k) => moduleAccess[k])
    .map((k) => EYE_VISION_MODULE_LABELS[k]);
  return parts.length ? parts.join(' · ') : 'Nenhum software ativo';
}

export default function AdminEmpresasPanel() {
  const {
    offices,
    usersByToken,
    createOffice,
    isCreatingOffice,
    regenerateToken,
    isRegeneratingToken,
    patchOfficeModules,
    patchUserModules,
    isPatchingOffice,
    isPatchingUser,
    deleteOffice,
    isDeletingOffice,
  } = useEyeVisionAdmin();

  const [newOfficeName, setNewOfficeName] = useState('');
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [permissoesOpen, setPermissoesOpen] = useState(false);

  const activeOffice = offices.find((o) => o.token === selectedToken) ?? offices[0] ?? null;
  const activeToken = activeOffice?.token ?? null;
  const officeUsers = activeToken ? usersByToken.get(activeToken) ?? [] : [];

  const handleCreate = async () => {
    const name = newOfficeName.trim();
    if (!name) return;
    try {
      const created = await createOffice(name);
      setNewOfficeName('');
      setSelectedToken(created.token);
      copyText(created.token);
      window.alert(`Empresa criada.\n\nToken copiado:\n${created.token}`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Não foi possível criar a empresa.');
    }
  };

  const handleRegenerate = async () => {
    if (!activeOffice) return;
    const ok = window.confirm(
      'Gerar um novo token invalida o anterior. Utilizadores precisam do token novo no login. Continuar?',
    );
    if (!ok) return;
    try {
      const newTok = await regenerateToken({ token: activeOffice.token, name: activeOffice.name });
      setSelectedToken(newTok);
      copyText(newTok);
      window.alert(`Novo token gerado e copiado:\n\n${newTok}`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Não foi possível gerar o token.');
    }
  };

  const handleDelete = async () => {
    if (!activeOffice) return;
    const ok = window.confirm(
      `Excluir cliente "${activeOffice.name}"?\n\nEsta ação removerá o acesso a esta empresa e limpará seu token. Continuar?`,
    );
    if (!ok) return;
    try {
      await deleteOffice({ token: activeOffice.token });
      setSelectedToken(null);
      setPermissoesOpen(false);
      window.alert('Empresa excluída com sucesso.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Não foi possível excluir a empresa.');
    }
  };

  return (
    <div className="space-y-4">
      <ModulePageHeader
        title="Empresas"
        subtitle="Escritórios · tokens · módulos por empresa"
      />

      <div className="technical-panel p-4 space-y-3 max-w-xl">
        <p className="text-[10px] font-black uppercase opacity-50">Criar empresa</p>
        <div className={CF_FIELD_ROW}>
          <label className={cn(CF_FIELD_COL, 'flex-1 min-w-[14rem]')}>
            <span className={CF_LABEL}>Nome da empresa</span>
            <input
              type="text"
              className={CF_FORM_INPUT_LONG}
              placeholder="Ex: Organo Contábil"
              value={newOfficeName}
              onChange={(e) => setNewOfficeName(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={isCreatingOffice || !newOfficeName.trim()}
            onClick={() => void handleCreate()}
            className="technical-button-primary self-end"
          >
            Criar empresa
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,280px)_1fr] gap-4 min-h-[var(--module-panel-height)]">
        <div className="technical-panel p-2 overflow-y-auto">
          <p className="px-2 py-1 text-[9px] font-black uppercase opacity-50">Pastas</p>
          {offices.length === 0 ? (
            <p className="px-2 py-4 text-[10px] opacity-60">Nenhuma empresa criada.</p>
          ) : (
            <div className="space-y-1">
              {offices.map((office) => (
                <button
                  key={office.token}
                  type="button"
                  onClick={() => {
                    setSelectedToken(office.token);
                    setPermissoesOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 border border-transparent text-[10px] font-black uppercase transition-colors',
                    activeToken === office.token
                      ? 'bg-brand-border text-brand-bg'
                      : 'hover:bg-brand-sidebar/30',
                  )}
                >
                  {office.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {activeOffice ? (
          <div className="technical-panel p-4 space-y-4 overflow-y-auto">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-brand-border pb-3">
              <div>
                <h2 className="text-lg font-black uppercase tracking-tight">{activeOffice.name}</h2>
                <p className="text-[9px] font-mono opacity-50 mt-1 break-all">{activeOffice.token}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyText(activeOffice.token)}
                  className="technical-button flex items-center gap-2 text-[10px]"
                >
                  <Copy size={14} />
                  Copiar token
                </button>
                <button
                  type="button"
                  disabled={isRegeneratingToken}
                  onClick={() => void handleRegenerate()}
                  className="technical-button flex items-center gap-2 text-[10px]"
                >
                  <KeyRound size={14} />
                  Gerar novo token
                </button>
                <button
                  type="button"
                  disabled={isDeletingOffice}
                  onClick={() => void handleDelete()}
                  className="technical-button flex items-center gap-2 text-[10px] text-red-700 hover:text-red-800"
                >
                  <Trash2 size={14} />
                  Excluir cliente
                </button>
              </div>
            </div>

            <div className="border border-brand-border bg-brand-sidebar/15 p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase">Módulos da empresa</p>
                  <p className="text-[9px] opacity-60 mt-1 leading-relaxed">
                    Define quais softwares e abas do Gestão Empresarial ficam disponíveis para este
                    token. Também escolha quem pode editar estas configurações.
                  </p>
                  <p className="text-[9px] font-mono opacity-50 mt-2">
                    {officeModulesSummary(activeOffice.moduleAccess)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPermissoesOpen(true)}
                  className="technical-button-primary flex items-center gap-2 text-[10px] shrink-0"
                >
                  <Settings2 size={14} />
                  Gerir abas e permissões
                </button>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase opacity-50 mb-2">
                Utilizadores ({officeUsers.length})
              </p>
              {officeUsers.length === 0 ? (
                <p className="text-[10px] opacity-60">
                  Nenhum utilizador vinculado a este token. A equipa aparece aqui após o primeiro
                  login com o token da empresa.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                  {officeUsers.map((u) => (
                    <UserCard key={u.email} user={u} />
                  ))}
                </div>
              )}
            </div>

            <OfficePermissoesModal
              open={permissoesOpen}
              office={activeOffice}
              users={officeUsers}
              isSaving={isPatchingOffice || isPatchingUser}
              onClose={() => setPermissoesOpen(false)}
              onSaveOffice={async ({ moduleAccess, gestaoTabAccess }) => {
                await patchOfficeModules({
                  token: activeOffice.token,
                  moduleAccess,
                  gestaoTabAccess,
                });
              }}
              onSaveUser={async ({ email, moduleAccess, gestaoTabAccess, canEditModuleAccess }) => {
                await patchUserModules({
                  email,
                  moduleAccess,
                  gestaoTabAccess,
                  canEditModuleAccess,
                });
              }}
            />
          </div>
        ) : (
          <div className="technical-panel p-6 flex items-center justify-center text-[10px] opacity-60">
            Crie uma empresa ou selecione uma pasta à esquerda.
          </div>
        )}
      </div>

    </div>
  );
}
