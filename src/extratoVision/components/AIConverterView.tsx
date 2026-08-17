import React, { useRef, useState } from "react";
import { Upload, FileText, Download, CheckCircle, AlertCircle, Loader2, ArrowRight, ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { AIVisionSettings, Transaction } from "../types";
import { extractTransactionsFromPageImage } from "../utils/aiVisionExtract";
import { getSyncedVisionModels, saveAIVisionSettings } from "../utils/aiVisionModels";
import { buildOFXString } from "../utils/ofxBuilder";

/** "AAAA-MM-DD" (input type=date) → "DD/MM/AAAA". */
const isoToBr = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/** "DD/MM/AAAA" → número comparável AAAAMMDD (NaN se a data for ilegível). */
const brDateToNum = (br: string): number => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec((br || "").trim());
  if (!m) return NaN;
  const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
  return Number(yr) * 10_000 + Number(m[2]) * 100 + Number(m[1]);
};

interface AIConverterViewProps {
  aiVisionSettings: AIVisionSettings;
  onSettingsChange: (settings: AIVisionSettings) => void;
  onOpenSettings: () => void;
  onBack: () => void;
  /** Envia as transações extraídas direto para a Conciliação do sistema (quando aberto de lá). */
  onImportTransactions?: (transactions: Transaction[]) => void;
}

/**
 * Tela dedicada do modo "Usar IA para converter" — visual claro/Google-style, separado do tema
 * escuro do resto do app. Faz a extração de verdade (renderiza cada página do PDF e manda pro
 * modelo de IA configurado), não depende de nenhum backend externo.
 */
export const AIConverterView: React.FC<AIConverterViewProps> = ({ aiVisionSettings, onSettingsChange, onOpenSettings, onBack, onImportTransactions }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Período opcional da extração — evita que a IA "escolha" só um mês quando o PDF tem vários.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const acceptFile = (f: File | undefined | null) => {
    if (!f) return;
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    const isImage = f.type.startsWith("image/");
    const isExcel = /\.(xlsx?|xls)$/i.test(f.name) || f.type.includes("spreadsheet");
    const isTxt = /\.(txt|csv)$/i.test(f.name) || f.type.includes("text");

    if (isPdf || isImage || isExcel || isTxt) {
      setFile(f);
      setError(null);
      setTransactions(null);
    } else {
      setError("Por favor, selecione um arquivo válido: PDF, imagem, Excel ou TXT.");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    acceptFile(e.target.files?.[0]);
    if (e.target) e.target.value = "";
  };

  const handleConvert = async () => {
    if (!file) return;

    const apiKey = aiVisionSettings.apiKeys[aiVisionSettings.provider];
    if (!apiKey) {
      setError('Nenhuma chave de API configurada. Abra as configurações da IA (ícone de engrenagem) para colar sua chave.');
      onOpenSettings();
      return;
    }

    setIsUploading(true);
    setError(null);
    setTransactions(null);
    cancelRef.current = false;

    try {
      // Confere se o modelo salvo ainda está disponível no Google antes de gastar tempo
      // renderizando o PDF inteiro.
      let activeSettings = aiVisionSettings;
      try {
        const fresh = await getSyncedVisionModels(apiKey, false);
        if (fresh.length > 0 && !fresh.some(m => m.id === activeSettings.modelId)) {
          activeSettings = { ...activeSettings, modelId: fresh[0].id };
          saveAIVisionSettings(activeSettings);
          onSettingsChange(activeSettings);
        }
      } catch (syncErr) {
        console.warn('[AIConverterView] Não foi possível sincronizar modelos, seguindo com a configuração salva:', syncErr);
      }

      // Detectar tipo de arquivo
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const isImage = file.type.startsWith("image/");
      const isExcel = /\.(xlsx?|xls)$/i.test(file.name);
      const isTxt = /\.(txt|csv)$/i.test(file.name);

      let pageImages: string[] = [];

      if (isImage) {
        // Imagem: usar diretamente
        setProgressMsg("Lendo imagem com IA...");
        const reader = new FileReader();
        pageImages = await new Promise((resolve, reject) => {
          reader.onload = (e) => {
            const result = e.target?.result as string;
            resolve([result]);
          };
          reader.onerror = () => reject(new Error("Erro ao ler imagem"));
          reader.readAsDataURL(file);
        });
      } else if (isPdf) {
        // PDF: renderizar páginas
        setProgressMsg("Renderizando páginas do PDF...");
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        for (let p = 1; p <= pdf.numPages; p++) {
          if (cancelRef.current) break;
          const page = await pdf.getPage(p);
          // Zoom alto = mais precisão de leitura: renderiza a página com o maior lado ~3000px
          // (o scale fixo 1.5 gerava ~1240px numa página A4, borrando números pequenos e
          // anotações à mão — principal causa de lançamentos pulados/valores errados).
          const baseViewport = page.getViewport({ scale: 1 });
          const targetScale = Math.min(
            4,
            Math.max(2, 3000 / Math.max(baseViewport.width, baseViewport.height)),
          );
          const viewport = page.getViewport({ scale: targetScale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const context = canvas.getContext('2d');
          await page.render({ canvasContext: context!, viewport }).promise;
          // Qualidade JPEG alta (0.95): compressão agressiva criava artefatos em dígitos finos.
          pageImages.push(canvas.toDataURL('image/jpeg', 0.95));
        }
      } else if (isTxt) {
        // TXT/CSV: renderizar como texto em imagem
        setProgressMsg("Convertendo TXT em imagem...");
        const text = await file.text();
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 1600;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Não foi possível criar canvas");

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000000';
        ctx.font = '14px monospace';

        const lines = text.split('\n').slice(0, 80);
        lines.forEach((line, i) => {
          ctx.fillText(line.slice(0, 140), 40, 40 + i * 20);
        });

        pageImages = [canvas.toDataURL('image/jpeg', 0.85)];
      } else if (isExcel) {
        // Excel: renderizar como imagem
        setProgressMsg("Convertendo Excel em imagem...");
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 1600;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Não foi possível criar canvas");

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#2D2D2D';
        ctx.font = '13px Arial';

        ctx.fillText(`Arquivo Excel: ${file.name}`, 40, 40);
        ctx.fillText('Lendo dados...', 40, 70);

        pageImages = [canvas.toDataURL('image/jpeg', 0.85)];
      } else {
        throw new Error("Tipo de arquivo não suportado");
      }

      const allTx: Transaction[] = [];
      const pageErrors: string[] = [];

      // Período informado pelo usuário (DD/MM/AAAA) — vai junto no prompt de cada página.
      const dateRange = dateFrom || dateTo
        ? { from: dateFrom ? isoToBr(dateFrom) : undefined, to: dateTo ? isoToBr(dateTo) : undefined }
        : undefined;

      // Páginas são lidas EM PARALELO (com limite de simultaneidade) — antes era 1 por vez, o
      // que fazia um PDF de 7 páginas demorar 7x o tempo de uma. A continuidade de datas entre
      // páginas (linhas sem data no início da página) é resolvida DEPOIS, de forma
      // determinística, propagando a última data da página anterior — sem perder precisão.
      const CONCURRENCY = 3;
      const pageResults: (Transaction[] | null)[] = new Array(pageImages.length).fill(null);
      let donePages = 0;
      let nextPage = 0;
      setProgressMsg(`Lendo ${pageImages.length} página(s) com IA (0/${pageImages.length})...`);

      const worker = async () => {
        while (nextPage < pageImages.length) {
          if (cancelRef.current) return;
          const p = nextPage++;
          try {
            pageResults[p] = await extractTransactionsFromPageImage(pageImages[p], activeSettings, p + 1, undefined, dateRange);
          } catch (pageErr) {
            const msg = (pageErr as Error).message || String(pageErr);
            console.error(`[AIConverterView] Erro na página ${p + 1}:`, pageErr);
            pageErrors.push(`Página ${p + 1}: ${msg}`);
          }
          donePages++;
          setProgressMsg(`Lendo ${pageImages.length} página(s) com IA (${donePages}/${pageImages.length})...`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pageImages.length) }, worker));

      // Junta na ordem original das páginas e preenche datas vazias (página que começa no meio
      // de um dia) com a última data válida vista — mesmo comportamento do fluxo sequencial.
      let lastDateSeen = '';
      for (const pageTx of pageResults) {
        if (!pageTx) continue;
        for (const tx of pageTx) {
          if (tx.data) lastDateSeen = tx.data;
          else if (lastDateSeen) tx.data = lastDateSeen;
        }
        allTx.push(...pageTx.filter(tx => tx.data));
      }

      if (pageErrors.length > 0 && pageErrors.length === pageImages.length) {
        throw new Error(`A IA falhou em todas as ${pageImages.length} página(s). Detalhe: ${pageErrors[0]}`);
      }

      // Filtro determinístico pelo período informado — mesmo que a IA ignore a instrução, só
      // entram lançamentos dentro do intervalo (datas ilegíveis são mantidas para revisão).
      let finalTx = allTx;
      if (dateRange) {
        const fromNum = dateRange.from ? brDateToNum(dateRange.from) : -Infinity;
        const toNum = dateRange.to ? brDateToNum(dateRange.to) : Infinity;
        finalTx = allTx.filter(tx => {
          const n = brDateToNum(tx.data);
          return isNaN(n) || (n >= fromNum && n <= toNum);
        });
      }

      if (!cancelRef.current) setTransactions(finalTx);
    } catch (err: any) {
      setError(err.message || "Erro ao converter arquivo.");
    } finally {
      setIsUploading(false);
    }
  };

  const downloadOFX = () => {
    if (!transactions) return;
    const ofx = buildOFXString(transactions);
    const blob = new Blob([ofx], { type: "application/x-ofx;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file?.name.replace(/\.pdf$/i, "") || "extrato"}.ofx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-full bg-[#FDFCFB] text-[#2D2D2D] font-sans rounded-lg overflow-auto">
      <header className="border-b border-[#EAEAEA] bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-[#5F6368] hover:text-[#1A73E8] flex items-center gap-1 text-sm font-medium">
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
            <div className="w-px h-6 bg-[#EAEAEA]" />
            <div className="bg-[#1A73E8] p-1.5 rounded-lg">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">PDF para OFX (IA)</h1>
          </div>
          <button onClick={onOpenSettings} title="Configurar IA" className="text-[#5F6368] hover:text-[#1A73E8] p-2 rounded-lg hover:bg-[#F1F3F4]">
            <SettingsIcon className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5 space-y-8">
            <section>
              <h2 className="text-3xl font-bold mb-4 tracking-tight">Converta seu extrato em segundos</h2>
              <p className="text-lg text-[#5F6368] leading-relaxed">
                Lê PDFs escaneados (sem texto) e anotações escritas à mão usando IA com visão.
              </p>
            </section>

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                acceptFile(e.dataTransfer.files[0]);
              }}
              className={`
                border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer transition-all duration-300
                ${file ? 'border-[#1A73E8] bg-[#E8F0FE]' : 'border-[#DADCE0] hover:border-[#1A73E8] hover:bg-[#F8F9FA]'}
              `}
            >
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".pdf" className="hidden" />

              <AnimatePresence mode="wait">
                {file ? (
                  <motion.div
                    key="file"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex flex-col items-center text-center"
                  >
                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4 border border-[#EAEAEA]">
                      <CheckCircle className="w-8 h-8 text-[#1A73E8]" />
                    </div>
                    <p className="font-medium text-lg truncate max-w-[250px]">{file.name}</p>
                    <p className="text-sm text-[#707070]">{(file.size / 1024).toFixed(1)} KB</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); setFile(null); setTransactions(null); }}
                      className="mt-4 text-sm text-[#D93025] hover:underline"
                    >
                      Remover arquivo
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center text-center"
                  >
                    <div className="w-16 h-16 bg-[#F1F3F4] rounded-full flex items-center justify-center mb-4">
                      <Upload className="w-8 h-8 text-[#5F6368]" />
                    </div>
                    <p className="font-medium text-lg">Selecione ou arraste o PDF</p>
                    <p className="text-sm text-[#707070]">Extratos escaneados de qualquer banco</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="bg-white border border-[#EAEAEA] rounded-2xl p-5 space-y-3">
              <div>
                <p className="font-medium text-sm">Período do extrato (opcional)</p>
                <p className="text-xs text-[#707070]">
                  Se o PDF tiver mais de um mês, informe de qual data até qual data extrair — a IA lê o
                  período inteiro, sem pular nenhum mês.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ai-date-from" className="block text-xs font-medium text-[#5F6368] mb-1">
                    De
                  </label>
                  <input
                    id="ai-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full border border-[#DADCE0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1A73E8]"
                  />
                </div>
                <div>
                  <label htmlFor="ai-date-to" className="block text-xs font-medium text-[#5F6368] mb-1">
                    Até
                  </label>
                  <input
                    id="ai-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full border border-[#DADCE0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1A73E8]"
                  />
                </div>
              </div>
            </div>

            <button
              disabled={!file || isUploading}
              onClick={handleConvert}
              className={`
                w-full py-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-sm
                ${!file || isUploading
                  ? 'bg-[#F1F3F4] text-[#9AA0A6] cursor-not-allowed'
                  : 'bg-[#1A73E8] text-white hover:bg-[#1557B0] hover:shadow-md active:scale-[0.98]'}
              `}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Processando...</span>
                </>
              ) : (
                <>
                  <span>Converter Agora</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-[#FEEFC3] border border-[#FBE094] rounded-xl flex items-start gap-3 text-[#B05E27]"
              >
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm font-medium">{error}</p>
              </motion.div>
            )}
          </div>

          <div className="lg:col-span-7">
            <AnimatePresence mode="wait">
              {transactions ? (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="bg-white border border-[#EAEAEA] rounded-2xl shadow-sm overflow-hidden flex flex-col h-full min-h-[500px]"
                >
                  <div className="p-6 border-b border-[#EAEAEA] flex items-center justify-between bg-[#F8F9FA]">
                    <div>
                      <h3 className="font-bold text-lg">Prévia das Transações</h3>
                      <p className="text-sm text-[#707070]">{transactions.length} registros encontrados</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {onImportTransactions && (
                        <button
                          onClick={() => onImportTransactions(transactions)}
                          disabled={transactions.length === 0}
                          className="bg-[#1A73E8] text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-[#1557B0] transition-colors font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Envia os lançamentos extraídos direto para a Conciliação, sem precisar baixar o OFX"
                        >
                          <ArrowRight className="w-4 h-4" />
                          Importar para Conciliação
                        </button>
                      )}
                      <button
                        onClick={downloadOFX}
                        disabled={transactions.length === 0}
                        className="bg-[#34A853] text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-[#2D8F47] transition-colors font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Download className="w-4 h-4" />
                        Download OFX
                      </button>
                    </div>
                  </div>

                  <div className="overflow-auto flex-1 max-h-[600px]">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-[#F8F9FA] z-10">
                        <tr className="border-b border-[#EAEAEA]">
                          <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#5F6368]">Data</th>
                          <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#5F6368]">Descrição</th>
                          <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#5F6368] text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F3F4]">
                        {transactions.map((tx, idx) => {
                          const signedAmount = tx.cd === 'D' ? -Math.abs(tx.valor) : Math.abs(tx.valor);
                          return (
                            <tr key={idx} className="hover:bg-[#FDFCFB] transition-colors">
                              <td className="px-6 py-4 text-sm font-medium whitespace-nowrap">{tx.data}</td>
                              <td className="px-6 py-4 text-sm text-[#5F6368]">{tx.historico}</td>
                              <td className={`px-6 py-4 text-sm font-bold text-right whitespace-nowrap ${signedAmount < 0 ? 'text-[#D93025]' : 'text-[#188038]'}`}>
                                {signedAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              </td>
                            </tr>
                          );
                        })}
                        {transactions.length === 0 && (
                          <tr>
                            <td colSpan={3} className="px-6 py-10 text-center text-[#707070]">
                              A IA não encontrou nenhum lançamento aproveitável neste PDF.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="p-4 bg-[#F8F9FA] border-t border-[#EAEAEA] text-center">
                    <p className="text-xs text-[#707070]">
                      Verifique os dados antes de importar para seu sistema financeiro.
                    </p>
                  </div>
                </motion.div>
              ) : (
                <div key="empty-state" className="bg-[#F8F9FA] border border-[#DADCE0] border-dashed rounded-2xl flex flex-col items-center justify-center h-full min-h-[500px] text-[#707070]">
                  {isUploading ? (
                    <div className="flex flex-col items-center gap-4">
                      <Loader2 className="w-12 h-12 text-[#1A73E8] animate-spin" />
                      <div className="text-center">
                        <p className="font-semibold text-lg text-[#2D2D2D]">Analisando seu extrato...</p>
                        <p className="text-sm">{progressMsg || "Isso pode levar alguns segundos dependendo do tamanho do PDF."}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4 px-12 text-center">
                      <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-sm">
                        <FileText className="w-10 h-10 text-[#DADCE0]" />
                      </div>
                      <p className="text-lg">Os resultados da conversão aparecerão aqui</p>
                    </div>
                  )}
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
};
