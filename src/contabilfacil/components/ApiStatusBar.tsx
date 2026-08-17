import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import { getAgentApiOrigin } from '../../lib/agentApiBase';
import { FISCAL_API_BASE } from '../../services/fiscalApiBase';
import { pingBcbApi } from '../../services/bcbService';
import { notifyDebugAppHealthy } from '../agent/browserConsoleBridge';
import { deferIdle } from '../lib/deferIdle';
import { useVisibilityAwareInterval } from '../lib/useVisibilityAwareInterval';
import type { ActiveTab } from '../types';
import {
  getApiStatusRegistryForTab,
  initialApiStatusMap,
  probeAllApiStatuses,
  type ApiStatusEntry,
  type ApiStatusValue,
} from '../../services/apiStatusRegistry';

const REFRESH_MS = 120_000;

function statusDotClass(status: ApiStatusValue): string {
  if (status === 'online') return 'bg-green-600';
  if (status === 'offline') return 'bg-red-600';
  return 'bg-amber-500 animate-pulse';
}

function statusLabel(status: ApiStatusValue): string {
  if (status === 'online') return 'ON';
  if (status === 'offline') return 'OFF';
  return '…';
}

function entryPortLabel(entry: ApiStatusEntry): string | undefined {
  if (entry.id === 'receita-federal' || entry.id === 'sefaz-icms' || entry.id === 'sped') {
    if (FISCAL_API_BASE.startsWith('http')) return 'nuvem';
    if (import.meta.env.DEV) return '8780';
  }
  return entry.port;
}

function ApiStatusItem({
  entry,
  status,
  titleOverride,
}: {
  entry: ApiStatusEntry;
  status: ApiStatusValue;
  titleOverride?: string;
}) {
  const portLabel = entryPortLabel(entry);
  const title =
    titleOverride ??
    `${entry.label}${portLabel ? ` (${portLabel})` : ''}: ${status === 'online' ? 'disponível' : status === 'offline' ? 'indisponível' : 'verificando…'
    }`;

  return (
    <div
      className="flex items-center gap-1.5 shrink-0"
      title={title}
      role="status"
      aria-label={title}
    >
      <div className={cn('w-2 h-2 rounded-full shrink-0', statusDotClass(status))} />
      <span className="text-[9px] font-mono font-bold whitespace-nowrap">
        {entry.label}
        {portLabel ? ` :${portLabel}` : ''}: {statusLabel(status)}
      </span>
    </div>
  );
}

export default function ApiStatusBar({ activeTab }: { activeTab: ActiveTab }) {
  const registry = useMemo(() => getApiStatusRegistryForTab(activeTab), [activeTab]);
  const [statusMap, setStatusMap] = useState(() => initialApiStatusMap(registry));
  const [bcbTitle, setBcbTitle] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    const next = await probeAllApiStatuses(registry);
    setStatusMap(next);

    const showsBcb = registry.some((e) => e.id === 'bcb');
    if (!showsBcb) {
      setBcbTitle(undefined);
    } else {
      const live = await pingBcbApi().catch(() => false);
      if (live) setBcbTitle('BCB (remoto): API SGS online');
      else if (next.bcb === 'online') {
        setBcbTitle('BCB: API ao vivo indisponível — usando histórico embutido (Selic/PRONAMPE)');
      } else {
        setBcbTitle(undefined);
      }
    }

    notifyDebugAppHealthy();
  }, [registry]);

  useEffect(() => {
    setStatusMap(initialApiStatusMap(registry));
    deferIdle(() => void refresh(), 1500);
  }, [registry, refresh]);

  useVisibilityAwareInterval(() => void refresh(), REFRESH_MS);

  if (registry.length === 0) return null;

  return (
    <div className="w-full overflow-x-auto overflow-y-hidden">
      <div className="flex flex-nowrap items-center gap-x-4 min-w-max pr-2">
        {registry.map((entry) => (
          <ApiStatusItem
            key={entry.id}
            entry={entry}
            status={statusMap[entry.id] ?? 'checking'}
            titleOverride={entry.id === 'bcb' ? bcbTitle : undefined}
          />
        ))}
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[8px] font-mono font-bold uppercase opacity-50 hover:opacity-100 underline shrink-0 whitespace-nowrap"
          title="Atualizar status."
        >
          Atualizar
        </button>
      </div>
    </div>
  );
}
