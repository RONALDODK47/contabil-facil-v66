/**
 * Seletor de token de empresa — visível apenas no módulo Administrador (modo adm).
 */
import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { useCloudAccess } from '../../gestaoContabil/useCloudAccessFallback';
import { useEyeVisionAdmin } from '../logic/useEyeVisionAdmin';
import {
  INOV_OFFICE_TOKEN,
  LEGACY_DEV_OFFICE_TOKEN,
  COMPANY_ACCESS_TOKEN_KEY,
} from '../../gestaoContabil/authContextFallback';
import { switchAdminOfficeToken } from '../logic/switchAdminOfficeToken';
import {
  collectOfficeTokens,
  formatOfficeTokenOptionLabel,
  parseEyeVisionOffices,
  readStoredCompanyAccessToken,
  resolveOfficeTokenDisplayName,
} from '../logic/eyeVisionAdmin';

function readActiveToken(): string {
  const stored = readStoredCompanyAccessToken();
  if (stored === INOV_OFFICE_TOKEN && INOV_OFFICE_TOKEN !== LEGACY_DEV_OFFICE_TOKEN) {
    return LEGACY_DEV_OFFICE_TOKEN;
  }
  return stored || LEGACY_DEV_OFFICE_TOKEN;
}

export default function AdminOfficeTokenSwitcher({ adminMode = false }: { adminMode?: boolean }) {
  const { isAdminEmail, companyToken, config } = useCloudAccess();
  const { offices } = useEyeVisionAdmin();
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('');
  const [selectedToken, setSelectedToken] = useState(readActiveToken);

  const officesMap = useMemo(() => parseEyeVisionOffices(config?.eye_vision_offices), [config]);

  const options = useMemo(() => {
    const map = new Map<string, string>();

    for (const office of offices) {
      map.set(office.token, resolveOfficeTokenDisplayName(office.token, officesMap) || office.name);
    }
    for (const tok of collectOfficeTokens(config ?? {})) {
      if (!map.has(tok)) {
        map.set(tok, resolveOfficeTokenDisplayName(tok, officesMap));
      }
    }

    map.set(LEGACY_DEV_OFFICE_TOKEN, 'INOV');
    if (INOV_OFFICE_TOKEN !== LEGACY_DEV_OFFICE_TOKEN) {
      map.delete(INOV_OFFICE_TOKEN);
    }

    return [...map.entries()]
      .map(([token, name]) => ({ token, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  }, [config, offices, officesMap]);

  const activeToken = String(companyToken || selectedToken || readActiveToken()).trim();

  useEffect(() => {
    if (INOV_OFFICE_TOKEN === LEGACY_DEV_OFFICE_TOKEN) return;
    try {
      const stored = readStoredCompanyAccessToken();
      if (stored === INOV_OFFICE_TOKEN) {
        // ⚠️ DISABLED: localStorage ZERO writes (QuotaExceededError)
        window.dispatchEvent(new CustomEvent('gc-company-token-changed'));
        setSelectedToken(LEGACY_DEV_OFFICE_TOKEN);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const stored = readActiveToken();
    if (stored) setSelectedToken(stored);
  }, [companyToken]);

  useEffect(() => {
    const sync = () => {
      const stored = readActiveToken();
      if (stored) setSelectedToken(stored);
    };
    window.addEventListener('gc-company-token-changed', sync);
    return () => window.removeEventListener('gc-company-token-changed', sync);
  }, []);

  if (!isAdminEmail || !adminMode) return null;

  const selectValue = options.some((o) => o.token === selectedToken)
    ? selectedToken
    : options.some((o) => o.token === activeToken)
      ? activeToken
      : '__custom__';

  const selectedLabel =
    selectValue === '__custom__'
      ? activeToken
      : formatOfficeTokenOptionLabel(selectValue, officesMap);

  const applyToken = async (token: string) => {
    const tok = String(token || '').trim();
    if (!tok || busy) return;

    setSelectedToken(tok);
    if (tok === activeToken) return;

    setBusy(true);
    try {
      await switchAdminOfficeToken(tok);
    } catch (err) {
      setBusy(false);
      setSelectedToken(activeToken);
      window.alert(err instanceof Error ? err.message : 'Falha ao trocar o token.');
    }
  };

  return (
    <div
      className="flex items-center gap-1.5 border border-brand-border bg-white px-2 py-1 shrink-0"
      title="Administrador: escolha o token da empresa para ver os dados salvos"
    >
      <KeyRound size={12} className="opacity-50 shrink-0" aria-hidden="true" />
      <label className="sr-only" htmlFor="admin-office-token">
        Token da empresa
      </label>
      <select
        id="admin-office-token"
        value={selectValue}
        disabled={busy}
        onChange={(e) => {
          const val = e.target.value;
          if (val === '__custom__') {
            setSelectedToken(activeToken);
            return;
          }
          setSelectedToken(val);
          void applyToken(val);
        }}
        className={[
          'text-[9px] font-mono uppercase min-w-[10rem] sm:min-w-[14rem] max-w-[16rem] sm:max-w-[20rem]',
          'border border-brand-border/60 px-2 py-1 outline-none cursor-pointer',
          'bg-brand-sidebar/20 text-brand-text font-bold',
          'focus-visible:ring-2 focus-visible:ring-brand-border',
          busy ? 'opacity-40 cursor-wait' : '',
        ].join(' ')}
        aria-label={`Token ativo: ${selectedLabel}`}
      >
        {options.map((o) => (
          <option key={o.token} value={o.token}>
            {formatOfficeTokenOptionLabel(o.token, officesMap)}
          </option>
        ))}
        {selectValue === '__custom__' && activeToken ? (
          <option value={activeToken}>
            {formatOfficeTokenOptionLabel(activeToken, officesMap)}
          </option>
        ) : null}
        <option value="__custom__">Outro token…</option>
      </select>
      {busy ? <Loader2 size={12} className="animate-spin opacity-60" aria-hidden="true" /> : null}
      <input
        type="text"
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void applyToken(custom);
          }
        }}
        placeholder="Token"
        disabled={busy}
        className="w-[4.5rem] sm:w-[5.5rem] text-[9px] font-mono border-l border-brand-border/40 pl-1.5 outline-none disabled:opacity-40"
        title="Digite outro token e Enter"
      />
    </div>
  );
}
