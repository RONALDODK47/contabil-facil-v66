import { useRef, useState } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import type { NotaExplicativaEmpresaDados } from '../logic/notaExplicativaTypes';
import {
  extractNotaDadosFromBalancete,
  parseNotaExplicativaBalanceteFile,
  type BalanceteNotaImportResult,
} from '../logic/notaExplicativaBalanceteImport';

type Props = {
  onApply: (patch: Partial<NotaExplicativaEmpresaDados>) => void;
};

export default function NotaExplicativaBalanceteImportPanel({ onApply }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<BalanceteNotaImportResult | null>(null);
  const [fileLogs, setFileLogs] = useState<string[]>([]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setLoading(true);
    setError('');
    setPreview(null);
    setFileLogs([]);

    try {
      const { rows, logs } = await parseNotaExplicativaBalanceteFile(file);
      setFileLogs(logs);
      const result = extractNotaDadosFromBalancete(rows);
      setPreview({ ...result, logs: [...logs, ...result.logs] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar balancete.');
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleApply = () => {
    if (!preview?.patch) return;
    onApply(preview.patch);
    setPreview(null);
    setFileLogs([]);
  };

  return (
    <div className="technical-panel p-6 space-y-4 border-2 border-dashed border-brand-border/80">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h4 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
            <FileSpreadsheet size={14} />
            Importar balancete
          </h4>
          <p className="text-[9px] opacity-60 leading-relaxed max-w-xl">
            Excel (.xlsx/.xls), TXT exportação Domínio Contabilidade ou PDF com texto. O sistema analisa receita,
            patrimônio líquido, capital social e endividamento (empréstimos/financiamentos CP e LP) para preencher a
            nota explicativa.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 px-4 py-2 bg-brand-sidebar border border-brand-border text-[10px] font-black uppercase tracking-widest cursor-pointer hover:bg-brand-bg transition-colors">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {loading ? 'Analisando…' : 'Selecionar arquivo'}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.txt,.pdf"
            className="sr-only"
            disabled={loading}
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      {error && (
        <p className="text-[9px] font-bold uppercase text-red-700 bg-red-500/10 border border-red-700/30 px-3 py-2">
          {error}
        </p>
      )}

      {fileLogs.length > 0 && !preview && !error && (
        <ul className="text-[9px] opacity-70 space-y-0.5">
          {fileLogs.map((l) => (
            <li key={l}>• {l}</li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="space-y-3 border-t border-brand-border pt-4">
          <p className="text-[9px] font-bold uppercase text-emerald-800">
            {preview.contasImportadas} conta(s) · {preview.campos.length} campo(s) identificado(s)
          </p>

          {preview.campos.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[9px] border border-brand-border">
                <thead>
                  <tr className="bg-brand-sidebar/40 uppercase tracking-wider">
                    <th className="text-left p-2 border-b border-brand-border">Campo</th>
                    <th className="text-right p-2 border-b border-brand-border">Valor</th>
                    <th className="text-left p-2 border-b border-brand-border">Contas</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.campos.map((c) => (
                    <tr key={c.campo} className="border-b border-brand-border/50 last:border-0">
                      <td className="p-2 font-semibold">{c.campo}</td>
                      <td className="p-2 text-right font-mono">{c.valor}</td>
                      <td className="p-2 opacity-70 max-w-md truncate" title={c.contas.join('; ')}>
                        {c.contas.slice(0, 2).join(' · ')}
                        {c.contas.length > 2 ? ` (+${c.contas.length - 2})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[9px] opacity-60">
              Arquivo lido, mas nenhum saldo financeiro foi mapeado. Verifique se o plano usa classificação Domínio
              (grupos 2.x passivo, 3.x receita, 2.3 PL).
            </p>
          )}

          <ul className="text-[8px] opacity-50 space-y-0.5 max-h-24 overflow-y-auto">
            {preview.logs.map((l) => (
              <li key={l}>• {l}</li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={handleApply}
              disabled={preview.campos.length === 0}
              className="px-4 py-2 bg-brand-text text-brand-bg text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
            >
              Aplicar na nota
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setFileLogs([]);
              }}
              className="px-4 py-2 border border-brand-border text-[10px] font-black uppercase tracking-widest opacity-60 hover:opacity-100"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
