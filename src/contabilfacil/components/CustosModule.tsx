import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Download, FileText, Edit2 } from 'lucide-react';
import { loadCustos, saveCustos, exportCustosParaPDF, type CustoMensal } from '../logic/custosStorage';
import { cn, formatCurrency } from '../lib/utils';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from './ExtratoContaPicker';
import { buildPlanoNomeLookup } from './ExtratoContaPicker';
import jsPDF from 'jspdf';

interface ContaOption {
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: string;
  nivel?: number;
  group?: string;
}

interface CustosModuleProps {
  selectedCompany: string;
  planoOptions?: ContaOption[];
}

export default function CustosModule({ selectedCompany, planoOptions = [] }: CustosModuleProps) {
  const [custos, setCustos] = useState<CustoMensal[]>([]);
  const [novoMes, setNovoMes] = useState('');
  const [novoFaturamento, setNovoFaturamento] = useState('');
  const [novaPorcentagem, setNovaPorcentagem] = useState('');
  const [novaContaDebito, setNovaContaDebito] = useState('');
  const [novaContaCredito, setNovaContaCredito] = useState('');
  const [novaDescricao, setNovaDescricao] = useState('');
  const [periodoExportacao, setPeriodoExportacao] = useState({ de: '', ate: '' });
  const [modalExportAberto, setModalExportAberto] = useState(false);
  const [modalEditAberto, setModalEditAberto] = useState(false);
  const [indexEditando, setIndexEditando] = useState<number | null>(null);

  const calcularCusto = (faturamento: number, porcentagem?: number): number => {
    if (!porcentagem) return faturamento;
    return faturamento * (porcentagem / 100);
  };

  const formatarData = (valor: string): string => {
    const apenasNumeros = valor.replace(/\D/g, '');
    if (apenasNumeros.length <= 2) return apenasNumeros;
    if (apenasNumeros.length <= 4) return `${apenasNumeros.slice(0, 2)}/${apenasNumeros.slice(2)}`;
    return `${apenasNumeros.slice(0, 2)}/${apenasNumeros.slice(2, 4)}/${apenasNumeros.slice(4, 8)}`;
  };

  useEffect(() => {
    const dados = loadCustos(selectedCompany);
    setCustos(dados);
  }, [selectedCompany]);

  const adicionarCusto = useCallback(() => {
    if (!novoMes || !novoFaturamento) {
      alert('Preencha mês e faturamento');
      return;
    }
    const novoItem: CustoMensal = {
      mes: novoMes,
      faturamento: parseFloat(novoFaturamento),
      porcentagem: novaPorcentagem ? parseFloat(novaPorcentagem) : undefined,
      contaDebitoCode: novaContaDebito || undefined,
      contaCreditoCode: novaContaCredito || undefined,
      descricao: novaDescricao || undefined,
    };
    const novosCustos = [...custos, novoItem];
    setCustos(novosCustos);
    saveCustos(selectedCompany, novosCustos);
    setNovoMes('');
    setNovoFaturamento('');
    setNovaPorcentagem('');
    setNovaContaDebito('');
    setNovaContaCredito('');
    setNovaDescricao('');
  }, [novoMes, novoFaturamento, novaPorcentagem, novaContaDebito, novaContaCredito, novaDescricao, custos, selectedCompany]);

  const removerCusto = useCallback((index: number) => {
    const novosCustos = custos.filter((_, i) => i !== index);
    setCustos(novosCustos);
    saveCustos(selectedCompany, novosCustos);
  }, [custos, selectedCompany]);

  const abrirEdicao = (index: number) => {
    const custo = custos[index];
    setNovoMes(custo.mes);
    setNovoFaturamento(custo.faturamento.toString());
    setNovaPorcentagem(custo.porcentagem?.toString() || '');
    setNovaContaDebito(custo.contaDebitoCode || '');
    setNovaContaCredito(custo.contaCreditoCode || '');
    setNovaDescricao(custo.descricao || '');
    setIndexEditando(index);
    setModalEditAberto(true);
  };

  const salvarEdicao = useCallback(() => {
    if (!novoMes || !novoFaturamento) {
      alert('Preencha mês e faturamento');
      return;
    }
    const novosCustos = [...custos];
    novosCustos[indexEditando!] = {
      mes: novoMes,
      faturamento: parseFloat(novoFaturamento),
      porcentagem: novaPorcentagem ? parseFloat(novaPorcentagem) : undefined,
      contaDebitoCode: novaContaDebito || undefined,
      contaCreditoCode: novaContaCredito || undefined,
      descricao: novaDescricao || undefined,
    };
    setCustos(novosCustos);
    saveCustos(selectedCompany, novosCustos);
    setModalEditAberto(false);
    setIndexEditando(null);
    setNovoMes('');
    setNovoFaturamento('');
    setNovaPorcentagem('');
    setNovaContaDebito('');
    setNovaContaCredito('');
    setNovaDescricao('');
  }, [novoMes, novoFaturamento, novaPorcentagem, novaContaDebito, novaContaCredito, novaDescricao, indexEditando, custos, selectedCompany]);

  const exportarPDF = useCallback(() => {
    if (custos.length === 0) {
      alert('Nenhum custo registrado');
      return;
    }

    const pdf = new jsPDF();
    pdf.setFontSize(16);
    pdf.text('RELATÓRIO DE CUSTOS E FATURAMENTO', 20, 20);

    pdf.setFontSize(10);
    const dataAtual = new Date().toLocaleDateString('pt-BR');
    pdf.text(`Data: ${dataAtual}`, 20, 30);

    if (periodoExportacao.de || periodoExportacao.ate) {
      pdf.text(`Período: ${periodoExportacao.de} a ${periodoExportacao.ate}`, 20, 38);
    }

    const filtrados = custos.filter(c => {
      if (periodoExportacao.de && c.mes < periodoExportacao.de) return false;
      if (periodoExportacao.ate && c.mes > periodoExportacao.ate) return false;
      return true;
    });

    let yPosition = periodoExportacao.de || periodoExportacao.ate ? 48 : 40;

    pdf.setFont('helvetica', 'bold');
    pdf.text('MÊS', 15, yPosition);
    pdf.text('FATURAMENTO', 50, yPosition);
    pdf.text('%', 95, yPosition);
    pdf.text('DÉBITO', 110, yPosition);
    pdf.text('CRÉDITO', 150, yPosition);
    yPosition += 8;

    pdf.setFont('helvetica', 'normal');
    let totalFaturamento = 0;

    filtrados.forEach(c => {
      if (yPosition > 250) {
        pdf.addPage();
        yPosition = 20;
      }
      const debitoText = c.contaDebitoCode ? planoOptions.find(op => op.code === c.contaDebitoCode)?.codigoReduzido || c.contaDebitoCode : '-';
      const creditoText = c.contaCreditoCode ? planoOptions.find(op => op.code === c.contaCreditoCode)?.codigoReduzido || c.contaCreditoCode : '-';
      const custoCalculado = calcularCusto(c.faturamento, c.porcentagem);

      pdf.text(c.mes, 15, yPosition);
      pdf.text(`R$ ${custoCalculado.toFixed(2)}`, 50, yPosition);
      pdf.text(c.porcentagem !== undefined ? `${c.porcentagem.toFixed(2)}%` : '-', 95, yPosition);
      pdf.text(debitoText, 110, yPosition);
      pdf.text(creditoText, 150, yPosition);
      yPosition += 8;
      totalFaturamento += custoCalculado;
    });

    yPosition += 8;
    pdf.setFont('helvetica', 'bold');
    pdf.text(`TOTAL: R$ ${totalFaturamento.toFixed(2)}`, 20, yPosition);

    pdf.save(`custos-faturamento-${new Date().toISOString().split('T')[0]}.pdf`);
    setModalExportAberto(false);
  }, [custos, periodoExportacao]);

  const totalFaturamento = custos.reduce((sum, c) => sum + calcularCusto(c.faturamento, c.porcentagem), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
          {/* Stats */}
          <div className="technical-panel p-6 shadow-[4px_4px_0_0_#141414]">
            <p className="text-[9px] font-black text-brand-text/40 uppercase tracking-widest mb-2 italic">
              Total de Custos
            </p>
            <p className="text-3xl font-mono font-black tracking-tighter text-red-600">
              {formatCurrency(totalFaturamento)}
            </p>
            <p className="text-[9px] font-mono text-brand-text/45 mt-2 uppercase tracking-wide">
              {custos.length} mês(es) registrado(s)
            </p>
          </div>

          {/* Tabela de Custos */}
          <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
            <div className="p-3 border-b border-brand-border bg-brand-sidebar/30">
              <h3 className="text-[10px] font-black uppercase tracking-widest">
                Custos Mensais
              </h3>
            </div>

            {custos.length === 0 ? (
              <div className="p-6 text-center text-[10px] font-bold text-brand-text/40 uppercase tracking-widest">
                Nenhum custo registrado
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-brand-sidebar/20">
                      <th className="px-4 py-3 border-b border-brand-border text-[10px] font-black uppercase">
                        MÊS
                      </th>
                      <th className="px-4 py-3 border-b border-brand-border text-right text-[10px] font-black uppercase text-blue-600">
                        FATURAMENTO
                      </th>
                      <th className="px-4 py-3 border-b border-brand-border text-right text-[10px] font-black uppercase text-red-600">
                        CUSTO
                      </th>
                      <th className="px-4 py-3 border-b border-brand-border text-right text-[10px] font-black uppercase">
                        PORCENTAGEM
                      </th>
                      <th className="px-4 py-3 border-b border-brand-border text-[10px] font-black uppercase">
                        DÉBITO
                      </th>
                      <th className="px-4 py-3 border-b border-brand-border text-[10px] font-black uppercase">
                        CRÉDITO
                      </th>
                      <th className="px-4 py-3 border-b border-brand-border text-[10px] font-black uppercase">
                        DESCRIÇÃO
                      </th>
                      <th className="px-4 py-3 border-b border-brand-border text-[10px] font-black uppercase">
                        AÇÃO
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-border/10">
                    {custos.map((custo, idx) => (
                      <tr key={idx} className="hover:bg-brand-sidebar/5">
                        <td className="px-4 py-3 text-[10px] font-mono font-bold">
                          {custo.mes}
                        </td>
                        <td className="px-4 py-3 text-right text-[10px] font-mono text-blue-600">
                          {formatCurrency(custo.faturamento)}
                        </td>
                        <td className="px-4 py-3 text-right text-[10px] font-mono text-red-600">
                          {formatCurrency(calcularCusto(custo.faturamento, custo.porcentagem))}
                        </td>
                        <td className="px-4 py-3 text-right text-[10px] font-mono">
                          {custo.porcentagem !== undefined ? `${custo.porcentagem.toFixed(2)}%` : '-'}
                        </td>
                        <td className="px-4 py-3 text-[10px] font-mono opacity-70">
                          {custo.contaDebitoCode ? planoOptions.find(c => c.code === custo.contaDebitoCode)?.codigoReduzido || custo.contaDebitoCode : '-'}
                        </td>
                        <td className="px-4 py-3 text-[10px] font-mono opacity-70">
                          {custo.contaCreditoCode ? planoOptions.find(c => c.code === custo.contaCreditoCode)?.codigoReduzido || custo.contaCreditoCode : '-'}
                        </td>
                        <td className="px-4 py-3 text-[10px] opacity-70">
                          {custo.descricao || '-'}
                        </td>
                        <td className="px-4 py-3 flex gap-2">
                          <button
                            onClick={() => abrirEdicao(idx)}
                            className="text-blue-600 hover:text-blue-800"
                            title="Editar"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => removerCusto(idx)}
                            className="text-red-600 hover:text-red-800"
                            title="Remover"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Formulário */}
        <div className="lg:col-span-4 space-y-4">
          <div className="technical-panel p-6 bg-brand-sidebar/10 space-y-4">
            <h3 className="text-[10px] font-black uppercase tracking-widest border-b border-brand-border pb-2">
              Adicionar Faturamento
            </h3>

            <div>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                Data (DD/MM/YYYY)
              </label>
              <input
                type="text"
                placeholder="DD/MM/YYYY"
                maxLength={10}
                value={novoMes}
                onChange={(e) => setNovoMes(formatarData(e.target.value))}
                className="w-full h-8 px-3 border border-brand-border bg-brand-bg text-[10px]"
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                Faturamento (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={novoFaturamento}
                onChange={(e) => setNovoFaturamento(e.target.value)}
                placeholder="0.00"
                className="w-full h-8 px-3 border border-brand-border bg-brand-bg text-[10px] font-mono"
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                Porcentagem (%)
              </label>
              <input
                type="number"
                step="0.01"
                value={novaPorcentagem}
                onChange={(e) => setNovaPorcentagem(e.target.value)}
                placeholder="0.00"
                className="w-full h-8 px-3 border border-brand-border bg-brand-bg text-[10px] font-mono"
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                Conta Débito (opcional)
              </label>
              <ExtratoContaPicker
                inputId="custos-debito"
                value={novaContaDebito}
                onChange={setNovaContaDebito}
                options={planoOptions as ExtratoPlanoContaOption[]}
                lookupOptions={planoOptions as ExtratoPlanoContaOption[]}
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                Conta Crédito (opcional)
              </label>
              <ExtratoContaPicker
                inputId="custos-credito"
                value={novaContaCredito}
                onChange={setNovaContaCredito}
                options={planoOptions as ExtratoPlanoContaOption[]}
                lookupOptions={planoOptions as ExtratoPlanoContaOption[]}
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                Descrição (opcional)
              </label>
              <input
                type="text"
                value={novaDescricao}
                onChange={(e) => setNovaDescricao(e.target.value)}
                placeholder="Ex: Vendas, Serviços..."
                className="w-full h-8 px-3 border border-brand-border bg-brand-bg text-[10px]"
              />
            </div>

            <button
              onClick={adicionarCusto}
              className="technical-button-primary w-full text-[10px] font-bold uppercase py-2 flex items-center justify-center gap-2"
            >
              <Plus size={14} />
              Adicionar
            </button>

            <button
              onClick={() => setModalExportAberto(true)}
              disabled={custos.length === 0}
              className="technical-button w-full text-[10px] font-bold uppercase py-2 flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Download size={14} />
              Exportar PDF
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Exportação */}
      {modalExportAberto && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-brand-text/40"
          onClick={() => setModalExportAberto(false)}
        >
          <div
            className="technical-panel w-full max-w-md p-6 shadow-[6px_6px_0_0_#141414] bg-brand-bg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[11px] font-black uppercase tracking-widest mb-4 flex items-center gap-2">
              <FileText size={14} />
              Exportar para PDF
            </h2>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                  Data Inicial (opcional)
                </label>
                <input
                  type="text"
                  placeholder="DD/MM/YYYY"
                  maxLength={10}
                  value={periodoExportacao.de}
                  onChange={(e) => setPeriodoExportacao({ ...periodoExportacao, de: formatarData(e.target.value) })}
                  className="w-full h-8 px-3 border border-brand-border bg-brand-bg text-[10px]"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                  Data Final (opcional)
                </label>
                <input
                  type="text"
                  placeholder="DD/MM/YYYY"
                  maxLength={10}
                  value={periodoExportacao.ate}
                  onChange={(e) => setPeriodoExportacao({ ...periodoExportacao, ate: formatarData(e.target.value) })}
                  className="w-full h-8 px-3 border border-brand-border bg-brand-bg text-[10px]"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setModalExportAberto(false)}
                className="technical-button text-[10px] font-bold py-2 px-4 flex-1"
              >
                Cancelar
              </button>
              <button
                onClick={exportarPDF}
                className="technical-button-primary text-[10px] font-bold py-2 px-4 flex-1 flex items-center justify-center gap-2"
              >
                <Download size={12} />
                Exportar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição */}
      {modalEditAberto && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-brand-text/40"
          onClick={() => setModalEditAberto(false)}
        >
          <div
            className="technical-panel w-full max-w-md p-6 shadow-[6px_6px_0_0_#141414] bg-brand-bg space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[11px] font-black uppercase tracking-widest flex items-center gap-2">
              <Edit2 size={14} />
              Editar Lançamento
            </h2>

            <div>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                Data (DD/MM/YYYY)
              </label>
              <input
                type="text"
                placeholder="DD/MM/YYYY"
                maxLength={10}
                value={novoMes}
                onChange={(e) => setNovoMes(formatarData(e.target.value))}
                className="w-full h-8 px-3 border border-brand-border bg-brand-bg text-[10px]"
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                Faturamento (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={novoFaturamento}
                onChange={(e) => setNovoFaturamento(e.target.value)}
                placeholder="0.00"
                className="w-full h-8 px-3 border border-brand-border bg-brand-bg text-[10px] font-mono"
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                Porcentagem (%)
              </label>
              <input
                type="number"
                step="0.01"
                value={novaPorcentagem}
                onChange={(e) => setNovaPorcentagem(e.target.value)}
                placeholder="0.00"
                className="w-full h-8 px-3 border border-brand-border bg-brand-bg text-[10px] font-mono"
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                Conta Débito (opcional)
              </label>
              <ExtratoContaPicker
                inputId="custos-debito"
                value={novaContaDebito}
                onChange={setNovaContaDebito}
                options={planoOptions as ExtratoPlanoContaOption[]}
                lookupOptions={planoOptions as ExtratoPlanoContaOption[]}
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                Conta Crédito (opcional)
              </label>
              <ExtratoContaPicker
                inputId="custos-credito"
                value={novaContaCredito}
                onChange={setNovaContaCredito}
                options={planoOptions as ExtratoPlanoContaOption[]}
                lookupOptions={planoOptions as ExtratoPlanoContaOption[]}
              />
            </div>

            <div>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">
                Descrição (opcional)
              </label>
              <input
                type="text"
                value={novaDescricao}
                onChange={(e) => setNovaDescricao(e.target.value)}
                placeholder="Ex: Vendas, Serviços..."
                className="w-full h-8 px-3 border border-brand-border bg-brand-bg text-[10px]"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setModalEditAberto(false)}
                className="technical-button text-[10px] font-bold py-2 px-4 flex-1"
              >
                Cancelar
              </button>
              <button
                onClick={salvarEdicao}
                className="technical-button-primary text-[10px] font-bold py-2 px-4 flex-1 flex items-center justify-center gap-2"
              >
                <Edit2 size={12} />
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
