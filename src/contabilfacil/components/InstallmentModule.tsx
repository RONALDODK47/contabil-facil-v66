import React, { useState, useEffect, useMemo } from 'react';
import { Layers, Plus, Search, Trash2, Download, Calendar, Eye } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import { FreeNumericInput } from './FreeNumericInput';
import {
  CF_FIELD_COL,
  CF_FORM_FIELDS,
  CF_FORM_INPUT_DATE,
  CF_FORM_INPUT_MED,
  CF_FORM_INPUT_MONEY,
  CF_FORM_INPUT_NUM,
  CF_FORM_INPUT_SHORT,
} from '../lib/formFieldClasses';
import DataIngestionBox from './DataIngestionBox';

import BalancetePeriodoModal, { type BalancetePeriodo } from './BalancetePeriodoModal';
import { planilhaImportToSavedParcelamento } from '../logic/ocrImportMapper';
import InstallmentDocTab from './InstallmentDocTab';
import InstallmentContasTab from './InstallmentContasTab';
import { postParcelamentoNoRazao } from '../logic/parcelamentoBalanceteAutomation';
import { flushPersistenceAfterCriticalWrite } from '../logic/eyeVisionPersistenceFlush';
import {
  loadParcelamentosFromBrowserStorage,
  normalizeSavedParcelamento,
  type SavedParcelamento,
} from '../logic/parcelamentoStorage';
import { persistCanonicalList } from '../../lib/simuladorBrowserStorage';
import { belongsToCompany, normalizeCompanyName } from '../logic/companyWorkspace';
import { formatCurrencyInput, parseCurrency } from '../../lib/simTabFields';
import {
  cronogramaParcelamento,
  downloadParcelamentoTxtPlus,
  fromSavedParcelamentoLike,
  generateParcelamentoTxtPlus,
} from '../../lib/parcelamentoDominioExport';
interface InstallmentItem {
  id: string;
  client: string;
  contract: string;
  amount: number;
  qty: number;
  start: string;
}

export interface InstallmentModuleProps {
  selectedCompany: string;
  storageVersion?: number;
  /** Dentro da aba Gerencial — oculta cabeçalho duplicado. */
  embedded?: boolean;
}

type InstallmentMainTab = 'cronogramas' | 'contas' | 'doc';

function parcelamentoToItem(p: SavedParcelamento): InstallmentItem {
  return {
    id: p.id,
    client: p.clienteNome,
    contract: p.numeroParcelamento || p.nomeParcelamento || '',
    amount: parseCurrency(p.valorParcelaStr),
    qty: Math.max(1, parseInt(String(p.quantidadeParcelasStr).replace(/\D/g, ''), 10) || 1),
    start: p.dataInicioPrimeiraParcelaStr,
  };
}

function itemToParcelamento(item: InstallmentItem, companyName: string): SavedParcelamento {
  return normalizeSavedParcelamento({
    id: item.id,
    clienteNome: item.client,
    companyName: normalizeCompanyName(companyName),
    nomeParcelamento: item.contract,
    numeroParcelamento: item.contract,
    valorParcelaStr: formatCurrencyInput(item.amount),
    quantidadeParcelasStr: String(item.qty),
    dataInicioPrimeiraParcelaStr: item.start,
    numeroPrimeiraParcelaStr: '1',
    createdAt: new Date().toISOString(),
  });
}

export default function InstallmentModule({
  selectedCompany,
  storageVersion = 0,
  embedded = false,
}: InstallmentModuleProps) {
  const [installmentMainTab, setInstallmentMainTab] = useState<InstallmentMainTab>('cronogramas');
  const [savedParcelamentos, setSavedParcelamentos] = useState<SavedParcelamento[]>([]);
  const [periodoModalOpen, setPeriodoModalOpen] = useState(false);
  const [pendingParcelamentoId, setPendingParcelamentoId] = useState<string | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // New item form state
  const [client, setClient] = useState('');
  const [contract, setContract] = useState('');
  const [amount, setAmount] = useState(0);
  const [qty, setQty] = useState(1);
  const [start, setStart] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    const saved = loadParcelamentosFromBrowserStorage();
    const scoped = saved.filter((item) => belongsToCompany(item.companyName, selectedCompany));
    setSavedParcelamentos(scoped);
  }, [storageVersion, selectedCompany]);
  const installments = useMemo(() => savedParcelamentos.map(parcelamentoToItem), [savedParcelamentos]);

  const saveParcelamentos = (newList: SavedParcelamento[]) => {
    setSavedParcelamentos(newList);
    const all = loadParcelamentosFromBrowserStorage();
    const others = all.filter((item) => !belongsToCompany(item.companyName, selectedCompany));
    const scoped = newList.map((item) =>
      normalizeSavedParcelamento({ ...item, companyName: normalizeCompanyName(selectedCompany) }),
    );
    persistCanonicalList('simulador_parcelamentos', [...others, ...scoped]);
  };

  const saveToStorage = (newList: InstallmentItem[]) => {
    saveParcelamentos(newList.map((item) => itemToParcelamento(item, selectedCompany)));
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || !contract || amount <= 0) return;

    const newItem: InstallmentItem = {
      id: crypto.randomUUID(),
      client: client.toUpperCase(),
      contract,
      amount,
      qty,
      start
    };

    const updated = [...installments, newItem];
    saveToStorage(updated);

    // Reset Form
    setClient('');
    setContract('');
    setAmount(0);
    setQty(12);
    setStart(new Date().toISOString().split('T')[0]);
    setShowAddForm(false);
  };

  const handleDelete = (id: string) => {
    const updated = installments.filter(item => item.id !== id);
    saveToStorage(updated);
  };

  const clearAll = () => {
    saveToStorage([]);
  };

  const filteredInstallments = installments.filter(item => 
    item.client.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.contract.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleExportDominioTxt = (parcelamentoId?: string) => {
    if (savedParcelamentos.length === 0) {
      alert('Nenhum cronograma salvo para exportar.');
      return;
    }
    const p =
      savedParcelamentos.find((item) => item.id === parcelamentoId) ?? savedParcelamentos[0];
    const inp = fromSavedParcelamentoLike(p);
    const cron = cronogramaParcelamento(inp, parseCurrency);
    if (cron.length === 0) {
      alert('Cronograma vazio. Revise valor e quantidade de parcelas.');
      return;
    }
    const base = (p.numeroParcelamento || p.nomeParcelamento || p.clienteNome || 'parcelamento')
      .replace(/\s+/g, '_')
      .replace(/[^\w-]/g, '');
    downloadParcelamentoTxtPlus(
      `${base}_dominio_txtplus.txt`,
      generateParcelamentoTxtPlus(inp, parseCurrency, cron),
    );
  };

  const handleMandarParcelamentoBalancete = (parcelamentoId?: string) => {
    if (savedParcelamentos.length === 0) {
      alert('Nenhum cronograma para enviar ao balancete.');
      return;
    }
    setPendingParcelamentoId(parcelamentoId);
    setPeriodoModalOpen(true);
  };

  const handlePeriodoConfirmado = (periodo: BalancetePeriodo) => {
    setPeriodoModalOpen(false);
    try {
      const { gerados, pendencias } = postParcelamentoNoRazao(selectedCompany, pendingParcelamentoId);
      void flushPersistenceAfterCriticalWrite();
      if (pendencias.length && gerados <= 0) {
        alert(pendencias.join('\n'));
        return;
      }
      const periodoStr = `${periodo.dataInicio.split('-').reverse().join('/')} até ${periodo.dataFim.split('-').reverse().join('/')}`;
      alert(
        gerados > 0
          ? `${gerados} lançamento(s) de parcelamento enviados ao balancete.\nPeríodo: ${periodoStr}\n\nAbra a aba Balancete para conferir.`
          : 'Nada novo para enviar — já estavam no balancete (ou não geraram partidas).',
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao enviar para o balancete.');
    }
  };

  const mainTabs: { id: InstallmentMainTab; label: string }[] = [
    { id: 'cronogramas', label: 'Cronogramas' },
    { id: 'contas', label: 'Contas' },
    { id: 'doc', label: 'Doc. Parcelamentos' },
  ];

  return (
    <div className={cn(embedded ? 'space-y-6 min-w-0' : 'p-8 max-w-7xl mx-auto space-y-8')}>
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-brand-border pb-4 gap-4">
        {!embedded ? (
          <div>
            <h1 className="text-2xl font-black italic tracking-tighter uppercase">Cronogramas de Parcelamento</h1>
            <p className="text-[10px] font-bold uppercase opacity-50 tracking-widest">
              Mapeamento Contratual — {selectedCompany}
            </p>
          </div>
        ) : (
          <div className="min-w-0" />
        )}
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="technical-button-primary flex items-center gap-2"
          >
            <Plus size={14} />
            {showAddForm ? 'FECHAR FORMULÁRIO' : 'NOVO REGISTRO'}
          </button>

          {installments.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="technical-button flex items-center gap-1.5 border-red-800 text-red-800 hover:bg-red-800 hover:text-white"
            >
              <Trash2 size={14} />
              LIMPAR TUDO
            </button>
          )}
        </div>
      </div>

      {/* Form Overlay/Section */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="technical-panel p-6 shadow-[6px_6px_0_0_#141414] bg-brand-sidebar/10 max-w-3xl">
          <h3 className="text-xs font-black uppercase tracking-widest border-b border-brand-border pb-2 mb-3 w-full">Cadastrar Novo Cronograma</h3>
          
          <div className={CF_FORM_FIELDS}>
            <div className={CF_FIELD_COL}>
              <label className="block text-[9px] font-black uppercase opacity-60 mb-1">Nome do Cliente/Fornecedor</label>
              <input aria-label="Nome do Cliente/Fornecedor" 
                type="text" 
                required
                value={client}
                onChange={e => setClient(e.target.value)}
                placeholder="CLIENTE X LTDA"
                className={CF_FORM_INPUT_MED}
              />
            </div>
            <div className={CF_FIELD_COL}>
              <label className="block text-[9px] font-black uppercase opacity-60 mb-1">Nº Contrato</label>
              <input aria-label="Nº Contrato" 
                type="text" 
                required
                value={contract}
                onChange={e => setContract(e.target.value)}
                placeholder="001/2026"
                className={CF_FORM_INPUT_SHORT}
              />
            </div>
            <div className={CF_FIELD_COL}>
              <label className="block text-[9px] font-black uppercase opacity-60 mb-1">Valor Parcela (R$)</label>
              <FreeNumericInput aria-label="Valor Parcela (R$)"
                required
                value={amount}
                onChange={setAmount}
                placeholder="5000"
                className={CF_FORM_INPUT_MONEY}
              />
            </div>
            <div className={CF_FIELD_COL}>
              <label className="block text-[9px] font-black uppercase opacity-60 mb-1">Qtd Parcelas</label>
              <FreeNumericInput aria-label="Qtd Parcelas"
                required
                inputMode="numeric"
                value={qty}
                onChange={setQty}
                hideZeroWhenBlurred={false}
                className={CF_FORM_INPUT_NUM}
              />
            </div>
            <div className={CF_FIELD_COL}>
              <label className="block text-[9px] font-black uppercase opacity-60 mb-1">1ª Parcela</label>
              <input aria-label="1ª Parcela" 
                type="date" 
                required
                value={start}
                onChange={e => setStart(e.target.value)}
                className={CF_FORM_INPUT_DATE}
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2 w-full basis-full">
            <button 
              type="button"
              onClick={() => setShowAddForm(false)}
              className="technical-button text-[10px] font-black py-2 px-4 uppercase"
            >
              Cancelar
            </button>
            <button 
              type="submit" 
              className="technical-button-primary text-[10px] font-black py-2 px-6 uppercase shadow-[2px_2px_0_0_rgba(0,0,0,0.15)]"
            >
              Registrar Cronograma
            </button>
          </div>
        </form>
      )}

      <div className="flex border border-brand-border bg-brand-sidebar/30 p-1 w-fit">
        {mainTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setInstallmentMainTab(tab.id)}
            className={cn(
              'px-6 py-2 text-[10px] font-black uppercase tracking-widest transition-all',
              installmentMainTab === tab.id
                ? 'bg-brand-border text-brand-bg shadow-[2px_2px_0_0_rgba(0,0,0,0.2)]'
                : 'text-brand-text/60 hover:bg-brand-border/10',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Grid & Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-4">
          {installmentMainTab === 'cronogramas' ? (
          <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
            <div className="p-3 border-b border-brand-border flex flex-col md:flex-row md:items-center justify-between gap-2 bg-brand-sidebar/30">
              <h3 className="text-[10px] font-black uppercase tracking-widest">Base de Contratos Ativos</h3>
              <div className="relative min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-border/40" size={14} />
                <input 
                  type="text"
                  aria-label="Filtrar cliente ou contrato"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="FILTRAR CLIENTE, CONTRATO..." 
                  className="pl-9 pr-4 py-1.5 bg-white border border-brand-border text-[9px] font-mono font-bold focus:outline-none focus:ring-1 focus:ring-brand-border/20 uppercase w-full"
                />
              </div>
            </div>
            
            <div className="module-table-viewport">
            <table className="w-full min-w-[720px] text-left text-sm border-collapse">
              <thead className="technical-grid-header">
                <tr>
                  <th className="px-6 py-3 border-r border-brand-border">Empresa / Detalhes</th>
                  <th className="px-6 py-3 border-r border-brand-border">Ref.</th>
                  <th className="px-6 py-3 border-r border-brand-border">Freq.</th>
                  <th className="px-6 py-3 border-r border-brand-border">Total Liquidez</th>
                  <th className="px-6 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[11px] divide-y divide-brand-border/10">
                {filteredInstallments.length > 0 ? (
                  filteredInstallments.map((item) => (
                    <tr key={item.id} className="technical-grid-row">
                      <td className="px-6 py-4 border-r border-brand-border/10">
                        <div className="font-bold text-brand-text uppercase italic">{item.client}</div>
                        <div className="text-[9px] opacity-45 uppercase">Start: {formatDate(item.start)}</div>
                      </td>
                      <td className="px-6 py-4 border-r border-brand-border/10 opacity-70 italic tracking-tighter">{item.contract}</td>
                      <td className="px-6 py-4 border-r border-brand-border/10">
                        <span className="bg-brand-border text-brand-bg px-1.5 py-0.5 text-[8px] font-black">{item.qty}X</span>
                        <span className="text-[9px] opacity-50 ml-1.5">({formatCurrency(item.amount)})</span>
                      </td>
                      <td className="px-6 py-4 border-r border-brand-border/10 font-bold">{formatCurrency(item.amount * item.qty)}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">

                          <button
                            type="button"
                            onClick={() => handleExportDominioTxt(item.id)}
                            className="p-1.5 text-brand-border hover:bg-brand-sidebar/30 transition-colors"
                            title="Exportar TXT+ Domínio"
                          >
                            <Download size={14} />
                          </button>
                          <button 
                            onClick={() => handleDelete(item.id)}
                            className="p-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors"
                            title="Deletar Cronograma"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-20 text-center font-bold text-slate-400 uppercase tracking-widest text-[10px]">
                      Nenhum cronograma de parcelamento registrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
          ) : installmentMainTab === 'contas' ? (
            <InstallmentContasTab
              selectedCompany={selectedCompany}
              items={savedParcelamentos}
              onSave={saveParcelamentos}
            />
          ) : (
            <InstallmentDocTab
              items={savedParcelamentos}
              onDelete={(id) => saveParcelamentos(savedParcelamentos.filter((item) => item.id !== id))}
            />
          )}
        </div>

        {/* Right Help Sidebar */}
        <div className="lg:col-span-4 space-y-6">
           {/* Importação de TXT+ Domínio */}
           <DataIngestionBox 
             dataType="installments" 
             title="Importar TXT+ Parcelamento"
             selectedCompany={selectedCompany}
             ingestionMode="all"
             onImport={(newItems) => {
               const imported = (newItems as InstallmentItem[]).map((item) =>
                 itemToParcelamento({ ...item, id: item.id || crypto.randomUUID() }, selectedCompany),
               );
               saveParcelamentos([...savedParcelamentos, ...imported]);
             }}
           />

           {/* Recortar PDF de Parcelamento */}
           <DataIngestionBox 
             dataType="installments" 
             title="Recortar PDF de Parcelamento"
             selectedCompany={selectedCompany}
             ingestionMode="pdfOnly"
             onImport={(newItems) => {
               const imported = (newItems as InstallmentItem[]).map((item) =>
                 itemToParcelamento({ ...item, id: item.id || crypto.randomUUID() }, selectedCompany),
               );
               saveParcelamentos([...savedParcelamentos, ...imported]);
             }}
             onParcelamentoOcrImport={(data) => {
               const saved = planilhaImportToSavedParcelamento(data, selectedCompany);
               saveParcelamentos([...savedParcelamentos, saved]);
             }}
           />

           <div className="technical-panel p-6 shadow-[4px_4px_0_0_#141414] space-y-3">
             <h4 className="text-[10px] font-black uppercase tracking-widest italic">Export Engine</h4>
             <p className="text-[9px] font-bold text-brand-text/50 uppercase leading-relaxed">
               TXT+ partida dobrada Domínio — mesmo formato da interface antiga (dd/MM/yyyy;conta débito;conta crédito;valor;cod hist;histórico;complemento).
             </p>

             <button 
               type="button"
               onClick={() => handleExportDominioTxt()}
               className="w-full py-2.5 bg-brand-border text-brand-bg text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
             >
               EXPORTAR TXT+ DOMÍNIO
               <ArrowRightLeft size={14} className="opacity-50" />
             </button>
           </div>
        </div>
      </div>
      <BalancetePeriodoModal
        isOpen={periodoModalOpen}
        onConfirm={handlePeriodoConfirmado}
        onCancel={() => setPeriodoModalOpen(false)}
      />
    </div>
  );
}

const ArrowRightLeft = ({ size, className }: { size: number, className: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="m16 3 4 4-4 4" />
    <path d="M20 7H4" />
    <path d="m8 21-4-4 4-4" />
    <path d="M4 17h16" />
  </svg>
);

