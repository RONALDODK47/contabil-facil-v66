import React, { useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';
import { descricaoCfop } from '../logic/fiscalCfopCatalog';
import { classificarNotaFiscal } from '../logic/fiscalNotaAcumuladorClass';
import {
  buildFiscalNotaAcumuladorArvore,
  type FiscalNotaAcumuladorBucket,
  type FiscalNotaAcumuladorSecao,
} from '../logic/fiscalNotaAcumuladorTree';
import type { FiscalSpedArquivoLike } from '../logic/fiscalAcumuladorModel';
import { notaFiscalRotulo } from '../logic/fiscalAcumuladorModel';
import type { FiscalNotaBloqueioConfig } from '../logic/fiscalNotaBloqueio';
import type { FiscalContaPar } from '../logic/fiscalContasImposto';
import type { FiscalAcumuladorContasMap } from '../logic/fiscalAcumuladorContasStorage';
import { patchFiscalAcumuladorConta } from '../logic/fiscalAcumuladorContasStorage';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from './ExtratoContaPicker';
import { CF_INPUT_ACCOUNT } from '../lib/formFieldClasses';
import { fiscalDataNoIntervalo } from '../logic/fiscalDateFilter';
import type { SpedNotaFiscal } from '../../extratoVision/utils/spedNotasFiscaisParser';

type Props = {
  arquivos: FiscalSpedArquivoLike[];
  bloqueio?: FiscalNotaBloqueioConfig;
  dataInicio: string;
  dataFim: string;
  selectedCompany: string;
  acumuladorContas: FiscalAcumuladorContasMap;
  onAcumuladorContasChange: (next: FiscalAcumuladorContasMap) => void;
  planoOptions: ExtratoPlanoContaOption[];
  expanded: Record<string, boolean>;
  onToggleExpand: (id: string) => void;
};

function filtrarNotas(
  notas: SpedNotaFiscal[],
  dataInicio: string,
  dataFim: string,
): SpedNotaFiscal[] {
  if (!dataInicio && !dataFim) return notas;
  return notas.filter((nf) =>
    fiscalDataNoIntervalo(nf.data || '', dataInicio || undefined, dataFim || undefined),
  );
}

function NotasTable({ notas }: { notas: SpedNotaFiscal[] }) {
  if (notas.length === 0) {
    return (
      <p className="text-[9px] text-slate-500 uppercase px-2 py-3">Nenhuma NF no período.</p>
    );
  }
  return (
    <table className="w-full text-left text-[10px] font-mono border border-brand-border/30">
      <thead>
        <tr className="text-[8px] font-black uppercase opacity-60 bg-brand-sidebar/20">
          <th className="px-2 py-1.5 border-b border-brand-border/30">NF / Fornecedor</th>
          <th className="px-2 py-1.5 border-b border-brand-border/30">CFOP / Tipo</th>
          <th className="px-2 py-1.5 border-b border-brand-border/30">Data</th>
          <th className="px-2 py-1.5 border-b border-brand-border/30 text-right">Valor</th>
          <th className="px-2 py-1.5 border-b border-brand-border/30 text-right">ICMS</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-brand-border/10">
        {notas.map((nf) => {
          const classif = classificarNotaFiscal(nf);
          const cfopLabel = nf.cfop
            ? `${nf.cfop} — ${descricaoCfop(nf.cfop)}`
            : `Sem CFOP · ${classif.titulo}`;
          return (
          <tr key={`${nf.linha}-${nf.chave || nf.numero}`} className="hover:bg-brand-sidebar/10">
            <td className="px-2 py-1.5 max-w-[220px] truncate" title={notaFiscalRotulo(nf)}>
              {notaFiscalRotulo(nf)}
            </td>
            <td
              className={cn(
                'px-2 py-1.5 max-w-[180px] truncate text-[8px]',
                !nf.cfop && 'text-amber-800',
              )}
              title={cfopLabel}
            >
              {cfopLabel}
            </td>
            <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{nf.data || '—'}</td>
            <td className="px-2 py-1.5 text-right tabular-nums font-bold">
              {formatCurrency(nf.valorTotal ?? 0)}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums opacity-80">
              {(nf.valorIcms ?? 0) > 0 ? formatCurrency(nf.valorIcms ?? 0) : '—'}
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BucketContas({
  bucketKey,
  contas,
  planoOptions,
  onPatch,
}: {
  bucketKey: string;
  contas: FiscalContaPar;
  planoOptions: ExtratoPlanoContaOption[];
  onPatch: (key: string, field: 'debito' | 'credito', value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
      <div>
        <label className="block text-[8px] font-bold uppercase opacity-50 mb-1">Conta débito</label>
        {planoOptions.length > 0 ? (
          <ExtratoContaPicker
            value={contas.debito}
            options={planoOptions}
            onChange={(v) => onPatch(bucketKey, 'debito', v)}
            placeholder={contas.debito || 'Opcional'}
          />
        ) : (
          <input
            type="text"
            className={CF_INPUT_ACCOUNT}
            value={contas.debito}
            onChange={(e) => onPatch(bucketKey, 'debito', e.target.value)}
          />
        )}
      </div>
      <div>
        <label className="block text-[8px] font-bold uppercase opacity-50 mb-1">Conta crédito</label>
        {planoOptions.length > 0 ? (
          <ExtratoContaPicker
            value={contas.credito}
            options={planoOptions}
            onChange={(v) => onPatch(bucketKey, 'credito', v)}
            placeholder={contas.credito || 'Opcional'}
          />
        ) : (
          <input
            type="text"
            className={CF_INPUT_ACCOUNT}
            value={contas.credito}
            onChange={(e) => onPatch(bucketKey, 'credito', e.target.value)}
          />
        )}
      </div>
    </div>
  );
}

function BucketRow({
  bucket,
  notas,
  isOpen,
  contas,
  planoOptions,
  onToggle,
  onPatch,
}: {
  bucket: FiscalNotaAcumuladorBucket;
  notas: SpedNotaFiscal[];
  isOpen: boolean;
  contas: FiscalContaPar;
  planoOptions: ExtratoPlanoContaOption[];
  onToggle: () => void;
  onPatch: (key: string, field: 'debito' | 'credito', value: string) => void;
}) {
  return (
    <li className="border-b border-brand-border/10 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-2.5 flex flex-wrap items-center gap-3 hover:bg-brand-sidebar/10 transition-colors pl-8"
      >
        {isOpen ? (
          <ChevronDown size={12} className="shrink-0 opacity-60" />
        ) : (
          <ChevronRight size={12} className="shrink-0 opacity-60" />
        )}
        <div className="flex-1 min-w-[180px]">
          <p className="text-[10px] font-black uppercase">{bucket.titulo ?? 'Acumulador'}</p>
          <p className="text-[8px] opacity-50 mt-0.5 normal-case leading-snug">{bucket.subtitulo ?? ''}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] font-bold tabular-nums">{formatCurrency(bucket.totais?.valor ?? 0)}</p>
          <p className="text-[8px] uppercase opacity-60 mt-0.5">
            {notas.length} NF{notas.length !== 1 ? 's' : ''}
          </p>
        </div>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pl-12 bg-brand-sidebar/5 space-y-3">
          <BucketContas
            bucketKey={bucket.bucketKey}
            contas={contas}
            planoOptions={planoOptions}
            onPatch={onPatch}
          />
          <NotasTable notas={notas} />
        </div>
      )}
    </li>
  );
}

function SecaoRow({
  secao,
  bucketsFiltrados,
  expanded,
  onToggle,
  acumuladorContas,
  planoOptions,
  onPatch,
  dataInicio,
  dataFim,
}: {
  secao: FiscalNotaAcumuladorSecao;
  bucketsFiltrados: FiscalNotaAcumuladorBucket[];
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  acumuladorContas: FiscalAcumuladorContasMap;
  planoOptions: ExtratoPlanoContaOption[];
  onPatch: (key: string, field: 'debito' | 'credito', value: string) => void;
  dataInicio: string;
  dataFim: string;
}) {
  const isOpen = Boolean(expanded[secao.id]);
  const bucketsComNotas = (bucketsFiltrados ?? [])
    .map((b) => ({
      bucket: b,
      notas: filtrarNotas(b.notasFiscais ?? [], dataInicio, dataFim),
    }))
    .filter(({ notas }) => notas.length > 0 || (!dataInicio && !dataFim));
  const totalNotas = bucketsComNotas.reduce((s, { notas }) => s + notas.length, 0);
  const temFiltro = Boolean(dataInicio || dataFim);
  if (temFiltro && totalNotas === 0) return null;

  const totalValor = bucketsComNotas.reduce(
    (s, { notas }) => s + notas.reduce((acc, n) => acc + Math.abs(n.valorTotal ?? 0), 0),
    0,
  );
  const nomesAcumuladores = bucketsComNotas.map(({ bucket }) => bucket.titulo ?? '').join(' · ');

  return (
    <li className="bg-brand-bg border-b border-brand-border/20">
      <button
        type="button"
        onClick={() => onToggle(secao.id)}
        className={cn(
          'w-full text-left px-4 py-3 flex flex-wrap items-center gap-3 hover:bg-brand-sidebar/10 transition-colors',
          secao.sentido === 'entrada' ? 'bg-emerald-50/40' : 'bg-blue-50/30',
        )}
      >
        {isOpen ? (
          <ChevronDown size={14} className="shrink-0 opacity-60" />
        ) : (
          <ChevronRight size={14} className="shrink-0 opacity-60" />
        )}
        <div className="flex-1 min-w-[200px]">
          <p className="text-[11px] font-black uppercase tracking-widest">{secao.titulo ?? '—'}</p>
          <p className="text-[8px] opacity-50 mt-0.5 normal-case">{secao.subtitulo ?? ''}</p>
          {!isOpen && bucketsComNotas.length > 0 ? (
            <p className="text-[8px] opacity-60 mt-1 normal-case line-clamp-2">{nomesAcumuladores}</p>
          ) : null}
          <p className="text-[8px] opacity-50 mt-0.5 uppercase">
            {bucketsComNotas.length} acumulador(es) · {totalNotas} nota(s)
          </p>
        </div>
        <p className="text-[10px] font-bold tabular-nums">
          {totalNotas > 0 ? formatCurrency(totalValor) : '—'}
        </p>
      </button>
      {isOpen && (
        <ul className="border-t border-brand-border/10">
          {bucketsComNotas.length === 0 ? (
            <li className="px-4 py-6 text-center text-[9px] text-slate-400 uppercase">
              Nenhuma nota nesta seção.
            </li>
          ) : (
            bucketsComNotas.map(({ bucket, notas }) => {
              const contas =
                acumuladorContas[bucket.bucketKey] ??
                (bucket.bucketKey === 'NF|ENTRADA|REVENDA'
                  ? acumuladorContas['NF|ENTRADA|MERCADORIA']
                  : undefined) ??
                { debito: '', credito: '' };
              return (
                <BucketRow
                  key={bucket.id}
                  bucket={bucket}
                  notas={notas}
                  isOpen={Boolean(expanded[bucket.id])}
                  contas={contas}
                  planoOptions={planoOptions}
                  onToggle={() => onToggle(bucket.id)}
                  onPatch={onPatch}
                />
              );
            })
          )}
        </ul>
      )}
    </li>
  );
}

export default function FiscalNotaAcumuladoresTree({
  arquivos,
  bloqueio,
  dataInicio,
  dataFim,
  selectedCompany,
  acumuladorContas,
  onAcumuladorContasChange,
  planoOptions,
  expanded,
  onToggleExpand,
}: Props) {
  const arvore = useMemo(
    () => buildFiscalNotaAcumuladorArvore(arquivos, bloqueio),
    [arquivos, bloqueio],
  );

  const onPatch = useCallback(
    (key: string, field: 'debito' | 'credito', value: string) => {
      onAcumuladorContasChange(patchFiscalAcumuladorConta(selectedCompany, key, { [field]: value }));
    },
    [onAcumuladorContasChange, selectedCompany],
  );

  if (arvore.every((s) => s.totalNotas === 0)) {
    return (
      <p className="py-12 text-center text-slate-400 uppercase text-[10px] px-4">
        Nenhuma nota fiscal C100. Importe o SPED na aba <strong className="text-brand-text">Importações</strong>.
      </p>
    );
  }

  const secoesVisiveis = arvore.filter((secao) => {
    if (!dataInicio && !dataFim) return true;
    return secao.buckets.some((b) =>
      filtrarNotas(b.notasFiscais, dataInicio, dataFim).length > 0,
    );
  });

  if (secoesVisiveis.length === 0) {
    return (
      <p className="py-12 text-center text-slate-400 uppercase text-[10px] px-4">
        Nenhuma nota no período selecionado.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-brand-border/15">
      {arvore.map((secao) => (
        <SecaoRow
          key={secao.id}
          secao={secao}
          bucketsFiltrados={secao.buckets}
          expanded={expanded}
          onToggle={onToggleExpand}
          acumuladorContas={acumuladorContas}
          planoOptions={planoOptions}
          onPatch={onPatch}
          dataInicio={dataInicio}
          dataFim={dataFim}
        />
      ))}
    </ul>
  );
}
