import { useMemo, useRef, useState } from 'react';
import { ListOrdered, Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  loadAplicacaoContasExtrato,
  removeAplicacaoContaExtrato,
  upsertAplicacaoContaExtrato,
  type AplicacaoContaExtrato,
} from '../logic/aplicacaoExtratoStorage';
import type { AplicacaoExtratoRow } from '../logic/aplicacaoExtratoParser';
import {
  filterAplicacaoRegrasPorConta,
  loadAplicacaoRegrasContas,
  matchAplicacaoRegra,
  type AplicacaoRegraConta,
} from '../logic/aplicacaoRegrasContasStorage';
import AplicacaoRegrasContasModal from './AplicacaoRegrasContasModal';

function formatCurrency(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildEmptyConta(nome: string): AplicacaoContaExtrato {
  return { id: '', nome, saldoAnteriorManual: null, rows: [], atualizadoEm: '' };
}

type Props = {
  selectedCompany: string;
};

export default function AplicacaoConciliacaoTab({ selectedCompany }: Props) {
  const [contas, setContas] = useState<AplicacaoContaExtrato[]>(() =>
    loadAplicacaoContasExtrato(selectedCompany),
  );
  const [activeContaId, setActiveContaId] = useState<string>(() => contas[0]?.id ?? '');
  const [novaContaNome, setNovaContaNome] = useState('');
  const [saldoAnteriorInput, setSaldoAnteriorInput] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [regrasModalOpen, setRegrasModalOpen] = useState(false);
  const [regras, setRegras] = useState<AplicacaoRegraConta[]>(() =>
    loadAplicacaoRegrasContas(selectedCompany),
  );

  const fileInputXlsxRef = useRef<HTMLInputElement>(null);

  const activeConta = useMemo(
    () => contas.find((c) => c.id === activeContaId) ?? buildEmptyConta(''),
    [contas, activeContaId],
  );
  const regrasDaConta = useMemo(
    () => filterAplicacaoRegrasPorConta(regras, activeConta.nome),
    [regras, activeConta.nome],
  );
  /** Amostra no mesmo formato do extrato bancário (histórico + natureza + valor). */
  const extratoSample = useMemo(
    () =>
      activeConta.rows.map((r) => ({
        description: r.historico,
        nature: (r.saida > 0 ? 'C' : 'D') as 'D' | 'C',
        value: r.saida > 0 ? r.saida : r.entrada,
      })),
    [activeConta.rows],
  );

  const persistContas = (next: AplicacaoContaExtrato[]) => {
    setContas(next);
  };

  const handleCriarConta = () => {
    const nome = novaContaNome.trim();
    if (!nome) return;
    const next = upsertAplicacaoContaExtrato(selectedCompany, { nome });
    persistContas(next);
    const created = next.find((c) => c.nome === nome);
    if (created) setActiveContaId(created.id);
    setNovaContaNome('');
  };

  const handleRemoverConta = (id: string) => {
    const next = removeAplicacaoContaExtrato(selectedCompany, id);
    persistContas(next);
    if (activeContaId === id) setActiveContaId(next[0]?.id ?? '');
  };

  const applyRowsToActiveConta = (rows: AplicacaoExtratoRow[], saldoAnterior?: number | null) => {
    if (!activeConta.id) {
      setStatusMsg('Crie/selecione uma conta de aplicação antes de importar.');
      return;
    }
    const next = upsertAplicacaoContaExtrato(selectedCompany, {
      id: activeConta.id,
      nome: activeConta.nome,
      saldoAnteriorManual: saldoAnterior ?? activeConta.saldoAnteriorManual,
      rows: [...activeConta.rows, ...rows],
    });
    persistContas(next);
  };

  const handleSalvarSaldoAnterior = () => {
    if (!activeConta.id) return;
    const val = Number(saldoAnteriorInput.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(val)) return;
    const next = upsertAplicacaoContaExtrato(selectedCompany, {
      id: activeConta.id,
      nome: activeConta.nome,
      saldoAnteriorManual: val,
    });
    persistContas(next);
    setSaldoAnteriorInput('');
  };

  const handleLimparLancamentos = () => {
    if (!activeConta.id) return;
    const next = upsertAplicacaoContaExtrato(selectedCompany, {
      id: activeConta.id,
      nome: activeConta.nome,
      rows: [],
    });
    persistContas(next);
  };

  return (
    <div className="space-y-6">
      <div className="technical-panel p-5 shadow-[4px_4px_0_0_#141414] space-y-3">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-border">
          Contas de Aplicação
        </h4>
        <p className="text-[9px] font-mono opacity-60">
          Cada conta de aplicação (produto/CDB/poupança) tem seu próprio saldo anterior, extrato e regras —
          igual à conciliação de extrato bancário, sem consolidar entre contas.
        </p>
        <div className="flex flex-wrap gap-2">
          {contas.map((c) => (
            <div key={c.id} className="flex items-center">
              <button
                type="button"
                onClick={() => setActiveContaId(c.id)}
                className={cn(
                  'px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border border-brand-border',
                  c.id === activeContaId ? 'bg-brand-border text-brand-bg' : 'bg-white hover:bg-brand-border/10',
                )}
              >
                {c.nome}
              </button>
              <button
                type="button"
                onClick={() => handleRemoverConta(c.id)}
                className="p-1.5 border border-l-0 border-brand-border text-red-800 hover:bg-red-800 hover:text-white"
                title="Remover conta"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={novaContaNome}
            onChange={(e) => setNovaContaNome(e.target.value)}
            placeholder="Ex.: SICREDINVEST EXCLUSIVO"
            className={cn('text-[10px] uppercase', 'flex-1 border border-brand-border px-2 py-1.5 bg-white')}
          />
          <button type="button" onClick={handleCriarConta} className="technical-button flex items-center gap-1 px-3">
            <Plus size={12} /> Nova Conta
          </button>
        </div>
      </div>

      {activeConta.id ? (
        <>
          <div className="technical-panel p-5 shadow-[4px_4px_0_0_#141414] space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={saldoAnteriorInput}
                onChange={(e) => setSaldoAnteriorInput(e.target.value)}
                placeholder="Saldo anterior manual (ex.: 200000,00)"
                className="text-[10px] flex-1 border border-brand-border px-2 py-1.5 bg-white"
              />
              <button type="button" onClick={handleSalvarSaldoAnterior} className="technical-button px-3">
                Salvar
              </button>
            </div>

            {statusMsg && <p className="text-[9px] font-mono opacity-70 border-t border-brand-border/30 pt-2">{statusMsg}</p>}

            <div className="flex items-center justify-between border-t border-brand-border/30 pt-2">
              <button
                type="button"
                onClick={() => setRegrasModalOpen(true)}
                className="technical-button flex items-center gap-1.5 px-3"
              >
                <ListOrdered size={13} /> Regras de Conciliação ({regrasDaConta.length})
              </button>
              {activeConta.rows.length > 0 && (
                <button
                  type="button"
                  onClick={handleLimparLancamentos}
                  className="technical-button flex items-center gap-1.5 px-3 border-red-800 text-red-800 hover:bg-red-800 hover:text-white"
                >
                  <Trash2 size={13} /> Limpar Lançamentos
                </button>
              )}
            </div>
          </div>

          {activeConta.rows.length > 0 && (
            <div className="technical-panel p-4 shadow-[4px_4px_0_0_#141414] overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="border-b border-brand-border text-left uppercase text-[8px] opacity-60">
                    <th className="py-1 pr-2">Data</th>
                    <th className="py-1 pr-2">Histórico</th>
                    <th className="py-1 pr-2 text-right">Entrada</th>
                    <th className="py-1 pr-2 text-right">Saída</th>
                    <th className="py-1 pr-2 text-right">Saldo</th>
                    <th className="py-1 pr-2">Nat.</th>
                    <th className="py-1 pr-2">Contrapartida (regra)</th>
                  </tr>
                </thead>
                <tbody>
                  {activeConta.rows.map((r, idx) => {
                    const nature: 'D' | 'C' = r.saida > 0 ? 'C' : 'D';
                    const regra = matchAplicacaoRegra(regrasDaConta, r.historico, nature);
                    return (
                      <tr key={idx} className="border-b border-brand-border/20">
                        <td className="py-1 pr-2">{r.data || '—'}</td>
                        <td className="py-1 pr-2">{r.historico}</td>
                        <td className="py-1 pr-2 text-right text-green-700">
                          {r.entrada ? formatCurrency(r.entrada) : ''}
                        </td>
                        <td className="py-1 pr-2 text-right text-red-700">
                          {r.saida ? formatCurrency(r.saida) : ''}
                        </td>
                        <td className="py-1 pr-2 text-right">{r.saldo != null ? formatCurrency(r.saldo) : ''}</td>
                        <td className={cn('py-1 pr-2 font-black', nature === 'D' ? 'text-red-700' : 'text-blue-700')}>
                          {nature}
                        </td>
                        <td className="py-1 pr-2">
                          {regra ? regra.contaContrapartida : (
                            <span className="opacity-40">sem regra</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <p className="text-[10px] font-mono opacity-50 py-6 text-center">
          Crie uma conta de aplicação acima para importar o extrato.
        </p>
      )}

      <AplicacaoRegrasContasModal
        open={regrasModalOpen}
        company={selectedCompany}
        contaAplicacao={activeConta.nome}
        regras={regras}
        extratoSample={extratoSample}
        onClose={() => setRegrasModalOpen(false)}
        onChange={(next) => setRegras(next)}
      />
    </div>
  );
}
