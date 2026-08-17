import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bug, Copy, Check, Trash2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { ModulePageHeader } from './ModulePageHeader';
import { cn } from '../lib/utils';
import {
  clearBrowserConsoleEntries,
  formatEntriesAsMarkdown,
  formatEntriesAsTable,
  getBrowserConsoleEntries,
  installBrowserConsoleBridge,
  subscribeBrowserConsole,
  type BrowserConsoleEntry,
  type ConsoleEntryVisibility,
  DEBUG_TABLE_RENDER_CAP,
} from '../agent/browserConsoleBridge';

type FilterMode = 'all' | 'visible' | 'hidden' | 'critical';

const KIND_LABELS: Record<BrowserConsoleEntry['kind'], string> = {
  error: 'Console error',
  warn: 'Aviso',
  unhandled: 'Não tratado',
  react: 'React',
  network: 'Rede',
  resource: 'Recurso',
  api: 'HTTP API',
  silent: 'Oculto',
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function isCritical(e: BrowserConsoleEntry): boolean {
  return e.kind !== 'warn';
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function formatEntryForCopy(entry: BrowserConsoleEntry, index: number): string {
  return [
    `#${index + 1} [${entry.kind}/${entry.visibility}] ${entry.at}`,
    `Aba: ${entry.contextLabel}`,
    entry.company ? `Empresa: ${entry.company}` : '',
    entry.source ? `Origem: ${entry.source}` : '',
    entry.url ? `URL: ${entry.url}` : '',
    entry.status != null ? `Status: ${entry.status}` : '',
    entry.message,
    entry.details ? `\nDetalhes:\n${entry.details}` : '',
    entry.stack ? `\nStack:\n${entry.stack}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export default function DebugModule() {
  const [entries, setEntries] = useState<BrowserConsoleEntry[]>(() => getBrowserConsoleEntries());
  const [filter, setFilter] = useState<FilterMode>('all');
  const [tabFilter, setTabFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    installBrowserConsoleBridge();
    setEntries(getBrowserConsoleEntries());
    return subscribeBrowserConsole(() => setEntries(getBrowserConsoleEntries()));
  }, []);

  const tabOptions = useMemo(() => {
    const labels = new Set<string>();
    for (const entry of entries) {
      if (entry.contextLabel) labels.add(entry.contextLabel);
    }
    return [...labels].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (tabFilter !== 'all' && e.contextLabel !== tabFilter) return false;
      if (filter === 'visible') return e.visibility === 'visible';
      if (filter === 'hidden') return e.visibility === 'hidden';
      if (filter === 'critical') return isCritical(e);
      return true;
    });
  }, [entries, filter, tabFilter]);

  const visibleRows = useMemo(
    () => filtered.slice(0, DEBUG_TABLE_RENDER_CAP),
    [filtered],
  );

  const stats = useMemo(() => {
    const visible = entries.filter((e) => e.visibility === 'visible').length;
    const hidden = entries.filter((e) => e.visibility === 'hidden').length;
    const critical = entries.filter(isCritical).length;
    const byTab = new Map<string, number>();
    for (const entry of entries) {
      byTab.set(entry.contextLabel, (byTab.get(entry.contextLabel) ?? 0) + 1);
    }
    return { total: entries.length, visible, hidden, critical, byTab };
  }, [entries]);

  const handleCopyRow = useCallback(async (entry: BrowserConsoleEntry, index: number) => {
    const ok = await copyText(formatEntryForCopy(entry, index));
    if (ok) {
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  const handleCopyTable = useCallback(async (asMarkdown: boolean) => {
    const text = asMarkdown ? formatEntriesAsMarkdown(filtered) : formatEntriesAsTable(filtered);
    const ok = await copyText(text);
    if (ok) {
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 2000);
    }
  }, [filtered]);

  return (
    <div className="h-full flex flex-col p-4 gap-4 min-h-0">
      <ModulePageHeader
        title="Debug"
        subtitle="Erros do navegador, API e sincronização — histórico persistente"
        actions={
          <>
            <button
              type="button"
              className="technical-button inline-flex items-center gap-2 text-[10px]"
              onClick={() => setEntries(getBrowserConsoleEntries())}
            >
              <RefreshCw size={14} />
              Atualizar
            </button>
            <button
              type="button"
              className="technical-button-primary inline-flex items-center gap-2 text-[10px]"
              onClick={() => void handleCopyTable(false)}
            >
              {copiedAll ? <Check size={14} /> : <Copy size={14} />}
              Copiar tabela
            </button>
            <button
              type="button"
              className="technical-button inline-flex items-center gap-2 text-[10px]"
              onClick={() => void handleCopyTable(true)}
            >
              <Copy size={14} />
              Copiar Markdown
            </button>
            <button
              type="button"
              className="technical-button inline-flex items-center gap-2 text-[10px]"
              onClick={() => {
                clearBrowserConsoleEntries();
                setEntries([]);
                setExpandedId(null);
              }}
            >
              <Trash2 size={14} />
              Limpar
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono shrink-0">
        <span className="inline-flex items-center gap-1.5 border border-brand-border px-2 py-1">
          <Bug size={12} />
          Total: <strong>{stats.total}</strong>
        </span>
        <span className="border border-brand-border px-2 py-1">
          Visíveis: <strong>{stats.visible}</strong>
        </span>
        <span className="border border-brand-border px-2 py-1">
          Ocultos: <strong>{stats.hidden}</strong>
        </span>
        <span className="border border-red-700/40 bg-red-50 text-red-900 px-2 py-1">
          Críticos: <strong>{stats.critical}</strong>
        </span>
        <div className="flex gap-1 ml-auto flex-wrap justify-end">
          {(['all', 'critical', 'visible', 'hidden'] as FilterMode[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'px-2 py-1 border text-[9px] font-bold uppercase',
                filter === f
                  ? 'border-brand-border bg-brand-border text-brand-bg'
                  : 'border-brand-border/40 hover:bg-brand-sidebar/20',
              )}
            >
              {f === 'all' ? 'Todos' : f === 'critical' ? 'Críticos' : f === 'visible' ? 'Visíveis' : 'Ocultos'}
            </button>
          ))}
        </div>
      </div>

      {tabOptions.length > 0 ? (
        <div className="flex flex-wrap gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setTabFilter('all')}
            className={cn(
              'px-2 py-1 border text-[9px] font-bold uppercase',
              tabFilter === 'all'
                ? 'border-brand-border bg-brand-sidebar/50'
                : 'border-brand-border/30 hover:bg-brand-sidebar/20',
            )}
          >
            Todas as abas
          </button>
          {tabOptions.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setTabFilter(label)}
              className={cn(
                'px-2 py-1 border text-[9px] font-bold uppercase max-w-[220px] truncate',
                tabFilter === label
                  ? 'border-brand-border bg-brand-sidebar/50'
                  : 'border-brand-border/30 hover:bg-brand-sidebar/20',
              )}
              title={label}
            >
              {label}
              {stats.byTab.get(label) ? ` (${stats.byTab.get(label)})` : ''}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 border border-brand-border module-table-viewport">
        <table className="w-full text-left text-[10px] font-mono border-collapse">
          <thead className="sticky top-0 z-10 bg-brand-sidebar border-b border-brand-border">
            <tr className="text-[9px] font-black uppercase tracking-wider">
              <th className="p-2 w-8" aria-label="Expandir" />
              <th className="p-2 w-10">#</th>
              <th className="p-2 w-32">Horário</th>
              <th className="p-2 w-36">Aba</th>
              <th className="p-2 w-24">Tipo</th>
              <th className="p-2 w-20">Vis.</th>
              <th className="p-2 w-24">Origem</th>
              <th className="p-2">Mensagem</th>
              <th className="p-2 w-16 text-center">Copiar</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center opacity-50 normal-case">
                  Nenhum erro capturado ainda. Erros de console, rede, recursos, promises e falhas de
                  sincronização aparecem aqui automaticamente e ficam salvos ao recarregar a página.
                </td>
              </tr>
            ) : (
              visibleRows.map((entry, index) => {
                const expanded = expandedId === entry.id;
                return (
                  <tr
                    key={entry.id}
                    className={cn(
                      'border-b border-brand-border/30 align-top hover:bg-brand-sidebar/10',
                      entry.visibility === 'hidden' && 'bg-slate-50/80',
                      isCritical(entry) && entry.kind !== 'warn' && 'bg-red-50/40',
                    )}
                  >
                    <td className="p-2">
                      <button
                        type="button"
                        className="p-0.5 border border-brand-border/40 hover:bg-brand-sidebar"
                        aria-label={expanded ? 'Recolher detalhes' : 'Expandir detalhes'}
                        onClick={() => setExpandedId(expanded ? null : entry.id)}
                      >
                        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    </td>
                    <td className="p-2 opacity-60">{index + 1}</td>
                    <td className="p-2 whitespace-nowrap text-[9px]">{formatTime(entry.at)}</td>
                    <td className="p-2 text-[9px] leading-snug">
                      <span className="font-bold block truncate max-w-[140px]" title={entry.contextLabel}>
                        {entry.contextLabel}
                      </span>
                      {entry.company ? (
                        <span className="opacity-50 block truncate max-w-[140px]" title={entry.company}>
                          {entry.company}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-2">
                      <span
                        className={cn(
                          'inline-block px-1 py-0.5 text-[8px] font-bold uppercase border',
                          entry.kind === 'warn'
                            ? 'border-amber-600/50 text-amber-900 bg-amber-50'
                            : 'border-red-700/40 text-red-900 bg-red-50',
                        )}
                      >
                        {KIND_LABELS[entry.kind]}
                      </span>
                    </td>
                    <td className="p-2">
                      <VisBadge visibility={entry.visibility} />
                    </td>
                    <td className="p-2 text-[9px] opacity-70 truncate max-w-[100px]" title={entry.source}>
                      {entry.source ?? '—'}
                    </td>
                    <td className="p-2">
                      <p className="break-words leading-relaxed">{entry.message}</p>
                      {entry.url ? (
                        <p className="text-[8px] opacity-50 mt-1 truncate max-w-lg" title={entry.url}>
                          {entry.status != null ? `[${entry.status}] ` : ''}
                          {entry.url}
                        </p>
                      ) : null}
                      {expanded && entry.details ? (
                        <pre className="text-[8px] opacity-60 mt-2 p-2 border border-brand-border/30 bg-white/80 max-h-40 overflow-auto whitespace-pre-wrap">
                          {entry.details}
                        </pre>
                      ) : null}
                      {expanded && entry.stack ? (
                        <pre className="text-[8px] opacity-50 mt-1 p-2 border border-brand-border/30 bg-white/80 max-h-48 overflow-auto whitespace-pre-wrap">
                          {entry.stack}
                        </pre>
                      ) : !expanded && entry.stack ? (
                        <pre className="text-[8px] opacity-40 mt-1 max-h-16 overflow-hidden whitespace-pre-wrap">
                          {entry.stack.slice(0, 280)}
                        </pre>
                      ) : null}
                    </td>
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        className="p-1.5 border border-brand-border/50 hover:bg-brand-sidebar inline-flex"
                        title="Copiar linha"
                        aria-label="Copiar erro"
                        onClick={() => void handleCopyRow(entry, index)}
                      >
                        {copiedId === entry.id ? (
                          <Check size={12} className="text-green-700" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[9px] font-mono opacity-50 shrink-0">
        Captura: console.error/warn, erros não tratados, React Error Boundary, falhas de fetch/HTTP,
        scripts/CSS/img quebrados, violações CSP, falhas de sync cloud e erros silenciosos (try/catch).
        Registros ficam em localStorage — erros resolvidos somem sozinhos (auth ok, sem reincidência ~90s).
        {filtered.length > DEBUG_TABLE_RENDER_CAP
          ? ` · Exibindo ${DEBUG_TABLE_RENDER_CAP} de ${filtered.length} (use Copiar para ver todos).`
          : ''}
      </p>
    </div>
  );
}

function VisBadge({ visibility }: { visibility: ConsoleEntryVisibility }) {
  return (
    <span
      className={cn(
        'text-[8px] font-bold uppercase px-1 py-0.5 border',
        visibility === 'visible'
          ? 'border-green-700/40 text-green-900 bg-green-50'
          : 'border-slate-500/40 text-slate-700 bg-slate-100',
      )}
    >
      {visibility === 'visible' ? 'Visível' : 'Oculto'}
    </span>
  );
}
