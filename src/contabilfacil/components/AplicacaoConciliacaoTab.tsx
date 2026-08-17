import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileText, ListOrdered, Plus, ScanSearch, Trash2, Upload } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  computeResumoConta,
  loadAplicacaoContasExtrato,
  removeAplicacaoContaExtrato,
  upsertAplicacaoContaExtrato,
  type AplicacaoContaExtrato,
} from '../logic/aplicacaoExtratoStorage';
import { extractPdfText, parseAplicacaoExtratoText, type AplicacaoExtratoRow } from '../logic/aplicacaoExtratoParser';
import {
  ensinarAplicacaoLayout,
  findAplicacaoLayoutAprendido,
  loadAplicacaoLayoutsAprendidos,
  removerAplicacaoLayout,
} from '../logic/aplicacaoLayoutsAprendidos';
import {
  loadAplicacaoRegrasContas,
  matchAplicacaoRegra,
  type AplicacaoRegraConta,
} from '../logic/aplicacaoRegrasContasStorage';
import AplicacaoRegrasContasModal from './AplicacaoRegrasContasModal';
import { convertPdfToImages, processOcrImages } from '../../lib/ocrSearchablePdf';

function formatCurrency(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildEmptyConta(nome: string): AplicacaoContaExtrato {
  return { id: '', nome, saldoAnteriorManual: null, rows: [], atualizadoEm: '' };
}

/** Gera o modelo .xlsx de importação de extrato de aplicação (Data; Histórico; Entrada; Saída; Saldo). */
function downloadModeloAplicacoes() {
  const header = ['Data', 'Histórico', 'Entrada', 'Saída', 'Saldo'];
  const sample = [
    ['10/07/2026', 'CAPITALIZ. REND. JR', 10.04, '', 10816.12],
    ['10/07/2026', 'ENCARGOS DE IRRF', '', 3.04, 10816.54],
  ];
  const ws = XLSX.utils.aoa_to_sheet([header, ...sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Extrato Aplicação');
  XLSX.writeFile(wb, 'modelo_extrato_aplicacoes.xlsx');
}

async function parseXlsxAplicacoes(file: File): Promise<AplicacaoExtratoRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const first = wb.SheetNames[0];
  const ws = wb.Sheets[first];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const rows: AplicacaoExtratoRow[] = [];
  for (const r of raw) {
    const data = String(r['Data'] ?? '').trim();
    const historico = String(r['Histórico'] ?? r['Historico'] ?? '').trim();
    if (!historico) continue;
    const entrada = Number(String(r['Entrada'] ?? '0').toString().replace(',', '.')) || 0;
    const saida = Number(String(r['Saída'] ?? r['Saida'] ?? '0').toString().replace(',', '.')) || 0;
    const saldoRaw = r['Saldo'];
    const saldo = saldoRaw !== '' && saldoRaw != null ? Number(String(saldoRaw).replace(',', '.')) || null : null;
    rows.push({ data, historico, entrada, saida, saldo });
  }
  return rows;
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
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [regrasModalOpen, setRegrasModalOpen] = useState(false);
  const [regras, setRegras] = useState<AplicacaoRegraConta[]>(() =>
    loadAplicacaoRegrasContas(selectedCompany),
  );
  const [layouts, setLayouts] = useState(() => loadAplicacaoLayoutsAprendidos(selectedCompany));

  const fileInputXlsxRef = useRef<HTMLInputElement>(null);
  const fileInputPdfTextoRef = useRef<HTMLInputElement>(null);
  const fileInputPdfOcrRef = useRef<HTMLInputElement>(null);

  const activeConta = useMemo(
    () => contas.find((c) => c.id === activeContaId) ?? buildEmptyConta(''),
    [contas, activeContaId],
  );
  const resumo = useMemo(() => computeResumoConta(activeConta), [activeConta]);
  const regrasDaConta = useMemo(
    () => regras.filter((r) => r.contaAplicacao === activeConta.nome),
    [regras, activeConta.nome],
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

  const handleXlsxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const rows = await parseXlsxAplicacoes(file);
    applyRowsToActiveConta(rows);
    setStatusMsg(`${rows.length} lançamento(s) importado(s) da planilha.`);
  };

  const handlePdfTextoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStatusMsg('Extraindo texto do PDF...');
    const text = await extractPdfText(file);
    const learned = findAplicacaoLayoutAprendido(selectedCompany, text);
    const result = parseAplicacaoExtratoText(text);
    applyRowsToActiveConta(result.rows, result.saldoAnterior ?? undefined);
    const nextLayouts = ensinarAplicacaoLayout(selectedCompany, {
      nome: activeConta.nome || file.name,
      text,
      layout: result.layout,
      contaAplicacao: activeConta.nome,
    });
    setLayouts(nextLayouts);
    setStatusMsg(
      `${result.rows.length} lançamento(s) lidos (layout ${learned ? 'reconhecido: ' + learned.nome : result.layout}). ` +
        `Saldo anterior: ${result.saldoAnterior != null ? formatCurrency(result.saldoAnterior) : 'não encontrado'}.`,
    );
  };

  const handlePdfOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setOcrBusy(true);
    setOcrProgress(0);
    setStatusMsg('Convertendo PDF em imagens...');
    try {
      const images = await convertPdfToImages(file);
      setStatusMsg('Reconhecendo texto (OCR)...');
      const { text } = await processOcrImages(images, setOcrProgress);
      const result = parseAplicacaoExtratoText(text);
      applyRowsToActiveConta(result.rows, result.saldoAnterior ?? undefined);
      const nextLayouts = ensinarAplicacaoLayout(selectedCompany, {
        nome: activeConta.nome || file.name,
        text,
        layout: result.layout,
        contaAplicacao: activeConta.nome,
      });
      setLayouts(nextLayouts);
      setStatusMsg(`${result.rows.length} lançamento(s) lidos via OCR (layout ${result.layout}).`);
    } catch (err) {
      setStatusMsg(`Erro no OCR: ${(err as Error).message}`);
    } finally {
      setOcrBusy(false);
    }
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Saldo Anterior', resumo.saldoAnterior],
              ['Total Entradas', resumo.totalEntradas],
              ['Total Saídas', resumo.totalSaidas],
              ['Saldo Final', resumo.saldoFinal],
            ].map(([label, val]) => (
              <div key={label as string} className="technical-panel p-3 shadow-[3px_3px_0_0_#141414] space-y-1">
                <p className="text-[8px] font-black uppercase tracking-widest opacity-60">{label}</p>
                <p className="text-sm font-mono font-black">{formatCurrency(val as number)}</p>
              </div>
            ))}
          </div>

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={downloadModeloAplicacoes}
                className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest"
              >
                <span>Baixar Modelo (.xlsx)</span>
                <Download size={14} />
              </button>
              <button
                type="button"
                onClick={() => fileInputXlsxRef.current?.click()}
                className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest"
              >
                <span>Importar Planilha Preenchida</span>
                <Upload size={14} />
              </button>
              <button
                type="button"
                onClick={() => fileInputPdfTextoRef.current?.click()}
                className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest"
                title="PDF com texto selecionável (extrato de aplicação Sicredi etc.)"
              >
                <span>Conversor de Extrato de Aplicação (com Texto)</span>
                <FileText size={14} />
              </button>
              <button
                type="button"
                onClick={() => fileInputPdfOcrRef.current?.click()}
                disabled={ocrBusy}
                className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
                title="PDF escaneado/foto sem texto — usa o mesmo pipeline OCR (Tesseract) do extrato bancário"
              >
                <span>{ocrBusy ? `OCR ${ocrProgress}%...` : 'Conversor de Extrato de Aplicação (sem Texto / OCR)'}</span>
                <ScanSearch size={14} />
              </button>
            </div>

            <input ref={fileInputXlsxRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleXlsxUpload} />
            <input ref={fileInputPdfTextoRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfTextoUpload} />
            <input ref={fileInputPdfOcrRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfOcrUpload} />

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
                    <th className="py-1 pr-2">Débito/Crédito (regra)</th>
                  </tr>
                </thead>
                <tbody>
                  {activeConta.rows.map((r, idx) => {
                    const regra = matchAplicacaoRegra(regrasDaConta, r.historico);
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
                        <td className="py-1 pr-2">
                          {regra ? `D: ${regra.contaDebito} / C: ${regra.contaCredito}` : (
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

          <div className="technical-panel p-4 shadow-[4px_4px_0_0_#141414] space-y-2">
            <h5 className="text-[9px] font-black uppercase tracking-widest text-brand-border">
              Pasta de Layouts de Aplicações Aprendidos
            </h5>
            <p className="text-[8px] font-mono opacity-60">
              Ao importar um PDF com sucesso, o layout (cabeçalho/produto) é reconhecido automaticamente nas
              próximas importações do mesmo produto. Os 3 modelos de extrato Sicredi (Invest Exclusivo, Poupança
              Integrada, Sicredinvest Automático) podem ser importados uma vez cada para "ensinar" o sistema.
            </p>
            {layouts.length === 0 ? (
              <p className="text-[9px] font-mono opacity-40 py-2">Nenhum layout aprendido ainda.</p>
            ) : (
              <ul className="space-y-1">
                {layouts.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between border border-brand-border/30 px-2 py-1.5 bg-white text-[9px] font-mono"
                  >
                    <span>
                      {l.nome} <span className="opacity-50">({l.layout})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setLayouts(removerAplicacaoLayout(selectedCompany, l.id))}
                      className="text-red-800 hover:opacity-70"
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
        regras={regrasDaConta}
        onClose={() => setRegrasModalOpen(false)}
        onChange={(next) => {
          setRegras((prev) => [...prev.filter((r) => r.contaAplicacao !== activeConta.nome), ...next]);
        }}
      />
    </div>
  );
}
