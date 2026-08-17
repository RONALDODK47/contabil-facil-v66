import React, { useState, useRef, useEffect, useMemo } from "react";
import Tesseract from 'tesseract.js';
import { Transaction, ScannedLine } from './types';
import { extractLinesFromPDF, parsePlainText } from './utils/parser';
import { processExcelFile } from './utils/excelParser';
import * as XLSX from 'xlsx';
import { ExtractionConfigModal } from './components/ExtractionConfigModal';
import { BBExtratoPreviewLayout } from './components/BBExtratoPreviewLayout';
import { LayoutSelector } from '../contabilfacil/components/LayoutSelector';
import { BankCode } from '../lib/extratoParser/bankFormats';
import { ExtractionConfig } from './types';

interface ExtratoVisionAppProps {
  initialMode?: 'ia';
  initialFile?: File;
  onClose?: () => void;
  onImportTransactions?: (transactions: Transaction[]) => void;
}

export const ExtratoVisionApp: React.FC<ExtratoVisionAppProps> = ({
  initialMode,
  initialFile,
  onClose,
  onImportTransactions,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [appState, setAppState] = useState<'idle' | 'analyzing' | 'scanning' | 'results'>('idle');
  const [allScannedLines, setAllScannedLines] = useState<ScannedLine[]>([]);
  const [linesProcessedCount, setLinesProcessedCount] = useState<number>(0);
  const [validTransactions, setValidTransactions] = useState<Transaction[]>([]);
  const [pdfViewport, setPdfViewport] = useState<any>(null);
  const [currentPageRendered, setCurrentPageRendered] = useState<number>(1);
  const [processingMsg, setProcessingMsg] = useState("Iniciando...");
  const [previewType, setPreviewType] = useState<'pdf' | 'image' | 'excel' | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const pageImagesRef = useRef<string[]>([]);
  const [scanProgress, setScanProgress] = useState(0);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [extractionConfig, setExtractionConfig] = useState<ExtractionConfig | null>(null);
  const [pendingDateRange, setPendingDateRange] = useState<{from:string;to:string} | null>(null);
  const [showLayoutSelector, setShowLayoutSelector] = useState(false);
  const [bankCode, setBankCode] = useState<BankCode>('BANCO_DO_BRASIL');
  const [selectedLayout, setSelectedLayout] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (initialFile) {
      pendingFileRef.current = initialFile;
      askDateRange().then(range => {
        setPendingDateRange(range);
        const ext = initialFile.name.split('.').pop()?.toLowerCase();
        if (ext === 'pdf' || ['png', 'jpg', 'jpeg'].includes(ext || '')) {
          setShowConfigModal(true);
        } else {
          processFileDispatcher(initialFile, range);
        }
      });
    }
  }, [initialFile]);

  const downloadExcel = () => {
    const ws = XLSX.utils.json_to_sheet(validTransactions.map(t => ({
      Data: t.data,
      Histórico: t.historico,
      Valor: t.valor,
      Tipo: t.cd === 'C' ? 'Crédito' : 'Débito'
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Extrato");
    XLSX.writeFile(wb, `extrato_vision_${new Date().getTime()}.xlsx`);
  };

  useEffect(() => {
    if (appState === 'scanning' && previewType && previewType !== 'pdf') {
      let anim: NodeJS.Timeout;
      setScanProgress(0);
      anim = setInterval(() => {
        setScanProgress(p => {
          if (p >= 1) {
            clearInterval(anim);
            return 1;
          }
          return Math.min(1, p + 0.02);
        });
      }, 50);
      return () => clearInterval(anim);
    }
  }, [appState, previewType]);

  useEffect(() => {
    if (previewType === 'excel' && appState === 'scanning' && previewData) {
      const idx = Math.min(previewData.length - 1, Math.floor(scanProgress * previewData.length));
      const row = document.getElementById(`excel-row-${idx}`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [scanProgress, previewData, previewType, appState]);
  
  const [showDateModal, setShowDateModal] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const pendingFileRef = useRef<File | null>(null);
  const dateResolveRef = useRef<((range: {from:string;to:string}) => void) | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<boolean>(false);

  const totals = useMemo(() => {
    return validTransactions.reduce((acc, t) => {
      if (t.cd === 'C') acc.credits += Math.abs(t.valor);
      else acc.debits += Math.abs(t.valor);
      return acc;
    }, { credits: 0, debits: 0 });
  }, [validTransactions]);

  const netBalance = validTransactions.reduce((acc, t) => acc + t.valor, 0);

  useEffect(() => {
    if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [linesProcessedCount]);

  useEffect(() => {
    return () => {
      if (previewType === 'image' && Array.isArray(previewData)) {
        previewData.forEach((url: string) => URL.revokeObjectURL(url));
      }
    };
  }, [previewData, previewType]);

  const askDateRange = (): Promise<{from:string;to:string}> => {
    return new Promise(resolve => {
      dateResolveRef.current = resolve;
      setDateFrom('');
      setDateTo('');
      setShowDateModal(true);
    });
  };

  const confirmDateRange = () => {
    setShowDateModal(false);
    if (dateResolveRef.current) {
      dateResolveRef.current({ from: dateFrom, to: dateTo });
      dateResolveRef.current = null;
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files as FileList | null;
    if (files && files.length > 0) {
      if (files.length > 1) {
        const urls = Array.from(files).map((f: File) => URL.createObjectURL(f));
        setPreviewType('image');
        setPreviewData(urls);
        setPreviewIndex(0);
      }
      const first: File = files[0];
      if (first) {
        pendingFileRef.current = first;
        askDateRange().then(range => {
          setPendingDateRange(range);
          const ext = first.name.split('.').pop()?.toLowerCase();
          if (ext === 'pdf' || ['png', 'jpg', 'jpeg'].includes(ext || '')) {
            setShowConfigModal(true);
          } else {
            processFileDispatcher(first, range);
          }
        });
      }
    }
    if (e.target) e.target.value = "";
  };

  const handleConfigConfirm = (config: ExtractionConfig) => {
    setExtractionConfig(config);
    setShowConfigModal(false);
    if (pendingFileRef.current && pendingDateRange) {
      processFileDispatcher(pendingFileRef.current, pendingDateRange, config);
    }
  };

  const processFileDispatcher = async (f: File, dateRange?: {from:string;to:string}, config?: ExtractionConfig) => {
    cancelRef.current = false;
    setFile(f);
    setAppState('analyzing');
    setValidTransactions([]);
    setAllScannedLines([]);
    setLinesProcessedCount(0);

    let inferredYear = '';
    if (dateRange?.from) {
      const parts = dateRange.from.split('/');
      if (parts.length > 0) {
        let yr = parts[parts.length - 1];
        if (yr.length === 2) yr = '20' + yr;
        if (yr.length === 4) inferredYear = yr;
      }
    }
    if (!inferredYear && dateRange?.to) {
      const parts = dateRange.to.split('/');
      if (parts.length > 0) {
        let yr = parts[parts.length - 1];
        if (yr.length === 2) yr = '20' + yr;
        if (yr.length === 4) inferredYear = yr;
      }
    }

    const ext = f.name.split('.').pop()?.toLowerCase();
    const ignoreList: string[] = [];

    if (ext === 'pdf') {
      await processPDF(f, inferredYear, dateRange, ignoreList, config);
    } else if (['png', 'jpg', 'jpeg'].includes(ext || '')) {
      setPreviewType('image');
      const url = URL.createObjectURL(f);
      setPreviewData([url]);
      setPreviewIndex(0);
      await processImage(f, inferredYear, dateRange, ignoreList, config);
    } else if (['xlsx', 'xls', 'csv'].includes(ext || '')) {
      setPreviewType('excel');
      await processExcel(f, ignoreList);
    } else {
      alert("Formato não suportado!");
      setAppState('idle');
    }
  };

  const processExcel = async (f: File, ignoreList?: string[]) => {
    try {
      setPreviewType('excel');
      setScanProgress(0);
      setProcessingMsg("Lendo planilha...");
      setAppState('scanning');
      
      const { transactions, rows } = await processExcelFile(f, ignoreList);

      setValidTransactions(transactions);
      setPreviewData(rows);
      setScanProgress(1);
      setAppState('results');
    } catch (e) {
      console.error(e);
      alert("Erro ao processar arquivo Excel. Verifique se o formato é válido.");
      setAppState('idle');
    }
  };

  const processImage = async (f: File, inferredYear?: string, dateRange?: {from:string;to:string}, ignoreList?: string[], config?: ExtractionConfig) => {
    setPreviewType('image');
    setProcessingMsg("Analisando imagem...");
    setScanProgress(0);
    setAppState('scanning');
    
    try {
      const { data: { text } } = await Tesseract.recognize(f, 'por', {
        logger: m => {
          if (m.status === 'recognizing text') {
            setScanProgress(m.progress);
            setProcessingMsg(`Extraindo texto: ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      console.log("OCR Image Text:", text.substring(0, 500));

      let transactions = parsePlainText(text, inferredYear, ignoreList, config);
      
      if (dateRange && dateRange.from && dateRange.to) {
        const fParts = dateRange.from.split('/');
        const tParts = dateRange.to.split('/');
        if (fParts.length >= 2 && tParts.length >= 2) {
          let fDay = 1, fMonth = 1, fYear = parseInt(new Date().getFullYear().toString());
          if (fParts.length === 3) { fDay = parseInt(fParts[0]); fMonth = parseInt(fParts[1]); fYear = parseInt(fParts[2].length === 2 ? '20'+fParts[2] : fParts[2]); }
          else if (fParts.length === 2) { fDay = 1; fMonth = parseInt(fParts[0]); fYear = parseInt(fParts[1].length === 2 ? '20'+fParts[1] : fParts[1]); }
          
          let tDay = 31, tMonth = 12, tYear = parseInt(new Date().getFullYear().toString());
          if (tParts.length === 3) { tDay = parseInt(tParts[0]); tMonth = parseInt(tParts[1]); tYear = parseInt(tParts[2].length === 2 ? '20'+tParts[2] : tParts[2]); }
          else if (tParts.length === 2) { tMonth = parseInt(tParts[0]); tYear = parseInt(tParts[1].length === 2 ? '20'+tParts[1] : tParts[1]); tDay = new Date(tYear, tMonth, 0).getDate(); }

          const fTime = new Date(fYear, fMonth-1, fDay).getTime();
          const tTime = new Date(tYear, tMonth-1, tDay).getTime();
          
          transactions = transactions.filter(t => {
            const dParts = t.data.split('/');
            if (dParts.length !== 3) return true;
            const dTime = new Date(parseInt(dParts[2]), parseInt(dParts[1])-1, parseInt(dParts[0])).getTime();
            if (dTime < fTime || dTime > tTime) {
              console.log(`[App] Transaction ignored (out of bounds array): ${t.data} - ${t.historico}`);
              return false;
            }
            return true;
          });
        }
      }

      setValidTransactions(transactions.map((t, i) => ({ ...t, id: `img-${i}` })));
      setScanProgress(1);
      setAppState('results');
    } catch (e) {
      console.error(e);
      alert("Erro ao processar imagem localmente.");
      setAppState('idle');
    }
  };

  const processPDF = async (pdfFile: File, inferredYear?: string, dateRange?: {from:string;to:string}, ignoreList?: string[], config?: ExtractionConfig) => {
    setPreviewType('image');
    setPreviewData([]);
    setPreviewIndex(0);
    pageImagesRef.current = [];

    setProcessingMsg("Analizando PDF...");
    const lines = await extractLinesFromPDF(pdfFile, inferredYear, setProcessingMsg, ignoreList, config);
    setAllScannedLines(lines);

    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageImages: string[] = [];
    pageImagesRef.current = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      if (cancelRef.current) break;
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context!, viewport }).promise;

      try {
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((it: any) => it.str).join(' ');
        const isBB = /banco do brasil|extrato de conta corrente/i.test(pageText);
        const isSicredi = /sicredi/i.test(pageText) || (/cooperativa/i.test(pageText) && /associado/i.test(pageText));

        if (isBB || isSicredi) {
          const drawWhiteBox = (it: any) => {
            const itemWidth = it.width || ((it.str || '').length * 6);
            const itemHeight = it.height || 10;
            const [x1, y1] = viewport.convertToViewportPoint(it.transform[4] - 2, it.transform[5] + itemHeight + 2);
            const [x2, y2] = viewport.convertToViewportPoint(it.transform[4] + itemWidth + 2, it.transform[5] - 2);
            context!.fillStyle = 'white';
            context!.fillRect(x1, y1, x2 - x1, y2 - y1);
          };

          if (isBB) {
            let headerY = -1;
            let footerY = -1;
            for (const it of textContent.items) {
              const text = (it.str || '').trim();
              if (/lan[çc]amentos|hist[óo]rico|documento|valor/i.test(text)) {
                if (headerY === -1 || it.transform[5] < headerY) {
                  headerY = it.transform[5];
                }
              }
              if (/aplica[çc][õo]es financeiras|confirma[çc][ãa]o/i.test(text)) {
                footerY = it.transform[5];
              }
            }
            if (headerY === -1) headerY = 800;
            if (footerY === -1) footerY = 0;

            let clienteY = -1;
            for (const it of textContent.items) {
              if (/cliente/i.test(it.str || '')) {
                clienteY = it.transform[5];
                break;
              }
            }

            for (const it of textContent.items) {
              const text = (it.str || '').trim();
              if (!text) continue;
              const itemY = it.transform[5];

              if (clienteY !== -1 && Math.abs(itemY - clienteY) < 5) {
                if (!/cliente/i.test(text)) {
                  drawWhiteBox(it);
                  continue;
                }
              }
              if (/ag[êe]ncia|conta/i.test(text)) {
                drawWhiteBox(it);
                continue;
              }
              if (itemY < headerY && itemY > footerY) {
                drawWhiteBox(it);
                continue;
              }
            }
          }

          if (isSicredi) {
            let headerY = -1;
            let footerY = -1;
            for (const it of textContent.items) {
              const text = (it.str || '').trim();
              if (/descri[çc][ãa]o|documento|saldo/i.test(text)) {
                if (headerY === -1 || it.transform[5] < headerY) {
                  headerY = it.transform[5];
                }
              }
              if (/sicredi fone|sac |ouvidoria/i.test(text)) {
                footerY = it.transform[5];
              }
            }
            if (headerY === -1) headerY = 800;
            if (footerY === -1) footerY = 0;

            let associadoY = -1;
            for (const it of textContent.items) {
              if (/associado/i.test(it.str || '')) {
                associadoY = it.transform[5];
                break;
              }
            }

            for (const it of textContent.items) {
              const text = (it.str || '').trim();
              if (!text) continue;
              const itemY = it.transform[5];

              if (associadoY !== -1 && Math.abs(itemY - associadoY) < 5) {
                if (!/associado/i.test(text)) {
                  drawWhiteBox(it);
                  continue;
                }
              }
              if (/cooperativa|conta/i.test(text)) {
                drawWhiteBox(it);
                continue;
              }
              if (itemY > headerY && /\d{2}\/\d{2}\/\d{4}/.test(text)) {
                drawWhiteBox(it);
                continue;
              }
              if (itemY < headerY && itemY > footerY) {
                drawWhiteBox(it);
                continue;
              }
            }
          }
        }
      } catch (err) {
        console.error("Error applying redactions to preview canvas:", err);
      }

      const dataUrl = canvas.toDataURL();
      pageImages.push(dataUrl);
      pageImagesRef.current.push(dataUrl);
      setPreviewData([...pageImages]);
      if (p === 1) {
        setAppState('scanning');
      }
    }
    setAppState('scanning');
    let internalCurrentPage = 1;
    
    let fTime = 0, tTime = 0;
    if (dateRange && dateRange.from && dateRange.to) {
      const fParts = dateRange.from.split('/');
      const tParts = dateRange.to.split('/');
      if (fParts.length >= 2 && tParts.length >= 2) {
        let fDay = 1, fMonth = 1, fYear = parseInt(new Date().getFullYear().toString());
        if (fParts.length === 3) { fDay = parseInt(fParts[0]); fMonth = parseInt(fParts[1]); fYear = parseInt(fParts[2].length === 2 ? '20'+fParts[2] : fParts[2]); }
        else if (fParts.length === 2) { fDay = 1; fMonth = parseInt(fParts[0]); fYear = parseInt(fParts[1].length === 2 ? '20'+fParts[1] : fParts[1]); }
        
        let tDay = 31, tMonth = 12, tYear = parseInt(new Date().getFullYear().toString());
        if (tParts.length === 3) { tDay = parseInt(tParts[0]); tMonth = parseInt(tParts[1]); tYear = parseInt(tParts[2].length === 2 ? '20'+tParts[2] : tParts[2]); }
        else if (tParts.length === 2) { tMonth = parseInt(tParts[0]); tYear = parseInt(tParts[1].length === 2 ? '20'+tParts[1] : tParts[1]); tDay = new Date(tYear, tMonth, 0).getDate(); }

        fTime = new Date(fYear, fMonth-1, fDay).getTime();
        tTime = new Date(tYear, tMonth-1, tDay).getTime();
      }
    }

    for (let i = 0; i < (lines || []).length; i++) {
      if (cancelRef.current) { setAppState('idle'); return; }
      const line = lines[i];
      if (line.page !== internalCurrentPage) {
        internalCurrentPage = line.page;
        setPreviewIndex(internalCurrentPage - 1);
        await new Promise(r => setTimeout(r, 400));
      }
      if (line.type === 'TRANSACTION' && line.transactionData) {
        let inBounds = true;
        if (fTime > 0 && tTime > 0) {
          const dParts = line.transactionData.data.split('/');
          if (dParts.length === 3) {
            let cYear = dParts[2];
            if (cYear.length === 2) cYear = '20' + cYear;
            const dTime = new Date(parseInt(cYear), parseInt(dParts[1])-1, parseInt(dParts[0])).getTime();
            if (dTime < fTime || dTime > tTime) {
              inBounds = false;
              console.log(`[App] Transaction ignored (out of bounds array): ${line.transactionData.data} - ${line.transactionData.historico}`);
            }
          } else if (dParts.length === 2) {
            // Se veio só dia/mês, assume-se que se enquadra se não temos como constatar
          }
        }
        
        if (inBounds) {
          setValidTransactions(prev => [...prev, line.transactionData!]);
        }
      }
      setLinesProcessedCount(i + 1);
      await new Promise(r => setTimeout(r, 30));
    }
    if (!cancelRef.current) setAppState('results');
  };

  const downloadCSV = () => {
    const csv = [["Data", "Histórico", "Valor", "Tipo"].join(";"), ...validTransactions.map(t => [`"${t.data}"`, `"${t.historico}"`, t.valor.toFixed(2).replace('.', ','), t.cd].join(";"))].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    link.download = `extrato_vision_${new Date().getTime()}.csv`;
    link.click();
  };

  const downloadOFX = () => {
    const now = new Date();
    const dServer = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

    const formatOFXDate = (dateStr: string): string => {
      const parts = dateStr.split('/');
      if (parts.length < 3) return dServer;
      const day = parts[0].trim().padStart(2, '0');
      const month = parts[1].trim().padStart(2, '0');
      let year = parts[2].trim();
      if (year.length === 2) {
        year = '20' + year;
      }
      return `${year}${month}${day}`;
    };

    const formatOFXAmount = (value: number): string => {
      return value.toFixed(2).replace('.', ',');
    };

    const sanitizeMemo = (memo: string): string => {
      return memo
        .substring(0, 255)
        .replace(/[çÇ]/g, 'c')
        .replace(/[áàãâä]/gi, 'a')
        .replace(/[éèêë]/gi, 'e')
        .replace(/[íìîï]/gi, 'i')
        .replace(/[óòõôö]/gi, 'o')
        .replace(/[úùûü]/gi, 'u')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        .replace(/[^a-zA-Z0-9., \-;&_ ]/g, '');
    };

    let dtStart = dServer;
    let dtEnd = dServer;
    if (validTransactions.length > 0) {
      const dates = validTransactions.map(t => formatOFXDate(t.data));
      dates.sort();
      dtStart = dates[0];
      dtEnd = dates[dates.length - 1];
    }

    let ofxStr = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:UTF-8\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX>\n  <SIGNONMSGSRSV1>\n    <SONRS>\n      <STATUS>\n        <CODE>0</CODE>\n        <SEVERITY>INFO</SEVERITY>\n      </STATUS>\n      <DTSERVER>${dServer}</DTSERVER>\n      <LANGUAGE>POR</LANGUAGE>\n    </SONRS>\n  </SIGNONMSGSRSV1>\n  <BANKMSGSRSV1>\n    <STMTTRNRS>\n      <TRNUID>0</TRNUID>\n      <STATUS>\n        <CODE>0</CODE>\n        <SEVERITY>INFO</SEVERITY>\n      </STATUS>\n      <STMTRS>\n        <CURDEF>BRL</CURDEF>\n        <BANKACCTFROM>\n          <BANKID>001</BANKID>\n          <ACCTID>99999999</ACCTID>\n          <ACCTTYPE>CHECKING</ACCTTYPE>\n        </BANKACCTFROM>\n        <BANKTRANLIST>\n          <DTSTART>${dtStart}</DTSTART>\n          <DTEND>${dtEnd}</DTEND>\n`;

    validTransactions.forEach((t, i) => {
      const postedDate = formatOFXDate(t.data);
      const trnType = t.cd === 'C' ? 'CREDIT' : 'DEBIT';
      const trnAmt = formatOFXAmount(t.valor);
      const fitId = `${postedDate.substring(2)}${String(i + 1).padStart(3, '0')}`;
      const memo = sanitizeMemo(t.historico);

      ofxStr += `          <STMTTRN>\n            <TRNTYPE>${trnType}</TRNTYPE>\n            <DTPOSTED>${postedDate}</DTPOSTED>\n            <TRNAMT>${trnAmt}</TRNAMT>\n            <FITID>${fitId}</FITID>\n            <CHECKNUM></CHECKNUM>\n            <MEMO>${memo}</MEMO>\n          </STMTTRN>\n`;
    });

    ofxStr += `        </BANKTRANLIST>\n      </STMTRS>\n    </STMTTRNRS>\n  </BANKMSGSRSV1>\n</OFX>`;

    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([ofxStr], { type: "application/x-ofx;charset=utf-8;" }));
    link.download = `extrato_vision_${new Date().getTime()}.ofx`;
    link.click();
  };

  const currentLine = linesProcessedCount < (allScannedLines || []).length ? allScannedLines[linesProcessedCount] : null;
  let highlightStyle: React.CSSProperties = { display: 'none' };
  if (currentLine && pdfViewport && currentLine.page === currentPageRendered) {
    const [_, y1] = pdfViewport.convertToViewportPoint(0, currentLine.originalY + currentLine.height);
    const [__, y2] = pdfViewport.convertToViewportPoint(0, currentLine.originalY);
    highlightStyle = { display: 'block', position: 'absolute', top: `${y1 - 4}px`, left: '0', width: '100%', height: `${Math.abs(y2 - y1) + 8}px` };
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans overflow-hidden">

      {showDateModal && (
        <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-3xl shadow-2xl border border-slate-700 w-full max-w-md p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                <i className="fas fa-calendar-alt text-white"></i>
              </div>
              <div>
                <h2 className="text-lg font-black text-white">Período do Extrato</h2>
                <p className="text-slate-400 text-xs">Informe o intervalo de datas para extração</p>
              </div>
            </div>
            <div className="space-y-4 mb-6">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 block">Data Inicial</label>
                <input
                  type="text"
                  placeholder="MM/AAAA ou DD/MM/AAAA"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  maxLength={10}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 block">Data Final</label>
                <input
                  type="text"
                  placeholder="MM/AAAA ou DD/MM/AAAA"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  maxLength={10}
                  onKeyDown={e => { if (e.key === 'Enter') confirmDateRange(); }}
                />
              </div>
            </div>
            <button
              onClick={confirmDateRange}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl uppercase tracking-widest transition-all shadow-xl"
            >
              <i className="fas fa-play mr-2"></i> Próximo Passo
            </button>
          </div>
        </div>
      )}

      {showConfigModal && pendingFileRef.current && (
        <ExtractionConfigModal 
          file={pendingFileRef.current}
          onConfirm={handleConfigConfirm}
          onCancel={() => { setShowConfigModal(false); setAppState('idle'); }}
        />
      )}
      <header className="bg-slate-800 border-b border-slate-700 h-16 flex-none flex items-center px-6 justify-between shadow-lg z-20">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold text-blue-400 flex items-center gap-3"><i className="fas fa-microchip animate-pulse"></i> EXTRATO VISION v9.4</h1>
        </div>
        <div className="flex items-center gap-3">
          {onClose && (
            <button
              onClick={onClose}
              className="text-xs bg-slate-700 border border-slate-600 px-4 py-2 rounded-lg hover:bg-slate-600 transition-all uppercase font-bold tracking-wider"
            >
              Voltar
            </button>
          )}
          {appState === 'results' && <button onClick={() => setAppState('idle')} className="text-xs bg-slate-700 border border-slate-600 px-4 py-2 rounded-lg hover:bg-slate-600 transition-all uppercase font-bold tracking-wider">Novo Arquivo</button>}
        </div>
      </header>

      <main className="flex-grow h-[calc(100vh-64px)] relative">
        <div className="w-full h-full relative flex">
        {appState === 'idle' && (
          <div className="absolute inset-0 z-50 bg-slate-900 flex flex-col items-start justify-start p-8 overflow-auto custom-scrollbar">
             {/* Upload area */}
             <div className="max-w-2xl w-full border-2 border-dashed border-slate-700 rounded-3xl p-10 text-center hover:border-blue-500 hover:bg-blue-500/5 cursor-pointer group transition-all relative mx-auto mb-8" onClick={() => fileInputRef.current?.click()}>
                <div className="w-20 h-20 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform shadow-xl">
                   <i className="fas fa-cloud-upload-alt text-3xl text-blue-400"></i>
                </div>
                <h2 className="text-2xl font-black mb-3 tracking-tight">Conversor Universal</h2>
                <p className="text-slate-400 mb-8 text-base">Suporta PDF, Imagens (OCR) e Planilhas Excel.</p>
                <input type="file" ref={fileInputRef} accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} multiple />
                <div className="flex gap-4 justify-center mb-6">
                   <div className="px-4 py-2 bg-slate-800 rounded-lg text-xs font-bold text-slate-500 border border-slate-700">PDF</div>
                   <div className="px-4 py-2 bg-slate-800 rounded-lg text-xs font-bold text-slate-500 border border-slate-700">IMG</div>
                   <div className="px-4 py-2 bg-slate-800 rounded-lg text-xs font-bold text-slate-500 border border-slate-700">XLS</div>
                </div>
                <button className="bg-blue-600 hover:bg-blue-500 px-12 py-4 rounded-2xl font-black text-lg shadow-2xl transition-all uppercase tracking-widest">Selecionar Arquivo</button>
             </div>

            {/* Layout selector button */}
            <button
               onClick={() => setShowLayoutSelector(true)}
               className="mt-4 w-full max-w-2xl mx-auto block bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded border border-slate-600"
            >
               Escolher Layout do Extrato
            </button>

            {/* Layout selector modal */}
            {showLayoutSelector && (
               <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                  <div className="bg-slate-800 rounded-xl shadow-2xl p-6 w-full max-w-md border border-slate-700">
                     <LayoutSelector
                        bankCode={bankCode}
                        selectedLayout={selectedLayout}
                        onBankChange={(code) => setBankCode(code)}
                        onSelect={(layoutId) => {
                           setSelectedLayout(layoutId);
                           setShowLayoutSelector(false);
                        }}
                        onBack={() => setShowLayoutSelector(false)}
                     />
                  </div>
               </div>
            )}

             {/* BB Extrato Preview Layout - lado a lado */}
             <div className="w-full max-w-6xl mx-auto">
               <BBExtratoPreviewLayout />
             </div>
          </div>
        )}

        {(appState === 'scanning' || appState === 'analyzing') && (
          <>
            <div className="w-3/5 bg-slate-950 overflow-auto flex flex-col items-center py-6 px-4 scrollbar-hide" ref={pdfContainerRef}>
              <div className="relative w-full rounded-2xl overflow-hidden flex flex-col justify-center items-center" style={{minHeight:'300px'}}>
                {previewType === 'pdf' && (
                  <canvas ref={canvasRef} className="max-w-full h-auto block rounded-xl" />
                )}
                {previewType === 'image' && (
                  <div className="relative w-full h-full overflow-auto flex items-center justify-center">
                    {((previewData && previewData.length>0 ? previewData[previewIndex] : pageImagesRef.current[previewIndex]) ?? null) && (
                      <img src={(previewData && previewData.length>0 ? previewData[previewIndex] : pageImagesRef.current[previewIndex]) ?? ''} alt="preview" className="max-w-full h-auto block rounded-xl shadow-2xl" />
                    )}
                    {appState==='scanning' && <div style={{position:'absolute',top:`${scanProgress*100}%`,left:0,width:'100%',height:'3px',background:'rgba(59,130,246,0.8)',boxShadow:'0 0 12px rgba(59,130,246,0.9)',pointerEvents:'none',transition:'top 0.05s'}} />}
                    {previewData && previewData.length > 1 && (
                      <div className="absolute top-3 left-3 flex gap-2">
                        <button onClick={() => setPreviewIndex(i => Math.max(0,i-1))} className="bg-slate-900/80 backdrop-blur text-white px-3 py-1 rounded-lg text-sm font-bold hover:bg-slate-700 transition-all" disabled={previewIndex===0}>&lt;</button>
                        <button onClick={() => setPreviewIndex(i => Math.min(previewData.length-1,i+1))} className="bg-slate-900/80 backdrop-blur text-white px-3 py-1 rounded-lg text-sm font-bold hover:bg-slate-700 transition-all" disabled={previewIndex===previewData.length-1}>&gt;</button>
                      </div>
                    )}
                  </div>
                )}
                {previewType === 'image' && (!previewData || previewData.length === 0) && (
                  <div className="flex flex-col items-center gap-4 text-slate-500">
                    <div className="w-10 h-10 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
                    <span className="text-sm font-mono">Carregando visualização...</span>
                  </div>
                )}
                {previewType === 'excel' && previewData && (
                  <div className="w-full overflow-auto p-2">
                    <table className="w-full text-xs text-left">
                      <tbody>
                        {previewData.map((row:any,i:number)=>(
                          <tr id={`excel-row-${i}`} key={i} className={`${scanProgress ? (Math.min(previewData.length-1, Math.floor(scanProgress * previewData.length)) === i ? 'bg-blue-200' : '') : ''} border-b`}><td className="p-1">{row.join(' | ')}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="pointer-events-none z-10 border-b-2 border-blue-400 bg-blue-500/10 shadow-[0_0_30px_rgba(59,130,246,0.5)] transition-all duration-75" style={highlightStyle} />
              </div>
            </div>

            <div className="w-2/5 flex flex-col bg-slate-900 border-l border-slate-700 shadow-2xl z-10">
               <div className="h-72 bg-slate-800/50 flex flex-col items-center justify-center p-8 border-b border-slate-700 relative overflow-hidden text-center">
                  <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-6"></div>
                  <h3 className="text-xl font-black text-white mb-2 uppercase tracking-tighter">{processingMsg}</h3>
                  <p className="text-slate-400 text-xs font-mono animate-pulse mb-6">REGRA ATIVA: D = NEGATIVO (-) | C = POSITIVO (+)</p>
                  <button
                    onClick={() => { cancelRef.current = true; setAppState('idle'); }}
                    className="mt-2 px-6 py-2 rounded-xl bg-red-600/20 border border-red-500/40 text-red-400 text-xs font-bold uppercase tracking-widest hover:bg-red-600/40 hover:text-red-300 transition-all"
                  >
                    <i className="fas fa-times mr-2"></i>Cancelar
                  </button>
               </div>
               <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar bg-slate-950/20">
                  {validTransactions.slice(-10).reverse().map((t) => (
                    <div key={t.id} className="p-3 rounded-xl border-l-4 text-[11px] font-mono bg-emerald-500/5 border-emerald-500 shadow-[0_4px_12px_rgba(16,185,129,0.1)]">
                       <div className="flex justify-between items-center mb-1">
                          <span className="text-emerald-400 font-bold">✓ {t.cd === 'C' ? 'ENTRADA' : 'SAÍDA'}</span>
                          <span className="text-slate-400">{t.data}</span>
                       </div>
                       <div className="whitespace-normal break-words text-slate-400">{t.historico}</div>
                    </div>
                  ))}
               </div>
            </div>
          </>
        )}

        {appState === 'results' && (
          <div className="absolute inset-0 bg-slate-100 z-50 p-8 overflow-auto text-slate-900 custom-scrollbar">
             <div className="max-w-6xl mx-auto">
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
                   <div className="bg-white p-8 rounded-3xl shadow-sm border-b-8 border-emerald-500 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-black text-slate-400 uppercase mb-2">Créditos (Positivos)</p>
                        <p className="text-3xl font-black text-emerald-600">
                          {totals.credits.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL', signDisplay: 'always'})}
                        </p>
                      </div>
                      <div className="text-emerald-500 text-3xl"><i className="fas fa-plus-circle"></i></div>
                   </div>
                   <div className="bg-white p-8 rounded-3xl shadow-sm border-b-8 border-red-500 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-black text-slate-400 uppercase mb-2">Débitos (Sinal -)</p>
                        <p className="text-3xl font-black text-red-600">
                          {(-totals.debits).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL', signDisplay: 'always'})}
                        </p>
                      </div>
                      <div className="text-red-500 text-3xl"><i className="fas fa-minus-circle"></i></div>
                   </div>
                   <div className={`bg-white p-8 rounded-3xl shadow-sm border-b-8 flex items-center justify-between ${netBalance >= 0 ? 'border-blue-500' : 'border-orange-500'}`}>
                      <div>
                        <p className="text-xs font-black text-slate-400 uppercase mb-2 flex items-center gap-2">
                           Movimentação Líquida
                           <span className="group relative">
                              <i className="fas fa-info-circle text-slate-300 hover:text-blue-400 cursor-help"></i>
                              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-800 text-white text-[10px] p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center normal-case font-normal">
                                 Diferença entre o total de créditos e débitos do período. Não é o saldo final da conta.
                              </span>
                           </span>
                        </p>
                        <p className={`text-3xl font-black ${netBalance >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                          {netBalance.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL', signDisplay: 'always'})}
                        </p>
                      </div>
                      <div className="text-slate-400 text-3xl"><i className="fas fa-chart-line"></i></div>
                   </div>
                </div>

                <div className="bg-slate-800 text-white p-8 rounded-3xl shadow-xl mb-12 border border-slate-700">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                      <i className="fas fa-calculator text-xl"></i>
                    </div>
                    <div>
                      <h3 className="text-2xl font-black tracking-tight">Conciliação Bancária</h3>
                      <p className="text-slate-400 text-sm">Verifique se o extrato bate com o banco.</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-end">
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Saldo Anterior (Banco)</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">R$</span>
                        <input 
                          type="number" 
                          step="0.01"
                          placeholder="Ex: 25.500,00"
                          className="w-full bg-slate-900 border border-slate-600 rounded-xl pl-12 pr-4 py-4 text-white font-mono text-lg focus:outline-none focus:border-blue-500 transition-colors"
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            const final = (isNaN(val) ? 0 : val) + netBalance;
                            const el = document.getElementById('simulated-balance');
                            if(el) el.innerText = final.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
                          }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-500 mt-2">* Saldo da conta ANTES da primeira transação deste extrato.</p>
                    </div>
                    
                    <div className="flex flex-col items-center justify-center pb-4">
                      <div className="text-2xl text-slate-500 font-black">+</div>
                      <div className={`text-lg font-bold ${netBalance >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                        {netBalance.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
                      </div>
                      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-1">Movimentação Líquida</div>
                    </div>

                    <div className="bg-slate-700/50 p-6 rounded-2xl border border-slate-600 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-4 opacity-10">
                        <i className="fas fa-flag-checkered text-6xl text-white"></i>
                      </div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Saldo Final Calculado</p>
                      <p id="simulated-balance" className="text-3xl font-black text-white tracking-tight relative z-10">R$ 0,00</p>
                      <p className="text-[10px] text-slate-400 mt-2 relative z-10">Este valor deve bater com o saldo final do extrato.</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-200">
                    <div className="p-10 border-b bg-white flex justify-between items-center">
                       <div>
                          <h2 className="text-3xl font-black text-slate-800 tracking-tight">Transações Estruturadas</h2>
                          <p className="text-slate-500 font-medium">Origem do arquivo: <span className="text-blue-600 font-bold uppercase">{file?.name.split('.').pop()}</span></p>
                       </div>
                       <div className="flex gap-3">
                          {onImportTransactions && (
                             <button
                               onClick={() => {
                                 onImportTransactions(validTransactions);
                                 if (onClose) onClose();
                               }}
                               className="bg-amber-600 hover:bg-amber-500 text-white px-6 py-3 rounded-xl font-bold shadow-xl transition-all flex items-center gap-2 uppercase tracking-tighter"
                             >
                               <i className="fas fa-file-import"></i> Importar para Conciliação
                             </button>
                           )}
                          <button onClick={downloadCSV} className="bg-slate-900 hover:bg-black text-white px-6 py-3 rounded-xl font-bold shadow-xl transition-all flex items-center gap-2 uppercase tracking-tighter"><i className="fas fa-file-csv"></i> CSV</button>
                          <button onClick={downloadExcel} className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold shadow-xl transition-all flex items-center gap-2 uppercase tracking-tighter"><i className="fas fa-file-excel"></i> Excel</button>
                          <button onClick={downloadOFX} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-bold shadow-xl transition-all flex items-center gap-2 uppercase tracking-tighter"><i className="fas fa-file-invoice-dollar"></i> OFX</button>
                       </div>
                    </div>

                    <div className="p-8">
                        <div className="overflow-x-auto overflow-y-auto" style={{maxHeight:'60vh'}}>
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="bg-slate-50 text-slate-500 text-[11px] uppercase font-black tracking-widest">
                                <th className="p-5">Data</th>
                                <th className="p-5">Histórico Extraído</th>
                                <th className="p-5 text-right">Valor</th>
                                <th className="p-5 text-center">Tipo</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {validTransactions.map((t) => (
                                <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                                  <td className="p-5 text-slate-500 font-mono text-xs whitespace-nowrap">{t.data}</td>
                                  <td className="p-5 text-slate-700 whitespace-normal break-words">{t.historico}</td>
                                  <td className="p-5 text-right font-black font-mono whitespace-nowrap">
                                    <span className={t.cd === 'C' ? 'text-emerald-600' : 'text-red-600'}>
                                      {t.valor.toLocaleString('pt-BR', { 
                                        style: 'currency', 
                                        currency: 'BRL',
                                        signDisplay: 'always'
                                      })}
                                    </span>
                                  </td>
                                  <td className="p-5 text-center">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${t.cd === 'C' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                      {t.cd === 'C' ? 'Crédito' : 'Débito'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                              {validTransactions.length === 0 && (
                                <tr>
                                  <td colSpan={4} className="p-10 text-center">
                                    <div className="text-slate-400 mb-2 font-bold">Nenhuma transação encontrada.</div>
                                    <div className="text-xs text-slate-500 max-w-lg mx-auto">
                                      Se o PDF contém transações, certifique-se de que:
                                      <ul className="list-disc text-left inline-block mt-2 space-y-1">
                                        <li>As transações extraídas possuem datas <b>dentro do período</b> que você informou no início. (Transações fora do período são ignoradas automaticamente).</li>
                                        <li>As linhas não estão sendo ignoradas pelas configurações de corte (Linha Vermelha de limite inferior).</li>
                                      </ul>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                    </div>
                </div>

             </div>
          </div>
        )}
        </div>
      </main>

      {/* Date Range Modal */}
      {showDateModal && (
        <div className="fixed inset-0 z-[300] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-800 w-full max-w-md p-10 text-center">
            <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-xl shadow-blue-500/20">
              <i className="fas fa-calendar-alt text-3xl text-white"></i>
            </div>
            <h2 className="text-2xl font-black text-white mb-2 uppercase tracking-tighter">Período do Extrato</h2>
            <p className="text-slate-400 text-sm mb-8">Informe o intervalo. Somente transações <strong className="text-white">dentro deste limite</strong> serão extraídas.</p>
            
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="text-left">
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">Data Inicial</label>
                <input 
                  type="text" 
                  placeholder="MM/AAAA ou DD/MM/AAAA"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="text-left">
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">Data Final</label>
                <input 
                  type="text" 
                  placeholder="MM/AAAA ou DD/MM/AAAA"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <button 
              onClick={confirmDateRange}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl uppercase tracking-widest transition-all shadow-xl shadow-blue-500/20"
            >
              Confirmar
            </button>
          </div>
        </div>
      )}

      {/* Extraction Config Modal */}
      {showConfigModal && pendingFileRef.current && (
        <ExtractionConfigModal 
          file={pendingFileRef.current}
          onConfirm={handleConfigConfirm}
          onCancel={() => setShowConfigModal(false)}
        />
      )}
    </div>
  );
}

export default ExtratoVisionApp;
