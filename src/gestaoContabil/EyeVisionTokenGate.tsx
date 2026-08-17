import { FormEvent, useState } from 'react';
import { CF_FIELD_COL, CF_FORM_FIELDS, CF_FORM_INPUT_LONG, CF_LABEL } from '../contabilfacil/lib/formFieldClasses';
import { flushAllEyeVisionPersistence } from '../contabilfacil/logic/eyeVisionPersistenceFlush';
import { clearEyeVisionOperationalLocalStorage } from '../lib/simuladorFullBackup';
import { useAuth } from './gestaoAuth';
import { useCloudAccess } from './useCloudAccessFallback';

export default function EyeVisionTokenGate() {
  const { logout } = useAuth();
  const { requiredCompanyTokens } = useCloudAccess();
  const [newTokenInput, setNewTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleUpdateToken = async (e: FormEvent) => {
    e.preventDefault();
    const tok = String(newTokenInput || '').trim();
    if (!tok) {
      setTokenError('Por favor, introduza o token.');
      return;
    }
    const tokenList = (requiredCompanyTokens || [])
      .map((t: string) => String(t || '').trim())
      .filter(Boolean);

    // Qualquer token com 4+ caracteres é aceite — dados são puxados independente do token
    let isPortalTokenValid = false;
    if (tok.length >= 4) {
      isPortalTokenValid = true;
    }

    if (!isPortalTokenValid && tokenList.length > 0 && !tokenList.includes(tok)) {
      setTokenError('Token inválido. Confirme com o administrador.');
      return;
    }

    setSaving(true);
    try {
      await flushAllEyeVisionPersistence();
      clearEyeVisionOperationalLocalStorage();
      localStorage.setItem('gc_company_access_token', tok);
      window.dispatchEvent(new CustomEvent('gc-company-token-changed'));
    } catch {
      setTokenError('Falha ao guardar dados do token anterior. Tente novamente.');
      setSaving(false);
      return;
    }
    setTokenError('');
    setSaving(false);
  };

  return (
    <div className="h-screen bg-brand-bg text-brand-text font-sans flex flex-col overflow-hidden">
      <header className="h-14 border-b border-brand-border px-6 flex items-center shrink-0">
        <div className="font-black text-xl tracking-tighter">EYE VISION</div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 md:p-10 flex items-center justify-center">
        <div className="w-full max-w-md technical-panel p-6 md:p-8 space-y-4">
          <div>
            <h1 className="text-2xl font-black tracking-tighter uppercase italic">Token alterado</h1>
            <p className="mt-2 text-xs opacity-70 leading-relaxed">
              O token foi alterado na cloud ou está incorreto. Introduza o novo token fornecido pelo
              administrador para continuar.
            </p>
          </div>

          <form className={CF_FORM_FIELDS} onSubmit={handleUpdateToken}>
            <div className={CF_FIELD_COL}>
              <label htmlFor="ev-new-token" className={CF_LABEL}>
                Novo token
              </label>
              <input
                id="ev-new-token"
                type="text"
                autoComplete="off"
                placeholder="Ex: CGE-XXXX-YYYY"
                className={CF_FORM_INPUT_LONG}
                value={newTokenInput}
                onChange={(e) => {
                  setNewTokenInput(e.target.value);
                  setTokenError('');
                }}
                required
              />
              {tokenError ? (
                <p className="text-[10px] text-red-700 font-mono">{tokenError}</p>
              ) : null}
            </div>

            <button type="submit" className="technical-button-primary w-full" disabled={saving}>
              {saving ? 'A guardar e a trocar…' : 'Confirmar e aceder'}
            </button>
            <button type="button" onClick={() => void logout()} className="technical-button w-full">
              Voltar ao login / sair
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
