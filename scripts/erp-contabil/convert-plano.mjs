import * as xlsx from "xlsx";
import { Type } from "@google/genai";
import { sanitizeJsonString } from "./json-utils.mjs";
import { parsePdfBuffer, splitPdfIntoChunks } from "./pdf-utils.mjs";
import { DEFAULT_GEMINI_MODEL, generateContentWithRetry, getGeminiClient } from "./gemini.mjs";
import { sanitizeGeminiModel } from "../gemini-client.mjs";

const CHUNK_PAUSE_MS = 800;

const PLANO_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    planoContas: {
      type: Type.ARRAY,
      description: "Lista completa e exaustiva de todas as contas contábeis extraídas, sem nenhuma omissão.",
      items: {
        type: Type.OBJECT,
        properties: {
          code: { type: Type.STRING, description: "Código reduzido da conta." },
          classification: { type: Type.STRING, description: "Classificação estruturada da conta." },
          name: { type: Type.STRING, description: "Nome limpo em maiúsculas." },
          type: {
            type: Type.STRING,
            description: "Grupo: ATIVO, PASSIVO, PATRIMONIO_LIQUIDO, RECEITA, DESPESA.",
          },
          isSynthetic: {
            type: Type.BOOLEAN,
            description: "true se sintética/grupo, false se analítica/lançamento.",
          },
        },
        required: ["code", "classification", "name", "type", "isSynthetic"],
      },
    },
  },
  required: ["planoContas"],
};

const PLANO_GENERATION_CONFIG = {
  maxOutputTokens: 8192,
  responseMimeType: "application/json",
  responseSchema: PLANO_RESPONSE_SCHEMA,
};

/**
 * @param {string} text
 * @returns {unknown[]}
 */
function scanForJsonObjects(text) {
  /** @type {unknown[]} */
  const items = [];
  let braceCount = 0;
  let startIdx = -1;
  let inString = false;
  let escapeNext = false;
  let quoteChar = "";

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (inString) {
      if (char === "\\") {
        escapeNext = true;
      } else if (char === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = true;
      quoteChar = char;
      continue;
    }

    if (char === "{") {
      if (braceCount === 0) {
        startIdx = i;
      }
      braceCount++;
    } else if (char === "}") {
      if (braceCount > 0) {
        braceCount--;
        if (braceCount === 0 && startIdx !== -1) {
          const potentialJson = text.slice(startIdx, i + 1);
          try {
            const obj = JSON.parse(potentialJson);
            if (obj && (obj.classification || obj.name)) {
              items.push(obj);
            }
          } catch {
            // ignore
          }
          startIdx = -1;
        }
      }
    }
  }
  return items;
}

/**
 * @param {string} text
 * @returns {string}
 */
function extractCsvFromPossiblyMalformedJson(text) {
  const keyIndex = text.toLowerCase().indexOf("planocontascsv");
  if (keyIndex === -1) {
    return text;
  }

  const colonIndex = text.indexOf(":", keyIndex);
  if (colonIndex === -1) {
    return text;
  }

  let startIndex = -1;
  let quoteChar = '"';
  for (let i = colonIndex + 1; i < text.length; i++) {
    if (text[i] === '"' || text[i] === "'" || text[i] === "`") {
      startIndex = i + 1;
      quoteChar = text[i];
      break;
    }
  }

  if (startIndex === -1) {
    return text;
  }

  let endIndex = text.lastIndexOf(quoteChar);
  if (endIndex <= startIndex) {
    endIndex = text.length;
  }

  let csvContent = text.slice(startIndex, endIndex);
  csvContent = csvContent
    .trim()
    .replace(/[}"]*$/, "")
    .trim();

  return csvContent;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function normalizeAndSplitLines(text) {
  let clean = text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n");

  clean = clean.replace(/\\"/g, '"');
  return clean.split(/\n+/);
}

/**
 * @param {string} line
 * @param {unknown[]} list
 */
function parseAndAddCsvLine(line, list) {
  let cleanLine = line.trim();
  if (!cleanLine) return;

  if (cleanLine === "{" || cleanLine === "}" || cleanLine === "[" || cleanLine === "]") return;
  if (cleanLine.startsWith("{") || cleanLine.startsWith("}") || cleanLine.startsWith("[") || cleanLine.startsWith("]"))
    return;
  if (cleanLine.includes('"planoContasCsv"') || cleanLine.includes("planoContasCsv")) return;

  cleanLine = cleanLine
    .replace(/^[,:{}\s"'\\]+/, "")
    .replace(/[,:{}\s"'\\]+$/, "")
    .trim();

  if (!cleanLine) return;

  if (
    cleanLine.toLowerCase().startsWith("code;") ||
    cleanLine.toLowerCase().startsWith("codigo;") ||
    cleanLine.toLowerCase().startsWith("código;")
  ) {
    return;
  }

  const parts = cleanLine.split(";");
  if (parts.length < 3) return;

  const cleanPart = (p) => {
    if (!p) return "";
    return p
      .replace(/^\\"/, "")
      .replace(/\\"$/, "")
      .replace(/^["']/, "")
      .replace(/["']$/, "")
      .replace(/^[{\s"':]*(planoContasCsv)?[{\s"':]*/i, "")
      .replace(/[}"'\s]*$/, "")
      .trim();
  };

  const code = cleanPart(parts[0]);
  const classification = cleanPart(parts[1]);
  const name = cleanPart(parts[2]).toUpperCase();
  const typeRaw = parts[3] ? cleanPart(parts[3]).toUpperCase() : "";
  const isSyntheticRaw = parts[4] ? cleanPart(parts[4]).toLowerCase() : "";

  if (!code || !classification || !name) return;
  if (classification.includes("{") || classification.includes("}") || name.includes("{") || name.includes("}"))
    return;

  const hasNumbers = /[0-9]/.test(classification);
  if (!hasNumbers) return;

  let type = "ATIVO";
  if (typeRaw.includes("PASSIVO")) type = "PASSIVO";
  else if (typeRaw.includes("RECEITA")) type = "RECEITA";
  else if (typeRaw.includes("DESPESA")) type = "DESPESA";
  else if (typeRaw.includes("PATRIMONIO") || typeRaw.includes("LIQUIDO")) type = "PATRIMONIO_LIQUIDO";
  else {
    if (classification.startsWith("1")) type = "ATIVO";
    else if (classification.startsWith("2.3") || classification.startsWith("2.4")) type = "PATRIMONIO_LIQUIDO";
    else if (classification.startsWith("2")) type = "PASSIVO";
    else if (classification.startsWith("3.1") || classification.startsWith("3.3") || classification.startsWith("4.1"))
      type = "RECEITA";
    else if (
      classification.startsWith("3.2") ||
      classification.startsWith("3") ||
      classification.startsWith("4") ||
      classification.startsWith("5")
    )
      type = "DESPESA";
  }

  const isSynthetic =
    isSyntheticRaw === "true" || isSyntheticRaw === "1" || classification.split(".").length < 5;

  if (!list.some((item) => item.classification === classification)) {
    list.push({
      code,
      classification,
      name,
      type,
      isSynthetic,
    });
  }
}

/**
 * @param {unknown[]} rawList
 * @param {unknown[]} planoContas
 */
function normalizeAndAddAccountList(rawList, planoContas) {
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const classification = String(item.classification || "").trim();
    const code = String(item.code || "").trim();
    const name = String(item.name || "").trim().toUpperCase();

    if (!classification || !name) continue;

    const hasNumbers = /[0-9]/.test(classification);
    if (!hasNumbers) continue;

    let type = "ATIVO";
    const typeRaw = String(item.type || "").toUpperCase();
    if (typeRaw.includes("PASSIVO")) type = "PASSIVO";
    else if (typeRaw.includes("RECEITA")) type = "RECEITA";
    else if (typeRaw.includes("DESPESA")) type = "DESPESA";
    else if (typeRaw.includes("PATRIMONIO") || typeRaw.includes("LIQUIDO")) type = "PATRIMONIO_LIQUIDO";
    else {
      if (classification.startsWith("1")) type = "ATIVO";
      else if (classification.startsWith("2.3") || classification.startsWith("2.4")) type = "PATRIMONIO_LIQUIDO";
      else if (classification.startsWith("2")) type = "PASSIVO";
      else if (classification.startsWith("3.1") || classification.startsWith("3.3") || classification.startsWith("4.1"))
        type = "RECEITA";
      else if (
        classification.startsWith("3.2") ||
        classification.startsWith("3") ||
        classification.startsWith("4") ||
        classification.startsWith("5")
      )
        type = "DESPESA";
    }

    const isSynthetic =
      item.isSynthetic === true || item.isSynthetic === "true" || classification.split(".").length < 5;

    if (!planoContas.some((existing) => existing.classification === classification)) {
      planoContas.push({
        code: code || String(planoContas.length + 1),
        classification,
        name,
        type,
        isSynthetic,
      });
    }
  }
}

/**
 * @param {string} textResult
 * @param {unknown[]} planoContas
 * @returns {boolean}
 */
function parsePlanoResponse(textResult, planoContas) {
  try {
    const sanitized = sanitizeJsonString(textResult);
    const parsedData = JSON.parse(sanitized);
    if (parsedData.planoContas && Array.isArray(parsedData.planoContas)) {
      normalizeAndAddAccountList(parsedData.planoContas, planoContas);
    } else if (parsedData.planoContasCsv) {
      const lines = normalizeAndSplitLines(parsedData.planoContasCsv);
      for (const line of lines) {
        parseAndAddCsvLine(line, planoContas);
      }
    } else {
      const scanned = scanForJsonObjects(textResult);
      if (scanned.length > 0) {
        normalizeAndAddAccountList(scanned, planoContas);
      } else {
        const lines = normalizeAndSplitLines(textResult);
        for (const line of lines) {
          parseAndAddCsvLine(line, planoContas);
        }
      }
    }
    return true;
  } catch (jsonErr) {
    console.warn("[Convert Plano] Falha ao analisar JSON, ativando extratores robustos...", jsonErr);
    const scanned = scanForJsonObjects(textResult);
    if (scanned.length > 0) {
      normalizeAndAddAccountList(scanned, planoContas);
    } else {
      const extractedCsv = extractCsvFromPossiblyMalformedJson(textResult);
      const lines = normalizeAndSplitLines(extractedCsv);
      for (const line of lines) {
        parseAndAddCsvLine(line, planoContas);
      }
    }
    return false;
  }
}

/**
 * @param {number} index
 * @param {number} total
 * @param {string} [chunkTextToParse]
 */
function buildPlanoPdfPrompt(index, total, chunkTextToParse) {
  return `Você é um contador e analista de sistemas contábeis sênior brasileiro. Analise a parte ${index + 1} de ${total} do documento fornecido e extraia absolutamente TODAS as contas contábeis presentes nela, sem qualquer exceção, abreviação, corte ou resumo.

        ${chunkTextToParse ? `Texto para análise:\n${chunkTextToParse}` : ""}
        
        DIRETRIZES DE EXTRAÇÃO CRÍTICAS:
        1. EXAUSTIVIDADE MÁXIMA: Extraia todas as contas, uma por uma. Não omita contas para economizar espaço. Se houver dezenas de itens nesta parte, extraia todos eles.
        2. ESTRUTURA COMPLETA: Extraia tanto as contas SINTÉTICAS (grupos, subgrupos, contas principais ou totalizadoras) quanto as contas ANALÍTICAS (contas detalhadas de lançamentos). Não ignore os níveis superiores (e.g. Ativo, Passivo, Despesas), pois eles são vitais para a estrutura.
        3. CLASSIFICAÇÃO E CÓDIGO REDUZIDO:
           - code: Código reduzido ou chave de lançamentos. Se não houver explicitamente no documento, crie um número sequencial exclusivo como string (e.g. "1", "2", "3").
           - classification: Código de classificação estruturada (e.g., '1.1.1.01.001', '2.01.01.002'). Preserve os pontos e a formatação original.
           - name: Nome da conta contábil limpo, em maiúsculas (e.g., 'CAIXA GERAL', 'MÓVEIS E UTENSÍLIOS').
           - type: Grupo/Tipo da conta. Deve ser EXATAMENTE um dos seguintes valores permitidos: "ATIVO", "PASSIVO", "PATRIMONIO_LIQUIDO", "RECEITA", "DESPESA".
           - isSynthetic: true se for uma conta sintética/grupo (geralmente com menos dígitos ou que possui subcontas), false se for analítica (geralmente o último grau que recebe lançamentos).
        4. NÃO use reticências, não pare no meio do documento. Continue extraindo até a última linha do fragmento.`;
}

/**
 * @param {string} [textToParse]
 */
function buildPlanoGeneralPrompt(textToParse) {
  return `Você é um contador e analista de sistemas contábeis sênior brasileiro. Analise o documento completo fornecido e extraia absolutamente TODAS as contas contábeis presentes, sem qualquer exceção, abreviação, corte ou resumo.

      ${textToParse ? `Texto para análise:\n${textToParse}` : ""}
      
      DIRETRIZES DE EXTRAÇÃO CRÍTICAS:
      1. EXAUSTIVIDADE MÁXIMA: Extraia todas as contas, uma por uma. Não omita contas para economizar espaço. Se o plano de contas tiver centenas de itens, extraia todos eles.
      2. ESTRUTURA COMPLETA: Extraia tanto as contas SINTÉTICAS (grupos, subgrupos, contas principais ou totalizadoras) quanto as contas ANALÍTICAS (contas detalhadas de lançamentos). Não ignore os níveis superiores (e.g. Ativo, Passivo, Despesas), pois eles são vitais para a estrutura.
      3. CLASSIFICAÇÃO E CÓDIGO REDUZIDO:
         - code: Código reduzido ou chave de lançamentos. Se não houver explicitamente no documento, crie um número sequencial exclusivo como string (e.g. "1", "2", "3").
         - classification: Código de classification estruturada (e.g., '1.1.1.01.001', '2.01.01.002'). Preserve os pontos e a formatação original.
         - name: Nome da conta contábil limpo, em maiúsculas (e.g., 'CAIXA GERAL', 'MÓVEIS E UTENSÍLIOS').
         - type: Grupo/Tipo da conta. Deve ser EXATAMENTE um dos seguintes valores permitidos: "ATIVO", "PASSIVO", "PATRIMONIO_LIQUIDO", "RECEITA", "DESPESA".
         - isSynthetic: true se for uma conta sintética/grupo (geralmente com menos dígitos ou que possui subcontas), false se for analítica (geralmente o último grau que recebe lançamentos).
      4. NÃO use reticências, não pare no meio do documento. Continue extraindo até a última linha.`;
}

async function processPlanoPdfChunk(ai, activeModel, chunkBase64, mimeType, index, totalChunks) {
  console.log(`[Convert Plano] Processando parte ${index + 1} de ${totalChunks}…`);

  let pdfExtractedText = "";
  let isLikelyDigital = false;
  try {
    const buffer = Buffer.from(chunkBase64, "base64");
    const parsedPdf = await parsePdfBuffer(buffer);
    if (parsedPdf?.text?.trim().length > 15) {
      pdfExtractedText = parsedPdf.text;
      const hasStructure = /\d+(\.\d+){2,}/.test(pdfExtractedText) || /\d{3,}/.test(pdfExtractedText);
      isLikelyDigital = pdfExtractedText.length > 100 && hasStructure;
      console.log(
        `[Plano Part ${index + 1}] Texto extraído: ${pdfExtractedText.length} caracteres. Digital: ${isLikelyDigital}`,
      );
    }
  } catch (pdfErr) {
    console.error(`[Plano Part ${index + 1}] Falha ao extrair texto do PDF via pdf-parse:`, pdfErr);
  }

  /** @type {unknown[]} */
  const chunkContents = [];
  let chunkTextToParse = "";

  if (pdfExtractedText && isLikelyDigital) {
    chunkTextToParse = pdfExtractedText;
  } else {
    console.log(`[Plano Part ${index + 1}] Enviando faturamento via inlineData para OCR completo.`);
    chunkContents.push({
      inlineData: {
        data: chunkBase64,
        mimeType: mimeType || "application/pdf",
      },
    });
  }

  chunkContents.push({ text: buildPlanoPdfPrompt(index, totalChunks, chunkTextToParse) });

  const response = await generateContentWithRetry(ai, activeModel, chunkContents, PLANO_GENERATION_CONFIG);

  const textResult = response.text;
  if (!textResult) {
    throw new Error(`O modelo Gemini não retornou nenhum dado analisável na parte ${index + 1}.`);
  }

  /** @type {unknown[]} */
  const localPlano = [];
  const ok = parsePlanoResponse(textResult, localPlano);
  return { ok, localPlano };
}

function mergePlanoChunkResults(planoContas, chunkResults) {
  let usedFallback = false;
  for (const result of chunkResults) {
    if (!result?.ok) usedFallback = true;
    for (const item of result?.localPlano ?? []) {
      const classification = String(item?.classification ?? "").trim();
      if (!classification) continue;
      if (!planoContas.some((existing) => existing.classification === classification)) {
        planoContas.push(item);
      }
    }
  }
  return usedFallback;
}

/**
 * @param {import("@google/genai").GoogleGenAI} ai
 * @param {string} activeModel
 * @param {string} fileBase64
 * @param {string} mimeType
 * @param {unknown[]} planoContas
 * @returns {Promise<boolean>}
 */
async function processPlanoPdf(ai, activeModel, fileBase64, mimeType, planoContas) {
  const pdfChunks = await splitPdfIntoChunks(fileBase64, 5);
  console.log(`[Convert Plano] Processando ${pdfChunks.length} parte(s) sequencialmente…`);

  /** @type {Awaited<ReturnType<typeof processPlanoPdfChunk>>[]} */
  const results = [];
  for (let index = 0; index < pdfChunks.length; index++) {
    results.push(
      await processPlanoPdfChunk(ai, activeModel, pdfChunks[index], mimeType, index, pdfChunks.length),
    );
    if (pdfChunks.length > 1 && index < pdfChunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, CHUNK_PAUSE_MS));
    }
  }

  return mergePlanoChunkResults(planoContas, results);
}

async function processPlanoImageChunk(ai, activeModel, image, index, totalImages, textToParse) {
  const base64 = image.base64 || image.data || "";
  const mimeType = image.mimeType || "image/jpeg";

  if (!base64) return { ok: true, localPlano: [] };

  /** @type {unknown[]} */
  const contents = [
    {
      inlineData: {
        data: base64,
        mimeType,
      },
    },
  ];

  const promptText =
    totalImages > 1
      ? buildPlanoPdfPrompt(index, totalImages, textToParse || undefined)
      : buildPlanoGeneralPrompt(textToParse || undefined);

  contents.push({ text: promptText });

  const response = await generateContentWithRetry(ai, activeModel, contents, PLANO_GENERATION_CONFIG);

  const textResult = response.text;
  if (!textResult) {
    throw new Error(`O modelo Gemini não retornou nenhum dado analisável na imagem ${index + 1}.`);
  }

  /** @type {unknown[]} */
  const localPlano = [];
  const ok = parsePlanoResponse(textResult, localPlano);
  return { ok, localPlano };
}

/**
 * @param {import("@google/genai").GoogleGenAI} ai
 * @param {string} activeModel
 * @param {Array<{ base64?: string, data?: string, mimeType?: string }>} images
 * @param {string} textToParse
 * @param {unknown[]} planoContas
 * @returns {Promise<boolean>}
 */
async function processPlanoImages(ai, activeModel, images, textToParse, planoContas) {
  const validImages = images.filter((img) => img?.base64 || img?.data);
  if (!validImages.length) return false;

  console.log(`[Convert Plano] Processando ${validImages.length} imagem(ns) sequencialmente…`);

  /** @type {Awaited<ReturnType<typeof processPlanoImageChunk>>[]} */
  const results = [];
  for (let index = 0; index < validImages.length; index++) {
    results.push(
      await processPlanoImageChunk(
        ai,
        activeModel,
        validImages[index],
        index,
        validImages.length,
        textToParse,
      ),
    );
    if (validImages.length > 1 && index < validImages.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, CHUNK_PAUSE_MS));
    }
  }

  return mergePlanoChunkResults(planoContas, results);
}

/**
 * Converte documento em plano de contas via Gemini.
 * @param {{
 *   fileBase64?: string,
 *   mimeType?: string,
 *   fileName?: string,
 *   selectedModel?: string,
 *   customApiKey?: string,
 *   images?: Array<{ base64?: string, data?: string, mimeType?: string }>,
 *   textContent?: string,
 *   ocrText?: string
 * }} params
 * @returns {Promise<{ planoContas: unknown[], usedFallback?: boolean }>}
 */
export async function convertPlano({
  fileBase64,
  mimeType,
  fileName,
  selectedModel,
  customApiKey,
  images,
  textContent,
  ocrText,
}) {
  let textToParse = textContent || ocrText || "";

  const ai = getGeminiClient(customApiKey);
  const activeModel = sanitizeGeminiModel(selectedModel || DEFAULT_GEMINI_MODEL);

  /** @type {unknown[]} */
  const planoContas = [];
  let usedFallback = false;

  const hasImages = Array.isArray(images) && images.length > 0;
  const isPdf = mimeType && (mimeType.includes("pdf") || /\.(pdf)$/i.test(fileName || ""));

  if (hasImages) {
    usedFallback = await processPlanoImages(ai, activeModel, images, textToParse, planoContas);
  } else if (fileBase64 && mimeType && isPdf) {
    usedFallback = await processPlanoPdf(ai, activeModel, fileBase64, mimeType, planoContas);
  } else {
    /** @type {unknown[]} */
    const contents = [];

    if (fileBase64 && mimeType) {
      const isExcelOrCsv =
        mimeType.includes("sheet") ||
        mimeType.includes("excel") ||
        mimeType.includes("csv") ||
        /\.(xlsx|xls|csv)$/i.test(fileName || "");

      if (isExcelOrCsv) {
        const buffer = Buffer.from(fileBase64, "base64");
        const workbook = xlsx.read(buffer, { type: "buffer" });
        let sheetText = "";
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const csv = xlsx.utils.sheet_to_csv(sheet);
          sheetText += `Aba: ${sheetName}\n${csv}\n\n`;
        }
        textToParse = sheetText;
      } else if (!isPdf) {
        contents.push({
          inlineData: {
            data: fileBase64,
            mimeType,
          },
        });
      }
    }

    contents.push({ text: buildPlanoGeneralPrompt(textToParse || undefined) });

    const response = await generateContentWithRetry(ai, activeModel, contents, PLANO_GENERATION_CONFIG);

    const textResult = response.text;
    if (!textResult) {
      throw new Error("O modelo Gemini não retornou nenhum dado analisável.");
    }

    const ok = parsePlanoResponse(textResult, planoContas);
    if (!ok) usedFallback = true;
  }

  if (planoContas.length === 0) {
    throw new Error("Não foi possível extrair nenhuma conta do documento após a análise padrão e de resiliência.");
  }

  console.log(
    `Extraídas com sucesso ${planoContas.length} contas contábeis do documento (Fallback usado: ${usedFallback}).`,
  );

  return { planoContas, usedFallback };
}
