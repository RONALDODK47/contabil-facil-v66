import * as xlsx from "xlsx";
import { Type } from "@google/genai";
import { parseTransactionsWithResilience } from "./json-utils.mjs";
import { parsePdfBuffer, splitPdfIntoChunks } from "./pdf-utils.mjs";
import { DEFAULT_GEMINI_MODEL, generateContentWithRetry, getGeminiClient } from "./gemini.mjs";
import { sanitizeGeminiModel } from "../gemini-client.mjs";

const CHUNK_PAUSE_MS = 800;

const EXTRATO_SYSTEM_INSTRUCTION =
  "Você é um auditor financeiro com OCR de extrema precisão. Sua prioridade absoluta é extrair TODAS as transações financeiras do documento de forma 100% exaustiva e completa. NUNCA resuma, NUNCA use reticências, e NUNCA agrupe lançamentos semelhantes. Seja meticuloso e leia linha por linha de cada página, do cabeçalho ao rodapé.";

const EXTRATO_IMAGE_SYSTEM_INSTRUCTION =
  "Você é um auditor financeiro com OCR de extrema precisão. Sua prioridade absoluta é extrair TODAS as transações financeiras do documento de forma 100% exaustiva e completa. NUNCA resuma, NUNCA use reticências, NUNCA pule páginas, e NUNCA agrupe lançamentos semelhantes. Se houver 80 transações, você DEVE retornar as 80 transações. Seja meticuloso e leia linha por linha de cada página, do cabeçalho ao rodapé, incluindo todas as anotações escritas à mão próximas aos lançamentos, mantendo também todos os lançamentos normais sem anotações.";

const EXTRATO_PDF_SYSTEM_INSTRUCTION =
  "Você é um auditor financeiro com OCR de extrema precisão. Sua prioridade absoluta é extrair TODAS as transações financeiras do documento de forma 100% exaustiva e completa. NUNCA resuma, NUNCA use reticências, e NUNCA agrupe lançamentos semelhantes. Seja meticuloso e leia linha por linha de cada página, do cabeçalho ao rodapé, incluindo todas as anotações escritas à mão próximas aos lançamentos, mantendo também todos os lançamentos normais sem anotações.";

const EXTRATO_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    transactions: {
      type: Type.ARRAY,
      description: "Lista completa e exaustiva de TODAS as transações financeiras extraídas e estruturadas.",
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, description: "Data da transação no formato YYYY-MM-DD" },
          description: { type: Type.STRING, description: "Descrição limpa do lançamento" },
          amount: { type: Type.NUMBER, description: "Valor numérico (positivo para entradas, negativo para saídas)" },
          type: { type: Type.STRING, description: "Tipo de transação bancária", enum: ["DEBIT", "CREDIT"] },
          category: { type: Type.STRING, description: "Categoria financeira em português" },
        },
        required: ["date", "description", "amount", "type", "category"],
      },
    },
    currency: { type: Type.STRING, description: "Moeda detectada (ex: BRL, USD, EUR)" },
    summary: { type: Type.STRING, description: "Um resumo descritivo curto do documento processado" },
  },
  required: ["transactions", "currency", "summary"],
};

const EXTRATO_GENERATION_CONFIG = {
  maxOutputTokens: 8192,
  temperature: 0.05,
  responseMimeType: "application/json",
  responseSchema: EXTRATO_RESPONSE_SCHEMA,
};

const IMAGE_EXTRACTION_PROMPT = `Você é um leitor de faturas e extratos bancários com OCR de altíssima precisão e especialista em auditoria financeira exaustiva. Analise o documento em anexo (pode ser um extrato de conta, fatura de cartão de crédito, comprovante escaneado ou foto de recibo) e extraia absolutamente todas as transações financeiras.

DIRETRIZES DE EXTRAÇÃO CRÍTICAS E EXAUSTIVAS:
1. Realize o OCR completo, minucioso e exaustivo de todas as tabelas de transações visíveis no documento. Capture absolutamente TODAS as linhas de transação visíveis, sem resumir e sem omitir nada. Não use reticências, não resuma e não agrupe transações.
2. Cada linha de transação original do documento deve corresponder exatamente a um item no array de transações retornado.
3. Formate as datas como YYYY-MM-DD. Se apenas o dia/mês estiver disponível, assuma o ano atual baseado no contexto do documento (ou 2026 caso não seja identificável).
4. Limpe as descrições mantendo apenas o nome legível do estabelecimento ou transação.
5. O valor ('amount') deve ser um número float. Débitos devem ser representados como valores NEGATIVOS. Créditos como valores POSITIVOS.
6. Atribua uma categoria financeira inteligente em português (ex: Alimentação, Transporte, Lazer, Saúde, Salário, Serviços, Impostos, etc.) para cada registro.
7. Identifique a moeda predominante (geralmente BRL para documentos brasileiros).
8. ANOTAÇÕES MANUAIS E CANETA: O documento contém importantes anotações feitas à mão com caneta ou lápis ao lado das transações (por exemplo: "Aluguel", "Advogado", "Secretaria", "Zelador", "faxina", "Contabilidade", "Psicologo", "Almoco", "Combustivel", "arraiá").
   - Você DEVE identificar essas anotações escritas à mão próximas às transações e incorporá-las de forma limpa na descrição (ex: "RECEBIMENTO PIX Kayke Bruno Carneiro (Aluguel)" ou "PAGAMENTO PIX BRUNO OLIVEIRA REGO (Advogado)").
   - Use as anotações para definir a categoria da transação da forma mais precisa possível.
   - REGRA DE EXCLUSÃO CRÍTICA: Se uma transação NÃO tiver anotação feita à mão, você DEVE extraí-la normalmente do mesmo jeito! A ausência de anotações escritas à mão NÃO significa que o lançamento deva ser ignorado. O array final deve conter 100% de todos os lançamentos do documento, com ou sem anotações.`;

/**
 * @param {import("@google/genai").GoogleGenAI} ai
 * @param {string} activeModel
 * @param {unknown[]} contents
 * @param {string} systemInstruction
 * @returns {Promise<{ transactions: unknown[], currency: string, summary: string }>}
 */
async function callExtratoGemini(ai, activeModel, contents, systemInstruction) {
  const response = await generateContentWithRetry(ai, activeModel, contents, {
    ...EXTRATO_GENERATION_CONFIG,
    systemInstruction,
  });

  const textResult = response.text;
  if (!textResult) {
    throw new Error("O modelo Gemini não retornou nenhum dado analisável.");
  }

  console.log(`[Gemini API] Resposta recebida. Tamanho: ${textResult.length} caracteres.`);
  const parsedData = parseTransactionsWithResilience(textResult);
  console.log(`[Gemini API] Transações extraídas com sucesso: ${parsedData.transactions?.length || 0}`);
  return parsedData;
}

/**
 * @param {import("@google/genai").GoogleGenAI} ai
 * @param {string} activeModel
 * @param {string} sheetText
 */
async function convertExcelOrCsv(ai, activeModel, sheetText) {
  const contents = [
    {
      text: `Você é um analista financeiro especialista em auditoria e importações bancárias. Analise os dados da planilha de transações bancárias abaixo em formato CSV e extraia absolutamente TODAS as transações em formato estruturado, sem qualquer exceção, omissão ou resumo.

Dados da Planilha:
${sheetText}

DIRETRIZES DE EXTRAÇÃO CRÍTICAS E EXAUSTIVAS:
1. Extraia absolutamente TODAS as transações presentes em TODAS as linhas da planilha de dados acima, sem pular nenhuma linha e sem agrupar lançamentos semelhantes. Se houver 50 ou 100 linhas de transação, extraia todas as 50 ou 100. Nunca use reticências ou ignore partes do documento.
2. Extraia a data (no formato YYYY-MM-DD), descrição limpa da transação, valor numérico líquido (positivo para entradas/depósitos/créditos, negativo para saídas/pagamentos/débitos), o tipo da transação ('DEBIT' ou 'CREDIT') e uma categoria lógica em português (Alimentação, Transporte, Lazer, Saúde, Salário, Investimentos, etc.).
3. Identifique a moeda predominante (geralmente BRL para planilhas brasileiras).
4. Ignore linhas que representem puramente saldos anteriores, totais consolidados ou cabeçalhos redundantes. Porém, qualquer linha com um lançamento individual legítimo de entrada ou saída deve ser extraída obrigatoriamente.`,
    },
  ];

  return callExtratoGemini(ai, activeModel, contents, EXTRATO_SYSTEM_INSTRUCTION);
}

/**
 * @param {import("@google/genai").GoogleGenAI} ai
 * @param {string} activeModel
 * @param {string} chunkBase64
 * @param {number} index
 * @param {number} totalChunks
 */
async function processPdfChunk(ai, activeModel, chunkBase64, index, totalChunks) {
  console.log(`[Convert] Processando parte ${index + 1} de ${totalChunks}…`);

  let pdfExtractedText = "";
  let isLikelyDigital = false;
  try {
    const buffer = Buffer.from(chunkBase64, "base64");
    const parsedPdf = await parsePdfBuffer(buffer);
    if (parsedPdf?.text?.trim().length > 15) {
      pdfExtractedText = parsedPdf.text;
      const hasDates = /\d{2}[\/\-]\d{2}/.test(pdfExtractedText);
      const hasNumbers = /\d+[\.,]\d{2}/.test(pdfExtractedText);
      isLikelyDigital = pdfExtractedText.length > 100 && hasDates && hasNumbers;
      console.log(
        `[Part ${index + 1}] Texto extraído: ${pdfExtractedText.length} caracteres. Digital: ${isLikelyDigital}`,
      );
    }
  } catch (pdfErr) {
    console.error(`[Part ${index + 1}] Falha ao extrair texto do PDF via pdf-parse:`, pdfErr);
  }

  const chunkContents = [
    {
      inlineData: {
        data: chunkBase64,
        mimeType: "application/pdf",
      },
    },
    {
      text: `Você é um leitor de faturas e extratos bancários com OCR multimodal de altíssima precisão e especialista em auditoria financeira exaustiva. Analise a parte ${index + 1} de ${totalChunks} do documento PDF em anexo e extraia absolutamente todas as transações financeiras desta parte.

${pdfExtractedText && isLikelyDigital ? `Para auxiliar, aqui está o texto extraído digitalmente desta parte (atenção: pode estar incompleto. Use o arquivo PDF visual como fonte principal da verdade):
---
${pdfExtractedText}
---` : ""}

DIRETRIZES DE EXTRAÇÃO CRÍTICAS E EXAUSTIVAS:
1. Realize o OCR completo, minucioso e exaustivo de todas as tabelas de transações visíveis nesta parte do documento. Capture absolutamente TODAS as linhas de transação visíveis, sem pular e sem omitir nada. Não use reticências, não resuma e não agrupe transações.
2. Cada linha de transação original do extrato/fatura deve corresponder exatamente a um item no array de transações retornado. Não agrupe transações; se houver várias despesas, retorne cada uma como um item separado e independente no array 'transactions'.
3. Formate as datas como YYYY-MM-DD. Se apenas o dia/mês estiver disponível (ex: "15/07"), assuma o ano atual baseado no contexto (ou 2026 caso não seja identificável).
4. Limpe as descrições removendo códigos de autorização complexos, mantendo apenas o nome legível do estabelecimento ou transação (ex: "PG *UBER TRIP 123" vira "Uber Trip").
5. O valor ('amount') deve ser um número float. Débitos (saídas, compras) devem ser representados como valores NEGATIVOS. Créditos (entradas, salários, depósitos, estornos) como valores POSITIVOS.
6. Atribua uma categoria financeira inteligente em português (ex: Alimentação, Transporte, Lazer, Saúde, Salário, Serviços, Impostos, etc.) para cada registro.
7. Identifique a moeda predominante (geralmente BRL para documentos brasileiros).
8. ANOTAÇÕES MANUAIS E CANETA: O documento contém importantes anotações feitas à mão com caneta ou lápis ao lado das transações (por exemplo: "Aluguel", "Advogado", "Secretaria", "Zelador", "faxina", "Contabilidade", "Psicologo", "Almoco", "Combustivel", "arraiá").
   - Você DEVE identificar essas anotações escritas à mão próximas às transações e incorporá-las de forma limpa na descrição (ex: "RECEBIMENTO PIX Kayke Bruno Carneiro (Aluguel)" ou "PAGAMENTO PIX BRUNO OLIVEIRA REGO (Advogado)").
   - Use as anotações para definir a categoria da transação de forma muito precisa.
   - REGRA DE EXCLUSÃO CRÍTICA: Se uma transação NÃO tiver anotação feita à mão, você DEVE extraí-la normalmente do mesmo jeito! A ausência de anotações escritas à mão NÃO significa que o lançamento deva ser ignorado. O array final deve conter 100% de todos os lançamentos do documento, com ou sem anotações.`,
    },
  ];

  const response = await generateContentWithRetry(ai, activeModel, chunkContents, {
    ...EXTRATO_GENERATION_CONFIG,
    systemInstruction: EXTRATO_PDF_SYSTEM_INSTRUCTION,
  });

  const textResult = response.text;
  if (!textResult) {
    throw new Error(`O modelo Gemini não retornou nenhum dado analisável na parte ${index + 1}.`);
  }

  console.log(`[Convert Part ${index + 1}] Resposta recebida. Tamanho: ${textResult.length} caracteres.`);
  const parsedChunk = parseTransactionsWithResilience(textResult);
  if (parsedChunk?.transactions) {
    console.log(`[Convert Part ${index + 1}] Extraídas ${parsedChunk.transactions.length} transações.`);
  }
  return parsedChunk;
}

function mergeExtratoChunkResults(chunkResults) {
  /** @type {unknown[]} */
  let allTransactions = [];
  let detectedCurrency = "BRL";
  let combinedSummary = "";

  for (const parsedChunk of chunkResults) {
    if (parsedChunk?.transactions) {
      allTransactions = allTransactions.concat(parsedChunk.transactions);
    }
    if (parsedChunk?.currency) {
      detectedCurrency = parsedChunk.currency;
    }
    if (parsedChunk?.summary) {
      if (!combinedSummary) {
        combinedSummary = parsedChunk.summary;
      } else if (!combinedSummary.includes(parsedChunk.summary)) {
        combinedSummary += " / " + parsedChunk.summary;
      }
    }
  }

  return {
    transactions: allTransactions,
    currency: detectedCurrency,
    summary: combinedSummary || "Extrato Bancário Completo",
  };
}

/**
 * @param {import("@google/genai").GoogleGenAI} ai
 * @param {string} activeModel
 * @param {string} fileBase64
 */
async function convertPdf(ai, activeModel, fileBase64) {
  const pdfChunks = await splitPdfIntoChunks(fileBase64, 5);
  console.log(`[Convert] Processando ${pdfChunks.length} parte(s) do PDF sequencialmente…`);

  /** @type {Awaited<ReturnType<typeof processPdfChunk>>[]} */
  const chunkResults = [];
  for (let index = 0; index < pdfChunks.length; index++) {
    chunkResults.push(
      await processPdfChunk(ai, activeModel, pdfChunks[index], index, pdfChunks.length),
    );
    if (pdfChunks.length > 1 && index < pdfChunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, CHUNK_PAUSE_MS));
    }
  }

  const merged = mergeExtratoChunkResults(chunkResults);
  console.log(`[Convert] Concluído! Total combinado de transações extraídas: ${merged.transactions.length}`);
  return merged;
}

/**
 * @param {import("@google/genai").GoogleGenAI} ai
 * @param {string} activeModel
 * @param {{ base64?: string, data?: string, mimeType?: string }} image
 * @param {number} index
 * @param {number} totalImages
 */
async function processImageChunk(ai, activeModel, image, index, totalImages) {
  const base64 = image.base64 || image.data || "";
  const mimeType = image.mimeType || "image/jpeg";

  if (!base64) {
    console.warn(`[Convert Image ${index + 1}] Imagem sem base64 — ignorada.`);
    return { transactions: [], currency: "BRL", summary: "" };
  }

  console.log(`[Convert] Processando imagem ${index + 1} de ${totalImages}…`);

  const prompt =
    totalImages > 1
      ? IMAGE_EXTRACTION_PROMPT.replace(
          "Analise o documento em anexo",
          `Analise a imagem ${index + 1} de ${totalImages} do documento em anexo`,
        )
      : IMAGE_EXTRACTION_PROMPT;

  const contents = [
    { inlineData: { data: base64, mimeType } },
    { text: prompt },
  ];

  const response = await generateContentWithRetry(ai, activeModel, contents, {
    ...EXTRATO_GENERATION_CONFIG,
    systemInstruction: EXTRATO_IMAGE_SYSTEM_INSTRUCTION,
  });

  const textResult = response.text;
  if (!textResult) {
    throw new Error(`O modelo Gemini não retornou nenhum dado analisável na imagem ${index + 1}.`);
  }

  console.log(`[Convert Image ${index + 1}] Resposta recebida. Tamanho: ${textResult.length} caracteres.`);
  const parsedChunk = parseTransactionsWithResilience(textResult);
  if (parsedChunk?.transactions) {
    console.log(`[Convert Image ${index + 1}] Extraídas ${parsedChunk.transactions.length} transações.`);
  }
  return parsedChunk;
}

/**
 * @param {import("@google/genai").GoogleGenAI} ai
 * @param {string} activeModel
 * @param {Array<{ base64?: string, mimeType?: string }>} images
 */
async function convertImages(ai, activeModel, images) {
  const validImages = images.filter((img) => img?.base64 || img?.data);
  if (!validImages.length) {
    throw new Error("Não foi possível extrair nenhuma transação válida das imagens fornecidas.");
  }

  console.log(`[Convert] Processando ${validImages.length} imagem(ns) sequencialmente…`);

  /** @type {Awaited<ReturnType<typeof processImageChunk>>[]} */
  const chunkResults = [];
  for (let index = 0; index < validImages.length; index++) {
    chunkResults.push(
      await processImageChunk(ai, activeModel, validImages[index], index, validImages.length),
    );
    if (validImages.length > 1 && index < validImages.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, CHUNK_PAUSE_MS));
    }
  }

  const merged = mergeExtratoChunkResults(chunkResults);
  if (!merged.transactions.length) {
    throw new Error("Não foi possível extrair nenhuma transação válida das imagens fornecidas.");
  }

  return merged;
}

/**
 * @param {import("@google/genai").GoogleGenAI} ai
 * @param {string} activeModel
 * @param {string} fileBase64
 * @param {string} mimeType
 */
async function convertSingleImageFile(ai, activeModel, fileBase64, mimeType) {
  const contents = [
    {
      inlineData: {
        data: fileBase64,
        mimeType,
      },
    },
    { text: IMAGE_EXTRACTION_PROMPT },
  ];

  return callExtratoGemini(ai, activeModel, contents, EXTRATO_IMAGE_SYSTEM_INSTRUCTION);
}

/**
 * Converte extrato bancário (PDF, Excel/CSV ou imagem) via Gemini.
 * @param {{
 *   fileBase64?: string,
 *   mimeType?: string,
 *   fileName?: string,
 *   selectedModel?: string,
 *   customApiKey?: string,
 *   images?: Array<{ base64?: string, data?: string, mimeType?: string }>
 * }} params
 * @returns {Promise<{ transactions: unknown[], currency: string, summary: string }>}
 */
export async function convertExtrato({
  fileBase64,
  mimeType,
  fileName,
  selectedModel,
  customApiKey,
  images,
}) {
  const hasImages = Array.isArray(images) && images.length > 0;

  if (!hasImages && (!fileBase64 || !mimeType)) {
    throw new Error("Arquivo ou tipo de arquivo inválido.");
  }

  const ai = getGeminiClient(customApiKey);
  const activeModel = sanitizeGeminiModel(selectedModel || DEFAULT_GEMINI_MODEL);

  if (hasImages) {
    return convertImages(ai, activeModel, images);
  }

  const isExcelOrCsv =
    mimeType.includes("sheet") ||
    mimeType.includes("excel") ||
    mimeType.includes("csv") ||
    /\.(xlsx|xls|csv)$/i.test(fileName || "");

  const isPdf = mimeType.includes("pdf") || /\.(pdf)$/i.test(fileName || "");

  if (isExcelOrCsv) {
    const buffer = Buffer.from(fileBase64, "base64");
    const workbook = xlsx.read(buffer, { type: "buffer" });
    let sheetText = "";

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = xlsx.utils.sheet_to_csv(sheet);
      sheetText += `Aba: ${sheetName}\n${csv}\n\n`;
    }

    return convertExcelOrCsv(ai, activeModel, sheetText);
  }

  if (isPdf) {
    return convertPdf(ai, activeModel, fileBase64);
  }

  return convertSingleImageFile(ai, activeModel, fileBase64, mimeType);
}
