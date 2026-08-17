/**
 * Modal de Importação de Folha de Pagamento
 * 
 * Interface para:
 * 1. Upload de PDF de folha
 * 2. Parse do PDF
 * 3. Visualização de lançamentos
 * 4. Mapeamento de contas
 * 5. Confirmação de import
 */

import { useState, useRef } from 'react';
import { Upload, Download, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { parseAndRenderPDFPage, openPdfDocument, pdfTextItemsToLines } from '../../lib/leitorRecortador/pdfParser';
import { parseFolhaTextMultiCompetencia } from '../../lib/folhaParser/folhaPDFParser';
import type { FolhaParserResult, FolhaLancamento } from '../../lib/folhaParser/folhaPDFParser';
import {
  mapFolhaParseResultParaVisionBalancete,
  validarMapeamentoFolha,
  gerarSumarioFolha,
  exportarFolhaCSV,
  type FolhaLancamentoSumario,
} from '../../lib/folhaParser/folhaLancamentoMapper';

interface Props {
  companyName: string;
  onCancel: () => void;
  onConfirm: (rows: any[], sumario: any) => void;
}

export default function FolhaImportModal({ companyName, onCancel, onConfirm }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pdfText, setPdfText] = useState('');
  const [parseResults, setParseResults] = useState<FolhaParserResult[]>([]);
  const [lancamentos, setLancamentos] = useState<(FolhaLancamento & { competencia: string })[]>([]);
  const [sumario, setSumario] = useState<FolhaLancamentoSumario | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [step, setStep] = useState<'upload' | 'preview' | 'confirm'>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Processa upload de PDF
   */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith('.pdf')) {
      setErrors(['Por favor, selecione um arquivo PDF válido']);
      return;
    }

    setFile(selectedFile);
    setErrors([]);

    // Extrair texto do PDF
    try {
      setIsProcessing(true);
      const pdfDoc = await openPdfDocument(selectedFile);
      let extractedText = '';

      // Extrair texto de todas as páginas
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await parseAndRenderPDFPage(selectedFile, pageNum, pdfDoc);
        // Reconstrói as linhas por posição X/Y — os textItems do pdf.js não têm quebra de
        // linha própria; sem isso a página inteira vira uma string só e o parser (que lê
        // linha por linha) não reconhece PROVENTOS/DESCONTOS/INFORMATIVA nem competência.
        const pageText = pdfTextItemsToLines(page.textItems).join('\n');
        extractedText += `\n--- Página ${pageNum} ---\n${pageText}`;
      }

      setPdfText(extractedText);

      // Parser do texto — uma competência por página (ex.: Resumo Mensal com vários meses)
      const results = parseFolhaTextMultiCompetencia(extractedText);
      setParseResults(results);

      const combinedErrors = results.flatMap((r) => r.errors);
      if (combinedErrors.length > 0) {
        setErrors(combinedErrors);
      }

      const totalLancamentos = results.reduce((n, r) => n + r.lancements.length, 0);

      if (totalLancamentos > 0) {
        const combinedLancamentos = results.flatMap((r) =>
          r.lancements.map((l) => ({ ...l, competencia: r.competencia })),
        );
        setLancamentos(combinedLancamentos);

        // Gerar sumário combinado (soma de todas as competências do PDF)
        const sum = results.reduce<FolhaLancamentoSumario>(
          (acc, r) => {
            const s = gerarSumarioFolha(r);
            return {
              totalProventos: acc.totalProventos + s.totalProventos,
              totalDescontos: acc.totalDescontos + s.totalDescontos,
              totalInformativa: acc.totalInformativa + s.totalInformativa,
              totalDebito: acc.totalDebito + s.totalDebito,
              totalCredito: acc.totalCredito + s.totalCredito,
              qtdLancamentos: acc.qtdLancamentos + s.qtdLancamentos,
              competencia:
                acc.competencia && acc.competencia !== s.competencia
                  ? `${acc.competencia} … ${s.competencia}`
                  : s.competencia,
            };
          },
          {
            totalProventos: 0,
            totalDescontos: 0,
            totalInformativa: 0,
            totalDebito: 0,
            totalCredito: 0,
            qtdLancamentos: 0,
            competencia: '',
          },
        );
        setSumario(sum);

        setStep('preview');
      } else {
        setErrors(['Nenhum lançamento encontrado no PDF']);
      }
    } catch (err) {
      setErrors([
        `Erro ao processar PDF: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Confirma import
   */
  const handleConfirm = async () => {
    if (parseResults.length === 0) return;

    // Validar mapeamento (rubricas de todas as competências combinadas)
    const validation = validarMapeamentoFolha(lancamentos);
    if (validation.avisos.length > 0) {
      const response = window.confirm(
        `⚠️ Avisos:\n${validation.avisos.join('\n')}\n\nDeseja continuar mesmo assim?`,
      );
      if (!response) return;
    }

    // Gerar lançamentos contábeis para cada competência do PDF
    const items: ReturnType<typeof mapFolhaParseResultParaVisionBalancete>['items'] = [];
    const erros: string[] = [];
    for (const result of parseResults) {
      const mapped = mapFolhaParseResultParaVisionBalancete(result, companyName);
      items.push(...mapped.items);
      erros.push(...mapped.erros);
    }

    if (erros.length > 0) {
      setErrors(erros);
      return;
    }

    setSuccessMessage(`✅ ${items.length} lançamento(s) importados com sucesso!`);
    setTimeout(() => {
      onConfirm(items, sumario);
    }, 1500);
  };

  /**
   * Exporta CSV (todas as competências do PDF)
   */
  const handleExportCSV = () => {
    if (parseResults.length === 0) return;

    const csv = parseResults
      .map((result, idx) => {
        const linhas = exportarFolhaCSV(result, companyName);
        // Mantém o cabeçalho só uma vez
        return idx === 0 ? linhas : linhas.split('\n').slice(1).join('\n');
      })
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const competenciaLabel =
      parseResults.length > 1
        ? `${parseResults[0]!.competencia}_a_${parseResults[parseResults.length - 1]!.competencia}`.replace(/\//g, '-')
        : parseResults[0]!.competencia.replace(/\//g, '-');
    link.setAttribute('download', `folha-${competenciaLabel}.csv`);
    link.click();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-lg">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center">
          <h2 className="text-lg font-bold">IMPORTAR FOLHA DE PAGAMENTO</h2>
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ✕
          </button>
        </div>

        {/* Conteúdo */}
        <div className="p-6 space-y-4">
          {/* Erros */}
          {errors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-300 rounded space-y-1">
              <div className="flex items-center gap-2 text-red-700 font-bold">
                <AlertCircle size={16} />
                Erros:
              </div>
              <ul className="text-[10px] text-red-600 space-y-0.5">
                {errors.map((err, idx) => (
                  <li key={idx}>• {err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Sucesso */}
          {successMessage && (
            <div className="p-3 bg-green-50 border border-green-300 rounded flex items-center gap-2">
              <CheckCircle2 size={16} className="text-green-700" />
              <span className="text-[10px] text-green-700 font-semibold">{successMessage}</span>
            </div>
          )}

          {/* STEP: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center cursor-pointer hover:bg-blue-50 transition-colors"
              >
                <Upload size={32} className="text-blue-600 mx-auto mb-2" />
                <p className="text-sm font-bold">Selecione um PDF de Folha de Pagamento</p>
                <p className="text-[9px] opacity-60 mt-1">
                  O PDF será convertido em lançamentos contábeis
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {file && (
                <div className="p-3 bg-blue-50 border border-blue-300 rounded flex items-center justify-between">
                  <div className="text-[10px]">
                    <p className="font-bold text-blue-900">{file.name}</p>
                    <p className="text-blue-700">
                      {(file.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                  {isProcessing && <Loader2 size={16} className="animate-spin text-blue-600" />}
                </div>
              )}
            </div>
          )}

          {/* STEP: Preview */}
          {step === 'preview' && parseResults.length > 0 && (
            <div className="space-y-4">
              {/* Metadados */}
              <div className="bg-gray-50 p-3 rounded space-y-2 text-[9px]">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="opacity-60 uppercase">
                      {parseResults.length > 1 ? 'Competências' : 'Competência'}
                    </p>
                    <p className="font-bold">
                      {parseResults.length > 1
                        ? `${parseResults[0]!.competencia} … ${parseResults[parseResults.length - 1]!.competencia} (${parseResults.length} meses)`
                        : parseResults[0]!.competencia}
                    </p>
                  </div>
                  <div>
                    <p className="opacity-60 uppercase">Data</p>
                    <p className="font-bold">
                      {parseResults.length > 1 ? '1 data por competência' : parseResults[0]!.data}
                    </p>
                  </div>
                  {parseResults[0]!.empresa && (
                    <div className="col-span-2">
                      <p className="opacity-60 uppercase">Empresa</p>
                      <p className="font-bold">{parseResults[0]!.empresa}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Sumário */}
              {sumario && (
                <div className="bg-green-50 p-3 rounded border border-green-300 text-[9px] space-y-2">
                  <p className="font-bold text-green-800">SUMÁRIO</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="opacity-60">Proventos:</span>
                      <p className="font-bold text-green-700">
                        {sumario.totalProventos.toLocaleString('pt-BR', {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div>
                      <span className="opacity-60">Descontos:</span>
                      <p className="font-bold text-red-700">
                        {sumario.totalDescontos.toLocaleString('pt-BR', {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div>
                      <span className="opacity-60">Lançamentos:</span>
                      <p className="font-bold">{sumario.qtdLancamentos}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabela de lançamentos */}
              <div className="overflow-x-auto">
                <table className="w-full text-[8px] border-collapse">
                  <thead>
                    <tr className="bg-gray-100 border-b">
                      {parseResults.length > 1 && (
                        <th className="p-2 text-left font-bold">Competência</th>
                      )}
                      <th className="p-2 text-left font-bold">Rubrica</th>
                      <th className="p-2 text-left font-bold">Nome</th>
                      <th className="p-2 text-left font-bold">Tipo</th>
                      <th className="p-2 text-right font-bold">Valor</th>
                      <th className="p-2 text-center font-bold">Nat.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lancamentos.map((l, idx) => (
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        {parseResults.length > 1 && (
                          <td className="p-2 font-mono">{l.competencia}</td>
                        )}
                        <td className="p-2 font-mono">{l.rubrica}</td>
                        <td className="p-2 truncate">{l.nomeRubrica}</td>
                        <td className="p-2">
                          <span
                            className={cn(
                              'px-1.5 py-0.5 rounded text-[7px] font-bold',
                              l.tipo === 'PROVENTOS'
                                ? 'bg-green-100 text-green-800'
                                : l.tipo === 'DESCONTOS'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-blue-100 text-blue-800',
                            )}
                          >
                            {l.tipo === 'PROVENTOS' ? 'PROV' : l.tipo === 'DESCONTOS' ? 'DESC' : 'INFO'}
                          </span>
                        </td>
                        <td className="p-2 text-right font-mono">
                          {l.valor.toLocaleString('pt-BR', {
                            minimumFractionDigits: 2,
                          })}
                        </td>
                        <td className="p-2 text-center">
                          <span
                            className={cn(
                              'font-bold',
                              l.natureza === 'D' ? 'text-red-600' : 'text-green-600',
                            )}
                          >
                            {l.natureza}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Botões */}
              <div className="flex gap-2">
                <button
                  onClick={handleExportCSV}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 font-bold rounded border border-blue-300 hover:bg-blue-200 text-[10px]"
                >
                  <Download size={14} />
                  Exportar CSV
                </button>
                <button
                  onClick={() => setStep('confirm')}
                  className="flex-1 px-4 py-2 bg-green-100 text-green-700 font-bold rounded border border-green-300 hover:bg-green-200 text-[10px]"
                >
                  Confirmar
                </button>
              </div>
            </div>
          )}

          {/* STEP: Confirm */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 border-2 border-green-300 rounded">
                <p className="text-[10px] font-bold text-green-800">PRONTO PARA IMPORTAR</p>
                <p className="text-[9px] text-green-700 mt-2">
                  ✅ {lancamentos.length} lançamento(s) serão criados
                </p>
              </div>

              {/* Botões */}
              <div className="flex gap-2">
                <button
                  onClick={() => setStep('preview')}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 font-bold rounded border border-gray-300 hover:bg-gray-200 text-[10px]"
                >
                  Voltar
                </button>
                <button
                  onClick={handleConfirm}
                  className="flex-1 px-4 py-2 bg-green-600 text-white font-bold rounded hover:bg-green-700 text-[10px]"
                >
                  ✓ IMPORTAR AGORA
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
