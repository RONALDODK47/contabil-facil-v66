import { createRequire } from "module";

const require = createRequire(import.meta.url);

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ text?: string, numpages?: number, [key: string]: unknown }>}
 */
export async function parsePdfBuffer(buffer) {
  let pdfLib;
  try {
    pdfLib = require("pdf-parse-new");
  } catch (err) {
    console.warn("Could not load pdf-parse-new, falling back to pdf-parse:", err);
    pdfLib = require("pdf-parse");
  }

  let parseFn = pdfLib;
  if (pdfLib && typeof pdfLib.default === "function") {
    parseFn = pdfLib.default;
  } else if (pdfLib && typeof pdfLib === "object" && typeof pdfLib.pdf === "function") {
    parseFn = pdfLib.pdf;
  }

  if (typeof parseFn !== "function") {
    const fnKey = Object.keys(pdfLib).find((k) => typeof pdfLib[k] === "function");
    if (fnKey) {
      parseFn = pdfLib[fnKey];
    } else {
      throw new TypeError(
        `pdf-parse library resolve failed. Expected function, got ${typeof pdfLib}. Keys: ${Object.keys(pdfLib).join(", ")}`,
      );
    }
  }
  return await parseFn(buffer);
}

/**
 * @param {string} fileBase64
 * @param {number} [pagesPerChunk=5]
 * @returns {Promise<string[]>}
 */
export async function splitPdfIntoChunks(fileBase64, pagesPerChunk = 5) {
  try {
    const { PDFDocument } = require("pdf-lib");
    const buffer = Buffer.from(fileBase64, "base64");
    const mainPdfDoc = await PDFDocument.load(buffer);
    const pageCount = mainPdfDoc.getPageCount();

    console.log(`[PDF Split] Carregado PDF com ${pageCount} páginas.`);

    if (pageCount <= pagesPerChunk) {
      return [fileBase64];
    }

    /** @type {string[]} */
    const chunks = [];
    for (let i = 0; i < pageCount; i += pagesPerChunk) {
      const chunkPdfDoc = await PDFDocument.create();
      const endPage = Math.min(i + pagesPerChunk, pageCount);
      /** @type {number[]} */
      const indices = [];
      for (let j = i; j < endPage; j++) {
        indices.push(j);
      }

      const copiedPages = await chunkPdfDoc.copyPages(mainPdfDoc, indices);
      for (const page of copiedPages) {
        chunkPdfDoc.addPage(page);
      }

      const chunkBytes = await chunkPdfDoc.save();
      const chunkBase64 = Buffer.from(chunkBytes).toString("base64");
      chunks.push(chunkBase64);
    }

    console.log(
      `[PDF Split] Dividido com sucesso em ${chunks.length} lotes de ${pagesPerChunk} páginas cada.`,
    );
    return chunks;
  } catch (err) {
    console.error("[PDF Split] Erro ao dividir PDF usando pdf-lib, continuando sem divisão:", err);
    return [fileBase64];
  }
}
