import { FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from './gestaoAuth';

export default function EyeVisionStaffLogin() {
  const { isLoggingIn, authError, loginWithGoogle, loginWithEmailPassword } = useAuth();

  const onGoogleLogin = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    // Token será definido automaticamente pelo email após o login
    await loginWithGoogle('');
  };

  const authErrorMessage = authError?.message || '';

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-lg font-black uppercase tracking-tight">Entrar</h1>
          <p className="text-[11px] text-gray-500">
            Cada pessoa tem seus próprios dados, isolados pela conta Google.
          </p>
        </div>

        {authErrorMessage ? (
          <div className="p-3 text-xs bg-red-50 text-red-700 border border-red-200 rounded">
            {authErrorMessage}
          </div>
        ) : null}

        <form onSubmit={onGoogleLogin} className="space-y-4">
          <button
            type="submit"
            disabled={isLoggingIn}
            className="w-full py-3 px-4 bg-white text-gray-600 font-bold border border-gray-300 hover:bg-gray-50 flex items-center justify-center gap-3 transition-colors text-xs tracking-wider uppercase disabled:opacity-50 cursor-pointer"
          >
            {isLoggingIn ? (
              <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
            ) : (
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
            )}
            {isLoggingIn ? 'A CONECTAR…' : 'ENTRAR COM A CONTA GOOGLE'}
          </button>
        </form>

        <div className="pt-2 text-center border-t border-gray-100">
          <button
            onClick={async () => {
              await loginWithEmailPassword('ronaldo.silva@inovssc.com.br', '123', 'INOV');
            }}
            className="text-xs text-blue-600 hover:text-blue-500 font-bold tracking-wider uppercase cursor-pointer"
          >
            Entrar como Desenvolvedor (Bypass)
          </button>
        </div>
      </div>
    </div>
  );
}
