import { useState, useMemo, useEffect, type ChangeEvent } from 'react';
import { motion } from 'motion/react';
import {
  Calculator,
  BarChart3,
  FileText,
  Activity,
  Download,
  Building2,
  Fingerprint,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { readPersistedLocalStorageJson, writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import { companyStorageSlug } from '../logic/companyWorkspace';

interface FinancialData {
  ativoCirculante: number;
  ativoNaoCirculante: number;
  passivoCirculante: number;
  passivoNaoCirculante: number;
  patrimonioLiquido: number;
  estoques: number;
  receitaLiquida: number;
  custos: number;
  despesas: number;
  lucroLiquido: number;
}

interface FinancialIndices {
  liquidezCorrente: number;
  liquidezSeca: number;
  endividamentoGeral: number;
  margemLiquida: number;
  roe: number;
}

interface CompanyInfo {
  name: string;
  cnpj: string;
  accountant: string;
  crc: string;
  year: string;
}

const DEFAULT_COMPANY_INFO: CompanyInfo = { name: '', cnpj: '', accountant: '', crc: '', year: '' };
const DEFAULT_DATA: FinancialData = {
  ativoCirculante: 0,
  ativoNaoCirculante: 0,
  passivoCirculante: 0,
  passivoNaoCirculante: 0,
  patrimonioLiquido: 0,
  estoques: 0,
  receitaLiquida: 0,
  custos: 0,
  despesas: 0,
  lucroLiquido: 0,
};

interface Props {
  selectedCompany: string;
}

export default function IndiceLiquidezModule({ selectedCompany }: Props) {
  const storageScope = companyStorageSlug(selectedCompany || '');
  const infoKey = `contabilfacil_${storageScope}_indice_liquidez_info`;
  const dataKey = `contabilfacil_${storageScope}_indice_liquidez_data`;

  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>(() =>
    readPersistedLocalStorageJson<CompanyInfo>(infoKey, { ...DEFAULT_COMPANY_INFO, name: selectedCompany || '' }),
  );
  const [data, setData] = useState<FinancialData>(() => readPersistedLocalStorageJson<FinancialData>(dataKey, DEFAULT_DATA));

  // Troca de empresa: recarrega os dados salvos daquela empresa (nunca mistura com a anterior).
  useEffect(() => {
    setCompanyInfo(readPersistedLocalStorageJson<CompanyInfo>(infoKey, { ...DEFAULT_COMPANY_INFO, name: selectedCompany || '' }));
    setData(readPersistedLocalStorageJson<FinancialData>(dataKey, DEFAULT_DATA));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany]);

  // Lucro Líquido é sempre calculado, nunca digitado.
  useEffect(() => {
    const calculado = data.receitaLiquida - (data.custos + data.despesas);
    if (calculado !== data.lucroLiquido) {
      setData((prev) => ({ ...prev, lucroLiquido: calculado }));
    }
  }, [data.receitaLiquida, data.custos, data.despesas, data.lucroLiquido]);

  useEffect(() => {
    if (companyInfo.name || companyInfo.cnpj || companyInfo.accountant || companyInfo.year) {
      writePersistedLocalStorageJson(infoKey, companyInfo);
    }
  }, [companyInfo, infoKey]);

  useEffect(() => {
    if (data.ativoCirculante !== 0 || data.lucroLiquido !== 0) {
      writePersistedLocalStorageJson(dataKey, data);
    }
  }, [data, dataKey]);

  const indices = useMemo<FinancialIndices>(() => {
    const totalAtivo = data.ativoCirculante + data.ativoNaoCirculante;
    return {
      liquidezCorrente: data.passivoCirculante > 0 ? data.ativoCirculante / data.passivoCirculante : 0,
      liquidezSeca: data.passivoCirculante > 0 ? (data.ativoCirculante - data.estoques) / data.passivoCirculante : 0,
      endividamentoGeral: totalAtivo > 0 ? (data.passivoCirculante + data.passivoNaoCirculante) / totalAtivo : 0,
      margemLiquida: data.receitaLiquida > 0 ? (data.lucroLiquido / data.receitaLiquida) * 100 : 0,
      roe: data.patrimonioLiquido > 0 ? (data.lucroLiquido / data.patrimonioLiquido) * 100 : 0,
    };
  }, [data]);

  const handleInputChange = (field: keyof FinancialData, value: string) => {
    const numValue = parseFloat(value) || 0;
    setData((prev) => ({ ...prev, [field]: numValue }));
  };

  const getStatus = (title: string, value: number) => {
    const configs: Record<string, { good: number; warning: number; reverse?: boolean }> = {
      'Liquidez Corrente': { good: 1.5, warning: 1 },
      'Liquidez Seca': { good: 1.2, warning: 0.8 },
      'Endividamento Geral': { good: 0.5, warning: 0.7, reverse: true },
      'Margem Líquida': { good: 15, warning: 5 },
      ROE: { good: 20, warning: 10 },
    };
    const config = configs[title] || { good: 1, warning: 0.5 };
    const isGood = config.reverse ? value <= config.good : value >= config.good;
    const isWarning = config.reverse ? value <= config.warning : value >= config.warning;

    if (isGood) return { text: 'EXCELENTE', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-600' };
    if (isWarning) return { text: 'ATENÇÃO', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-600' };
    return { text: 'CRÍTICO', color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-600' };
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', putOnlyUsedFonts: true });

    doc.setProperties({
      title: `Indices Financeiros - ${companyInfo.name || 'Empresa'}`,
      subject: 'Relatorio de Indices para Licitacao',
      author: companyInfo.name || 'Declarante',
      creator: 'Contabil Facil - Indice de Liquidez',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const timestamp = new Date().toLocaleDateString('pt-BR');

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 45, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('DEMONSTRATIVO DE ÍNDICES FINANCEIROS', 20, 22);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(`EXERCÍCIO DE REFERÊNCIA: ${companyInfo.year || 'NÃO INFORMADO'}`, 20, 31);
    doc.setTextColor(255, 255, 255);
    doc.text(`Data de Emissão: ${timestamp}`, pageWidth - 20, 22, { align: 'right' });

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('1. IDENTIFICAÇÃO DA EMPRESA', 20, 60);
    doc.setDrawColor(203, 213, 225);
    doc.line(20, 63, pageWidth - 20, 63);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Razão Social: ${companyInfo.name || 'NÃO INFORMADO'}`, 20, 72);
    doc.text(`CNPJ: ${companyInfo.cnpj || 'NÃO INFORMADO'}`, 20, 79);
    doc.text(`Ano de Referência: ${companyInfo.year || 'NÃO INFORMADO'}`, 20, 86);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('2. QUADRO DE INDICADORES CALCULADOS', 20, 100);
    doc.line(20, 103, pageWidth - 20, 103);

    const tableData = [
      ['Indicador', 'Fórmula Aplicada', 'Resultado', 'Situação'],
      ['Liquidez Corrente', 'Ativo Circulante / Passivo Circulante', indices.liquidezCorrente.toFixed(2), getStatus('Liquidez Corrente', indices.liquidezCorrente).text],
      ['Liquidez Seca', '(Ativo Circ. - Estoques) / Passivo Circ.', indices.liquidezSeca.toFixed(2), getStatus('Liquidez Seca', indices.liquidezSeca).text],
      ['Endividamento Geral', 'Passivo Total / Ativo Total', (indices.endividamentoGeral * 100).toFixed(2) + '%', getStatus('Endividamento Geral', indices.endividamentoGeral).text],
      ['Margem Líquida', 'Lucro Líquido / Receita Líquida', indices.margemLiquida.toFixed(2) + '%', getStatus('Margem Líquida', indices.margemLiquida).text],
      ['ROE (Retorno s/ PL)', 'Lucro Líquido / Patrimônio Líquido', indices.roe.toFixed(2) + '%', getStatus('ROE', indices.roe).text],
    ];

    autoTable(doc, {
      startY: 108,
      head: [tableData[0]],
      body: tableData.slice(1),
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9, textColor: [51, 65, 85] },
      columnStyles: { 2: { fontStyle: 'bold', halign: 'center' }, 3: { fontStyle: 'bold', halign: 'center' } },
      didParseCell: (cellData) => {
        if (cellData.column.index === 3 && cellData.cell.section === 'body') {
          const status = cellData.cell.text[0];
          if (status === 'EXCELENTE') cellData.cell.styles.textColor = [16, 185, 129];
          if (status === 'ATENÇÃO') cellData.cell.styles.textColor = [245, 158, 11];
          if (status === 'CRÍTICO') cellData.cell.styles.textColor = [244, 63, 94];
        }
      },
    });

    let currentY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('3. DEMONSTRATIVO DAS CONTAS (BP e DRE)', 20, currentY);
    doc.line(20, currentY + 3, pageWidth - 20, currentY + 3);

    const f = (n: number) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    const financialStructure = [
      ['GRUPO', 'CONTA', 'SALDO (R$)'],
      ['ATIVO', 'ATIVO CIRCULANTE (AC)', f(data.ativoCirculante)],
      ['ATIVO', '   (-) Estoques', f(data.estoques)],
      ['ATIVO', 'ATIVO NÃO CIRCULANTE (ANC)', f(data.ativoNaoCirculante)],
      ['ATIVO', 'TOTAL DO ATIVO', f(data.ativoCirculante + data.ativoNaoCirculante)],
      ['', '', ''],
      ['PASSIVO / PL', 'PASSIVO CIRCULANTE (PC)', f(data.passivoCirculante)],
      ['PASSIVO / PL', 'PASSIVO NÃO CIRCULANTE (PNC)', f(data.passivoNaoCirculante)],
      ['PASSIVO / PL', 'PATRIMÔNIO LÍQUIDO (PL)', f(data.patrimonioLiquido)],
      ['PASSIVO / PL', 'TOTAL DO PASSIVO + PL', f(data.passivoCirculante + data.passivoNaoCirculante + data.patrimonioLiquido)],
      ['', '', ''],
      ['RESULTADO', 'RECEITA LÍQUIDA OPERACIONAL', f(data.receitaLiquida)],
      ['RESULTADO', 'CUSTOS OPERACIONAIS', f(data.custos)],
      ['RESULTADO', 'DESPESAS OPERACIONAIS', f(data.despesas)],
      ['RESULTADO', 'LUCRO LÍQUIDO DO EXERCÍCIO', f(data.lucroLiquido)],
    ];

    autoTable(doc, {
      startY: currentY + 7,
      head: [financialStructure[0]],
      body: financialStructure.slice(1).filter((row) => row[1] !== ''),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 255] },
      columnStyles: { 2: { halign: 'right', fontStyle: 'bold' } },
      didParseCell: (cellData) => {
        if (cellData.cell.text[0].includes('TOTAL') || cellData.cell.text[0].includes('LUCRO LÍQUIDO')) {
          cellData.cell.styles.fontStyle = 'bold';
          cellData.cell.styles.fillColor = [219, 234, 254];
        }
      },
    });

    currentY = (doc as any).lastAutoTable.finalY + 12;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('4. MEMÓRIA DE CÁLCULO DOS ÍNDICES', 20, currentY);
    doc.line(20, currentY + 3, pageWidth - 20, currentY + 3);

    const memoryData = [
      ['Indicador', 'Cálculo Detalhado'],
      ['Liquidez Corrente', `${f(data.ativoCirculante)} / ${f(data.passivoCirculante)} = ${indices.liquidezCorrente.toFixed(2)}`],
      ['Liquidez Seca', `(${f(data.ativoCirculante)} - ${f(data.estoques)}) / ${f(data.passivoCirculante)} = ${indices.liquidezSeca.toFixed(2)}`],
      ['Endividamento', `(${f(data.passivoCirculante)} + ${f(data.passivoNaoCirculante)}) / ${f(data.ativoCirculante + data.ativoNaoCirculante)} = ${(indices.endividamentoGeral * 100).toFixed(2)}%`],
      ['Margem Líquida', `${f(data.lucroLiquido)} / ${f(data.receitaLiquida)} = ${indices.margemLiquida.toFixed(2)}%`],
      ['ROE', `${f(data.lucroLiquido)} / ${f(data.patrimonioLiquido)} = ${indices.roe.toFixed(2)}%`],
    ];

    autoTable(doc, {
      startY: currentY + 7,
      head: [memoryData[0]],
      body: memoryData.slice(1),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 255] },
    });

    const signatureY = (doc as any).lastAutoTable.finalY + 25;
    if (signatureY > pageHeight - 40) {
      doc.addPage();
      currentY = 30;
    } else {
      currentY = signatureY;
    }

    doc.setDrawColor(100, 116, 139);
    doc.line(20, currentY, 95, currentY);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('ASSINATURA DO REPRESENTANTE', 57.5, currentY + 5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text(companyInfo.name || 'RAZÃO SOCIAL', 57.5, currentY + 10, { align: 'center' });
    doc.text(`CNPJ: ${companyInfo.cnpj || '00.000.000/0000-00'}`, 57.5, currentY + 15, { align: 'center' });

    doc.line(115, currentY, 190, currentY);
    doc.setFont('helvetica', 'bold');
    doc.text('ASSINATURA DO CONTADOR (RESP. TÉCNICO)', 152.5, currentY + 5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text(companyInfo.accountant || 'NOME DO PROFISSIONAL', 152.5, currentY + 10, { align: 'center' });
    doc.text(`CRC: ${companyInfo.crc || 'UF-000000/O'}`, 152.5, currentY + 15, { align: 'center' });

    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Documento eletrônico otimizado para assinaturas digitais ICP-Brasil.', pageWidth / 2, pageHeight - 10, { align: 'center' });

    doc.save(`Relatorio_Licitacao_${companyInfo.year || new Date().getFullYear()}_${companyInfo.name || 'Empresa'}.pdf`);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-brand-border pb-2">
        <h2 className="text-sm font-black uppercase tracking-wide flex items-center gap-2">
          <Activity size={16} />
          Índices de Liquidez
        </h2>
        <button
          type="button"
          onClick={exportPDF}
          className="technical-button-primary px-3 py-1.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5"
        >
          <Download size={12} />
          Exportar para Licitação
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* COLUNA 1: ENTRADA */}
        <section className="lg:col-span-3 technical-panel p-3 flex flex-col gap-3">
          <h3 className="text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 border-b border-brand-border pb-1.5">
            <Calculator size={12} />
            1. Entrada de Balancete
          </h3>

          <div className="space-y-1.5">
            <span className="text-[9px] font-bold uppercase text-brand-text/60 tracking-widest">Identificação Jurídica</span>
            <div className="space-y-1">
              <label className="text-[8px] uppercase text-brand-text/50 font-black">Razão Social</label>
              <div className="relative">
                <Building2 size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-brand-text/40" />
                <input
                  type="text"
                  value={companyInfo.name}
                  onChange={(e) => setCompanyInfo((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Empresa LTDA"
                  className="w-full border border-brand-border pl-7 pr-2 py-1.5 text-[10px] outline-none"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[8px] uppercase text-brand-text/50 font-black">CNPJ</label>
              <div className="relative">
                <Fingerprint size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-brand-text/40" />
                <input
                  type="text"
                  value={companyInfo.cnpj}
                  onChange={(e) => setCompanyInfo((p) => ({ ...p, cnpj: e.target.value }))}
                  placeholder="00.000.000/0000-00"
                  className="w-full border border-brand-border pl-7 pr-2 py-1.5 text-[10px] outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="space-y-1">
                <label className="text-[8px] uppercase text-brand-text/50 font-black">Ano Ref.</label>
                <input
                  type="text"
                  value={companyInfo.year}
                  onChange={(e) => setCompanyInfo((p) => ({ ...p, year: e.target.value }))}
                  placeholder="2026"
                  className="w-full border border-brand-border px-2 py-1.5 text-[10px] outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] uppercase text-brand-text/50 font-black">Contador</label>
                <input
                  type="text"
                  value={companyInfo.accountant}
                  onChange={(e) => setCompanyInfo((p) => ({ ...p, accountant: e.target.value }))}
                  placeholder="Nome"
                  className="w-full border border-brand-border px-2 py-1.5 text-[10px] outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] uppercase text-brand-text/50 font-black">CRC</label>
                <input
                  type="text"
                  value={companyInfo.crc}
                  onChange={(e) => setCompanyInfo((p) => ({ ...p, crc: e.target.value }))}
                  placeholder="UF-000"
                  className="w-full border border-brand-border px-2 py-1.5 text-[10px] outline-none"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[9px] font-bold uppercase text-brand-text/60 tracking-widest">Patrimonial (BP)</span>
            <InputField label="Ativo Circulante" value={data.ativoCirculante} onChange={(v) => handleInputChange('ativoCirculante', v)} />
            <InputField label="Estoques (Incluso no AC)" value={data.estoques} onChange={(v) => handleInputChange('estoques', v)} />
            <InputField label="Ativo Não Circulante" value={data.ativoNaoCirculante} onChange={(v) => handleInputChange('ativoNaoCirculante', v)} />
            <div className="h-px bg-brand-border my-1" />
            <InputField label="Passivo Circulante" value={data.passivoCirculante} onChange={(v) => handleInputChange('passivoCirculante', v)} />
            <InputField label="Passivo Não Circulante" value={data.passivoNaoCirculante} onChange={(v) => handleInputChange('passivoNaoCirculante', v)} />
            <InputField label="Patrimônio Líquido" value={data.patrimonioLiquido} onChange={(v) => handleInputChange('patrimonioLiquido', v)} />
          </div>

          <div className="space-y-1.5">
            <span className="text-[9px] font-bold uppercase text-brand-text/60 tracking-widest">Resultado (DRE)</span>
            <InputField label="Receita Líquida" value={data.receitaLiquida} onChange={(v) => handleInputChange('receitaLiquida', v)} />
            <InputField label="Custos" value={data.custos} onChange={(v) => handleInputChange('custos', v)} />
            <InputField label="Despesas" value={data.despesas} onChange={(v) => handleInputChange('despesas', v)} />
            <div className="technical-panel p-2">
              <label className="text-[8px] uppercase text-brand-text/50 font-black tracking-widest">Lucro Líquido (Calculado)</label>
              <div className={`text-sm font-mono font-bold mt-1 ${(data.lucroLiquido || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                R$ {(data.lucroLiquido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </section>

        {/* COLUNA 2: ESTRUTURAS */}
        <section className="lg:col-span-5 flex flex-col gap-3">
          <div className="technical-panel p-3">
            <h3 className="text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 border-b border-brand-border pb-1.5 mb-2">
              <BarChart3 size={12} />
              2. Estrutura Patrimonial
            </h3>
            <div className="space-y-1.5">
              <StructureRow label="Total do Ativo" value={data.ativoCirculante + data.ativoNaoCirculante} isBold />
              <div className="pl-3 space-y-1">
                <StructureRow label="Ativo Circulante" value={data.ativoCirculante} isSmall />
                <StructureRow label="Ativo Não Circulante" value={data.ativoNaoCirculante} isSmall />
              </div>
              <div className="h-px bg-brand-border my-2" />
              <StructureRow label="Passivo + PL" value={data.passivoCirculante + data.passivoNaoCirculante + data.patrimonioLiquido} isBold />
              <div className="pl-3 space-y-1">
                <StructureRow label="Passivo Circulante" value={data.passivoCirculante} isSmall />
                <StructureRow label="Passivo Não Circulante" value={data.passivoNaoCirculante} isSmall />
                <StructureRow label="Patrimônio Líquido" value={data.patrimonioLiquido} isSmall />
              </div>
            </div>
          </div>

          <div className="technical-panel p-3">
            <h3 className="text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 border-b border-brand-border pb-1.5 mb-2">
              <FileText size={12} />
              3. Demonstração de Resultado
            </h3>
            <div className="flex justify-between items-center text-[9px] text-brand-text/50 font-bold uppercase tracking-widest mb-1 px-1">
              <span>Descrição</span>
              <span>Valor (R$)</span>
            </div>
            <div className="space-y-0.5">
              <DRELine label="Receita Líquida" value={data.receitaLiquida} />
              <DRELine label="Custos" value={data.custos} isNegative />
              <DRELine label="Despesas" value={data.despesas} isNegative />
              <div className="h-px bg-brand-border my-1" />
              <DRELine label="Lucro Líquido" value={data.lucroLiquido} isTotal />
            </div>
          </div>
        </section>

        {/* COLUNA 3: ÍNDICES */}
        <section className="lg:col-span-4 technical-panel p-3 flex flex-col gap-3">
          <h3 className="text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 border-b border-brand-border pb-1.5">
            <Activity size={12} />
            4. Índices Financeiros
          </h3>

          <div className="flex flex-col gap-2">
            <IndexItem title="Liquidez Corrente" formula="AC / PC" value={indices.liquidezCorrente} status={getStatus('Liquidez Corrente', indices.liquidezCorrente)} />
            <IndexItem title="Liquidez Seca" formula="(AC - Estoque) / PC" value={indices.liquidezSeca} status={getStatus('Liquidez Seca', indices.liquidezSeca)} />
            <IndexItem title="Endividamento" formula="(PC + PNC) / Total Ativo" value={indices.endividamentoGeral} status={getStatus('Endividamento Geral', indices.endividamentoGeral)} />
            <IndexItem title="Margem Líquida" formula="Lucro L. / Rec. Líq." value={indices.margemLiquida} isPercent status={getStatus('Margem Líquida', indices.margemLiquida)} />
            <IndexItem title="ROE" formula="Lucro L. / PL" value={indices.roe} isPercent status={getStatus('ROE', indices.roe)} />
          </div>

          <div className="mt-auto technical-panel p-3 flex flex-col gap-1.5">
            <span className="text-[9px] font-black uppercase text-brand-text/60 tracking-widest flex items-center gap-1.5">
              <Activity size={11} />
              Diagnóstico Automático
            </span>
            <p className="text-[10px] text-brand-text/70 leading-relaxed">
              {indices.liquidezCorrente > 1.5
                ? 'A empresa apresenta uma robusta estrutura de capital com alta capacidade de pagamento.'
                : 'A liquidez exige atenção. Avalie a necessidade de alongamento de dívidas de curto prazo.'}{' '}
              {indices.roe > 15
                ? 'A rentabilidade sobre o capital próprio é eficiente.'
                : 'O retorno aos sócios está abaixo dos índices ideais de mercado.'}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function InputField({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  const [tempValue, setTempValue] = useState<string>(value === 0 ? '' : value.toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setTempValue(value === 0 ? '' : value.toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
    }
  }, [value, isFocused]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    val = val.replace(/[^\d,.-]/g, '');
    if (val.includes('-')) {
      val = '-' + val.replace(/-/g, '');
    }
    setTempValue(val);
    const normalized = val.replace(/\./g, '').replace(',', '.');
    if (!isNaN(parseFloat(normalized)) || val === '' || val === '-') {
      onChange(normalized === '-' ? '0' : normalized);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const normalized = tempValue.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(normalized);
    setTempValue(!isNaN(num) ? num.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '');
  };

  return (
    <div className="space-y-1">
      <label className="text-[8px] uppercase text-brand-text/50 font-black tracking-widest">{label}</label>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-brand-text/40 font-mono">R$</span>
        <input
          type="text"
          value={tempValue}
          onFocus={() => setIsFocused(true)}
          onBlur={handleBlur}
          onChange={handleChange}
          placeholder="0,00"
          className="w-full border border-brand-border pl-7 pr-2 py-1.5 text-[11px] font-mono outline-none"
        />
      </div>
    </div>
  );
}

function StructureRow({ label, value, isBold = false, isSmall = false }: { label: string; value: number; isBold?: boolean; isSmall?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-brand-border/40">
      <span className={`${isBold ? 'text-[10px] font-black uppercase' : 'text-[9px] font-medium'} ${isSmall ? 'italic text-brand-text/50' : 'text-brand-text/80'}`}>
        {label}
      </span>
      <span className={`font-mono ${isBold ? 'text-[11px] font-bold' : 'text-[10px] text-brand-text/60'}`}>
        R$ {value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function DRELine({ label, value, isNegative = false, isTotal = false }: { label: string; value: number; isNegative?: boolean; isTotal?: boolean }) {
  return (
    <div className={`flex justify-between items-center px-2 py-1.5 ${isTotal ? 'technical-panel mt-1' : ''}`}>
      <span className={`text-[9px] ${isTotal ? 'text-emerald-700 font-black uppercase tracking-widest' : 'font-medium text-brand-text/70'}`}>{label}</span>
      <span className={`font-mono text-[10px] ${isTotal ? 'text-emerald-700 font-bold' : isNegative ? 'text-rose-600/80' : 'text-brand-text/80'}`}>
        {isNegative ? '- ' : ''}
        {value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function IndexItem({
  title,
  formula,
  value,
  status,
  isPercent = false,
}: {
  title: string;
  formula: string;
  value: number;
  status: { text: string; color: string; bg: string; border: string };
  isPercent?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`p-2.5 bg-white border-l-4 ${status.border} border-y border-r border-brand-border flex justify-between items-center`}
    >
      <div>
        <h4 className="text-[10px] font-black uppercase text-brand-text/80 tracking-wider">{title}</h4>
        <p className="text-[8px] text-brand-text/50 mt-0.5 font-mono italic">{formula}</p>
      </div>
      <div className="text-right">
        <div className={`text-base font-mono font-black ${status.color} leading-none`}>
          {value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          {isPercent ? '%' : ''}
        </div>
        <div className={`text-[8px] font-black px-1.5 py-0.5 uppercase tracking-widest mt-1 inline-block ${status.bg} ${status.color}`}>{status.text}</div>
      </div>
    </motion.div>
  );
}
