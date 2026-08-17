import React, { useEffect, useState } from 'react';
import { loadFiscalNfeCache } from '../logic/fiscalNfeStorage';
import { formatCurrency } from '../lib/utils';

type Props = {
  selectedCompany: string;
};

export default function FiscalImpostosPanel({ selectedCompany }: Props) {
  const [cache, setCache] = useState<any | undefined>(() => loadFiscalNfeCache(selectedCompany));

  useEffect(() => {
    setCache(loadFiscalNfeCache(selectedCompany));
  }, [selectedCompany]);

  const creditos = cache?.creditosSugeridos ?? [];
  const total = creditos.reduce((s: number, c: any) => s + (Number(c.valor) || 0), 0);

  return (
    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/30 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-widest">Impostos importados</h3>
          <p className="text-[9px] font-bold uppercase opacity-50 mt-0.5 max-w-3xl">Créditos e tributos extraídos dos XMLs importados.</p>
        </div>
        <div className="text-[9px] font-mono opacity-70">{creditos.length} item(s) · Total {formatCurrency(total)}</div>
      </div>

      <div className="p-4 overflow-x-auto">
        {creditos.length === 0 ? (
          <p className="text-[9px] font-mono opacity-60">Nenhum imposto ou crédito sugerido importado neste período.</p>
        ) : (
          <table className="w-full min-w-[720px] text-left text-[9px] font-mono">
            <thead>
              <tr className="border-b border-brand-border/40 text-[8px] font-black uppercase opacity-60">
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Fundamento</th>
                <th className="px-3 py-2">Regime</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Chave</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border/10">
              {creditos.map((c: any, i: number) => (
                <tr key={`${c.chave}-${c.tipo}-${i}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{c.tipo}</td>
                  <td className="px-3 py-2 max-w-[420px] truncate" title={c.fundamento}>{c.fundamento}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.regime || '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatCurrency(c.valor)}</td>
                  <td className="px-3 py-2 font-mono text-[8px] opacity-70 max-w-[200px] truncate" title={c.chave}>{c.chave}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
