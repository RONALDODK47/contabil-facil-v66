import * as XLSX from "xlsx";
import { Transaction } from "../types";
import { sanitizeHistory, BANK_HEADER_PATTERNS } from "./parser";

export const processExcelFile = async (f: File, ignoreList?: string[]): Promise<{ transactions: Transaction[], rows: any[][] }> => {
  try {
    const arrayBuffer = await f.arrayBuffer();
    
    // Try to read the workbook. XLSX.read is quite robust.
    // We use type: 'array' which handles both binary (XLSX, XLS, XLSB) and text (CSV, HTML, etc.)
    let workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error("Planilha vazia ou formato inválido");
    
    const firstSheet = workbook.Sheets[firstSheetName];
    // Convert to array of arrays for easier processing
    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" }) as any[][];

    if (rows.length === 0) return { transactions: [], rows: [] };

    const extracted: Transaction[] = [];
    let lastDate = "N/D";

    // Heuristic to find columns
    let dateCol = -1;
    let descCol = -1;
    let valCol = -1;
    let cdCol = -1;

    // Scan first 20 rows to find headers or data patterns
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const row = rows[i];
        row.forEach((cell, colIdx) => {
            const s = String(cell).toUpperCase().trim();
            if (dateCol === -1 && (s.includes("DATA") || s.includes("DATE") || s.match(/^\d{2}\/\d{2}/))) dateCol = colIdx;
            if (descCol === -1 && (s.includes("HISTORICO") || s.includes("DESCRI") || s.includes("HIST") || s.includes("NARRATIVA"))) descCol = colIdx;
            if (valCol === -1 && (s.includes("VALOR") || s.includes("VALUE") || s.includes("MONTANTE") || s.match(/\d+,\d{2}/))) valCol = colIdx;
            if (cdCol === -1 && (s === "D/C" || s === "TIPO" || s === "C/D")) cdCol = colIdx;
        });
    }

    // Fallback defaults if not found
    if (dateCol === -1) dateCol = 0;
    if (descCol === -1) descCol = 1;
    if (valCol === -1) valCol = 2;

    // Custom ignore logic - CONTAINS match (case insensitive)
    const shouldIgnore = (t: string) => {
      const trimmed = t.trim();
      if (trimmed.length === 0) return true;

      if (!ignoreList || ignoreList.length === 0) return false;
      const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const rowNorm = normalize(trimmed);
      return ignoreList.some(k => rowNorm.includes(normalize(k).trim()));
    };

    rows.forEach((row, i) => {
      if (!row || !Array.isArray(row) || row.length === 0) return;
      
      const rowStr = row.join(" ");
      if (shouldIgnore(rowStr)) return;

      const dateCell = row[dateCol];
      const descCell = row[descCol];
      const valCell = row[valCol];
      const cdCell = cdCol !== -1 ? row[cdCol] : null;

      // 1. Date Detection
      if (dateCell) {
          let dStr = String(dateCell).trim();
          // Handle Excel date serial numbers if they weren't converted
          if (typeof dateCell === 'number' && dateCell > 40000 && dateCell < 60000) {
              const d = new Date((dateCell - 25569) * 86400 * 1000);
              dStr = d.toLocaleDateString('pt-BR');
          }
          const m = dStr.match(/\d{2}\/\d{2}(\/\d{2,4})?/);
          if (m) {
              const prefix = rowStr.substring(0, rowStr.indexOf(m[0])).toLowerCase();
              const isNoise = /emitido|impresso|gerado|emiss[ãa]o|p[áa]gina|vencimento|venc\.|venc\b|agendado|previs[ãa]o|vence\s+em/i.test(prefix);
              if (!isNoise) lastDate = m[0];
          }
      }

      // 2. Value Detection
      if (valCell !== undefined && valCell !== null && valCell !== "") {
          let numVal: number = 0;
          let foundValue = false;

          if (typeof valCell === 'number') {
              numVal = valCell;
              foundValue = true;
          } else {
              const sVal = String(valCell).trim();
              if (sVal.match(/^-?[\d\.,]+$/) || sVal.includes(',') || sVal.includes('.')) {
                  const isNegative = sVal.includes('(') || sVal.includes('-');
                  const cleaned = sVal.replace(/[^\d,]/g, '').replace(',', '.');
                  numVal = parseFloat(cleaned);
                  if (isNegative) numVal = -Math.abs(numVal);
                  if (!isNaN(numVal)) foundValue = true;
              }
          }

          if (foundValue && numVal !== 0) {
              // 3. CD Detection
              let cd: 'C' | 'D' = numVal < 0 ? 'D' : 'C';
              const sCdCell = String(cdCell || '').trim().toLowerCase();
              const sValCell = String(valCell || '').trim().toLowerCase();

              if (sCdCell) {
                  if (sCdCell.includes('c') && !sCdCell.includes('d')) cd = 'C';
                  else if (sCdCell.includes('d') && !sCdCell.includes('c')) cd = 'D';
                  else if (/\bcr[eé]d/i.test(sCdCell)) cd = 'C';
                  else if (/\bd[eé]b/i.test(sCdCell)) cd = 'D';
                  else if (sCdCell.startsWith('c')) cd = 'C';
                  else if (sCdCell.startsWith('d')) cd = 'D';
                  else if (sCdCell.includes('-') || sCdCell.includes('−')) cd = 'D';
                  else if (sCdCell.includes('+')) cd = 'C';
                  else if (sCdCell.includes('c')) cd = 'C';
                  else if (sCdCell.includes('d')) cd = 'D';
              } else if (sValCell.includes(' d') || sValCell.endsWith('d')) {
                  cd = 'D';
              } else if (sValCell.includes(' c') || sValCell.endsWith('c')) {
                  cd = 'C';
              } else {
                  const lower = rowStr.toLowerCase();
                  if (/\b(debito|deb|saida)\b/i.test(lower)) cd = 'D';
                  else if (/\b(credito|cre|entrada)\b/i.test(lower)) cd = 'C';
                  else if (lower.includes(' d') || lower.endsWith('d')) cd = 'D';
                  else if (lower.includes(' c') || lower.endsWith('c')) cd = 'C';
              }

              // 4. History Cleaning
              const rawDesc = descCell ? String(descCell) : "";
              const historico = sanitizeHistory(rawDesc) || "Lançamento";

              // Filter out transactions based on ignore list
              if (ignoreList && ignoreList.length > 0) {
                  const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
                  const histNorm = normalize(historico);
                  
                  if (ignoreList.some(k => histNorm.includes(normalize(k).trim()))) {
                      return; // Skip this transaction
                  }
              }

              extracted.push({
                  id: `excel-${i}`,
                  data: lastDate,
                  historico,
                  valor: cd === 'D' ? -Math.abs(numVal) : Math.abs(numVal),
                  cd,
                  isInheritedDate: !String(dateCell).match(/\d{2}\/\d{2}/)
              });
          }
      }
    });

    return { transactions: extracted, rows };
  } catch (error) {
    console.error("Erro ao processar Excel:", error);
    throw error;
  }
};
