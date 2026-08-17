import { FormEvent, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import {
  CF_FIELD_COL,
  CF_FORM_FIELDS,
  CF_FORM_INPUT_LONG,
  CF_LABEL,
} from '../lib/formFieldClasses';
import { cn } from '../../lib/utils';
// @ts-ignore módulo JSX da gestão contábil
import { useAuth } from '../../gestaoContabil/gestaoAuth';
import { isAdminLoginEmailIdentifier } from '../../gestaoContabil/loginIdentifiersFallback';

export interface EyeVisionAdminLoginGateProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function EyeVisionAdminLoginGate({ onSuccess, onCancel }: EyeVisionAdminLoginGateProps) {
  const { isLoggingIn, authError, setAuthError, loginWithEmailPassword, isAuthenticated, user } =
    useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [awaitingResult, setAwaitingResult] = useState(false);

  const authErrorMessage = authError?.message || '';
  const isSuccessState = authError?.code === 'auth/admin-emergency-login';

  useEffect(() => {
    if (!awaitingResult || isLoggingIn) return;

    const email = String(user?.email || identifier || '').trim();
    const loginFailed =
      authError?.code &&
      authError.code !== 'auth/admin-emergency-login';

    if (loginFailed) {
      setAwaitingResult(false);
      return;
    }

    if (isAuthenticated && isAdminLoginEmailIdentifier(email)) {
      setAwaitingResult(false);
      setAuthError(null);
      onSuccess();
    }
  }, [
    awaitingResult,
    isLoggingIn,
    isAuthenticated,
    authError,
    user?.email,
    identifier,
    onSuccess,
    setAuthError,
  ]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const email = identifier.trim();
    if (!isAdminLoginEmailIdentifier(email)) {
      setAuthError({
        message: 'O acesso de administrador só é permitido para um e-mail de administrador autorizado.',
        code: 'auth/invalid-admin-email',
      });
      return;
    }
    setAwaitingResult(true);
    await loginWithEmailPassword(email, password, '');
  };

  return (
    <div className="fixed inset-0 z-[100] bg-brand-bg/95 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md technical-panel p-6 md:p-8 space-y-5 relative">
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-3 right-3 p-2 border border-brand-border hover:bg-brand-sidebar/40 transition-colors"
          aria-label="Cancelar"
        >
          <X size={16} />
        </button>

        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 border-2 border-brand-border bg-brand-border text-brand-bg">
            <ShieldCheck size={22} />
          </div>
          <h1 className="text-xl font-black tracking-tighter uppercase">Login administrador</h1>
          <p className="text-[10px] font-bold uppercase opacity-50 tracking-widest">
            Módulo administrador · credenciais cloud
          </p>
        </div>

        <div
          className={cn(
            'border border-brand-border p-3 text-xs min-h-[2.75rem]',
            authErrorMessage
              ? isSuccessState
                ? 'bg-emerald-50 text-emerald-900'
                : 'bg-red-50 text-red-800'
              : 'bg-brand-sidebar/30 opacity-70',
          )}
        >
          {authErrorMessage ||
            'Entre com o e-mail e palavra-passe de administrador. Token do escritório não é necessário.'}
        </div>

        <form className={CF_FORM_FIELDS} onSubmit={onSubmit} autoComplete="on">
          <div className={CF_FIELD_COL}>
            <label htmlFor="ev-admin-id" className={CF_LABEL}>
              E-mail administrador
            </label>
            <input
              id="ev-admin-id"
              name="email"
              type="email"
              autoComplete="username"
              className={CF_FORM_INPUT_LONG}
              value={identifier}
              onChange={(ev) => setIdentifier(ev.target.value)}
              placeholder="admin@gmail.com"
              required
            />
          </div>
          <div className={CF_FIELD_COL}>
            <label htmlFor="ev-admin-pw" className={CF_LABEL}>
              Palavra-passe
            </label>
            <input
              id="ev-admin-pw"
              name="password"
              type="password"
              autoComplete="current-password"
              className={CF_FORM_INPUT_LONG}
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            disabled={isLoggingIn || !identifier.trim() || !password.trim()}
            className="technical-button-primary w-full flex items-center justify-center gap-2"
          >
            {isLoggingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Entrar como administrador
          </button>
          <button type="button" onClick={onCancel} className="technical-button w-full">
            Voltar aos módulos
          </button>
        </form>
      </div>
    </div>
  );
}
