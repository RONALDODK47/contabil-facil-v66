/** @typedef {{ date: string, description: string, amount: number, type: string, category: string }} Transaction */

/**
 * Sanitiza JSON malformado (aspas não escapadas, vírgulas finais, markdown).
 * @param {string} rawText
 * @returns {string}
 */
export function sanitizeJsonString(rawText) {
  let cleaned = rawText.trim();

  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  cleaned = cleaned.trim();

  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

  const lines = cleaned.split(/\r?\n/);
  const sanitizedLines = lines.map((line) => {
    const match = line.match(/^(\s*"[^"]+"\s*:\s*")(.*)("\s*,?\s*)$/);
    if (match) {
      const prefix = match[1];
      const value = match[2];
      const suffix = match[3];
      const sanitizedValue = value.replace(/"/g, "'");
      return prefix + sanitizedValue + suffix;
    }
    return line;
  });

  return sanitizedLines.join("\n");
}

/**
 * Repara JSON truncado retornado pelo modelo.
 * @param {string} str
 * @returns {string}
 */
export function repairTruncatedJson(str) {
  let cleaned = str.trim();
  if (!cleaned) return '{"transactions":[]}';

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // continue
  }

  const transactionsIndex = cleaned.indexOf('"transactions"');
  if (transactionsIndex !== -1) {
    const arrayStartIndex = cleaned.indexOf("[", transactionsIndex);
    if (arrayStartIndex !== -1) {
      let lastCompleteObjectEnd = -1;
      let openBraces = 0;
      let inString = false;
      let escape = false;

      for (let i = arrayStartIndex + 1; i < cleaned.length; i++) {
        const char = cleaned[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (char === "\\") {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (char === "{") {
            openBraces++;
          } else if (char === "}") {
            openBraces--;
            if (openBraces === 0) {
              lastCompleteObjectEnd = i;
            }
          }
        }
      }

      if (lastCompleteObjectEnd !== -1) {
        let repaired = cleaned.substring(0, lastCompleteObjectEnd + 1).trim();
        repaired += "\n  ]\n}";
        try {
          JSON.parse(repaired);
          console.log("[JSON Repair] Successfully repaired truncated JSON by slicing back to last complete transaction object.");
          return repaired;
        } catch {
          // fallback
        }
      }
    }
  }

  let repaired = cleaned;

  let changed = true;
  while (changed) {
    changed = false;
    repaired = repaired.trim();

    if (repaired.endsWith(",")) {
      repaired = repaired.slice(0, -1).trim();
      changed = true;
      continue;
    }

    if (repaired.endsWith(":")) {
      repaired = repaired.slice(0, -1).trim();
      changed = true;
      continue;
    }

    let inString = false;
    let escape = false;
    let lastQuoteIndex = -1;

    for (let i = 0; i < repaired.length; i++) {
      if (repaired[i] === "\\") {
        escape = !escape;
      } else if (repaired[i] === '"' && !escape) {
        lastQuoteIndex = i;
        inString = !inString;
      } else {
        escape = false;
      }
    }

    if (inString && lastQuoteIndex !== -1) {
      repaired = repaired.substring(0, lastQuoteIndex).trim();
      changed = true;
      continue;
    }

    const trailingKeyRegex = /,\s*"[^"]+"\s*$/;
    if (trailingKeyRegex.test(repaired)) {
      repaired = repaired.replace(trailingKeyRegex, "").trim();
      changed = true;
      continue;
    }

    const trailingFragmentRegex = /:\s*[^"\{\}\[\]\s,]+$/;
    if (trailingFragmentRegex.test(repaired)) {
      const match = repaired.match(/:\s*([^"\{\}\[\]\s,]+)$/);
      const val = match ? match[1] : "";
      if (val !== "true" && val !== "false" && val !== "null" && isNaN(Number(val))) {
        repaired = repaired.replace(/:\s*[^"\{\}\[\]\s,]+$/, "").trim();
        changed = true;
        continue;
      }
    }
  }

  const openBracesAndBrackets = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "{" || char === "[") {
        openBracesAndBrackets.push(char);
      } else if (char === "}" || char === "]") {
        const expected = char === "}" ? "{" : "[";
        if (
          openBracesAndBrackets.length > 0 &&
          openBracesAndBrackets[openBracesAndBrackets.length - 1] === expected
        ) {
          openBracesAndBrackets.pop();
        }
      }
    }
  }

  const reverseStack = [...openBracesAndBrackets].reverse();
  for (const open of reverseStack) {
    if (open === "{") {
      repaired += "}";
    } else if (open === "[") {
      repaired += "]";
    }
  }

  try {
    JSON.parse(repaired);
    console.log("[JSON Repair] Succeeded with clean-and-close strategy.");
    return repaired;
  } catch {
    console.error("[JSON Repair] Repair failed. Returning original.");
    return str;
  }
}

/**
 * Parser resiliente de transações a partir de JSON (ou texto malformado).
 * @param {string} textResult
 * @returns {{ transactions: Transaction[], currency: string, summary: string }}
 */
export function parseTransactionsWithResilience(textResult) {
  const cleanText = sanitizeJsonString(textResult);

  try {
    return JSON.parse(cleanText);
  } catch {
    console.log("[JSON Parser] Standard parsing failed, attempting structural repair...");
    try {
      const repaired = repairTruncatedJson(cleanText);
      return JSON.parse(repaired);
    } catch {
      console.log("[JSON Parser] Structural repair was incomplete, activating regex heuristics...");
    }
  }

  const extractField = (str, fieldName) => {
    const regexWithQuotes = new RegExp(`"${fieldName}"\\s*:\\s*"(.*?)"\\s*(?:,\\s*"|\\s*})`, "is");
    const matchQ = str.match(regexWithQuotes);
    if (matchQ) return matchQ[1].trim();

    const regexSimple = new RegExp(`"${fieldName}"\\s*:\\s*"(.*?)"`, "i");
    const matchS = str.match(regexSimple);
    if (matchS) return matchS[1].trim();

    const regexUnquoted = new RegExp(`"${fieldName}"\\s*:\\s*([^",}\\s]+)`, "i");
    const matchU = str.match(regexUnquoted);
    if (matchU) return matchU[1].trim();

    return "";
  };

  /** @type {Transaction[]} */
  const transactions = [];
  let currency = "BRL";
  let summary = "Extrato Processado";

  const currencyVal = extractField(cleanText, "currency");
  if (currencyVal) {
    currency = currencyVal;
  }

  const summaryVal = extractField(cleanText, "summary");
  if (summaryVal) {
    summary = summaryVal;
  }

  const objRegex = /\{[^{}]*\}/g;
  let match;
  while ((match = objRegex.exec(cleanText)) !== null) {
    const objStr = match[0];
    if (objStr.includes("description") || objStr.includes("amount")) {
      try {
        const parsedObj = JSON.parse(objStr);
        if (parsedObj.date || parsedObj.description || parsedObj.amount !== undefined) {
          transactions.push({
            date: parsedObj.date || new Date().toISOString().split("T")[0],
            description: parsedObj.description || "Transação sem descrição",
            amount:
              typeof parsedObj.amount === "number"
                ? parsedObj.amount
                : parseFloat(String(parsedObj.amount || 0)),
            type:
              parsedObj.type === "CREDIT" || parsedObj.type === "DEBIT"
                ? parsedObj.type
                : parsedObj.amount >= 0
                  ? "CREDIT"
                  : "DEBIT",
            category: parsedObj.category || "Geral",
          });
          continue;
        }
      } catch {
        const dateVal = extractField(objStr, "date");
        const descVal = extractField(objStr, "description");
        const amtVal = extractField(objStr, "amount");
        const typeVal = extractField(objStr, "type");
        const catVal = extractField(objStr, "category");

        if (descVal || amtVal) {
          const amt = amtVal ? parseFloat(amtVal) : 0;
          transactions.push({
            date: dateVal || new Date().toISOString().split("T")[0],
            description: descVal || "Transação",
            amount: isNaN(amt) ? 0 : amt,
            type:
              typeVal === "CREDIT" || typeVal === "DEBIT"
                ? typeVal
                : amt >= 0
                  ? "CREDIT"
                  : "DEBIT",
            category: catVal || "Geral",
          });
        }
      }
    }
  }

  if (transactions.length === 0) {
    const lines = cleanText.split(/\n/);
    /** @type {Record<string, unknown>} */
    let currentTx = {};
    for (const line of lines) {
      const dateVal = extractField(line, "date");
      const descVal = extractField(line, "description");
      const amtVal = extractField(line, "amount");
      const typeVal = extractField(line, "type");
      const catVal = extractField(line, "category");

      if (dateVal) currentTx.date = dateVal;
      if (descVal) currentTx.description = descVal;
      if (amtVal) currentTx.amount = parseFloat(amtVal);
      if (typeVal) currentTx.type = typeVal;
      if (catVal) currentTx.category = catVal;

      if (currentTx.description !== undefined && currentTx.amount !== undefined) {
        const amt = isNaN(Number(currentTx.amount)) ? 0 : Number(currentTx.amount);
        transactions.push({
          date: String(currentTx.date || new Date().toISOString().split("T")[0]),
          description: String(currentTx.description),
          amount: amt,
          type:
            currentTx.type === "CREDIT" || currentTx.type === "DEBIT"
              ? String(currentTx.type)
              : amt >= 0
                ? "CREDIT"
                : "DEBIT",
          category: String(currentTx.category || "Geral"),
        });
        currentTx = {};
      }
    }
  }

  if (transactions.length === 0) {
    console.log("[Resilience] Fallback 2: Scanning line by line for raw date, amount and description...");
    const lines = cleanText.split(/\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 8) continue;

      const dateMatch = trimmed.match(/\b(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4}|\d{2}[-/]\d{2})\b/);
      if (!dateMatch) continue;

      const matchedDateStr = dateMatch[1];
      let dateVal = matchedDateStr;

      const dateParts = matchedDateStr.split(/[-/]/);
      if (dateParts.length === 2) {
        dateVal = `2026-${dateParts[1].padStart(2, "0")}-${dateParts[0].padStart(2, "0")}`;
      } else if (dateParts.length === 3) {
        if (dateParts[0].length === 4) {
          dateVal = `${dateParts[0]}-${dateParts[1].padStart(2, "0")}-${dateParts[2].padStart(2, "0")}`;
        } else {
          dateVal = `${dateParts[2]}-${dateParts[1].padStart(2, "0")}-${dateParts[0].padStart(2, "0")}`;
        }
      }

      const textWithoutDate = trimmed.replace(matchedDateStr, "");
      const numbers = textWithoutDate.match(/[-+]?\s*\d+(?:[\.,]\d+)+|[-+]?\s*\b\d+\b/g);
      if (!numbers) continue;

      let amountVal = null;
      let matchedNumberStr = "";

      for (const numStr of numbers) {
        const cleanedNum = numStr.replace(/\s/g, "");
        let val = 0;

        if (cleanedNum.includes(",") && cleanedNum.includes(".")) {
          if (cleanedNum.indexOf(".") < cleanedNum.indexOf(",")) {
            val = parseFloat(cleanedNum.replace(/\./g, "").replace(",", "."));
          } else {
            val = parseFloat(cleanedNum.replace(/,/g, ""));
          }
        } else if (cleanedNum.includes(",")) {
          val = parseFloat(cleanedNum.replace(",", "."));
        } else {
          val = parseFloat(cleanedNum);
        }

        if (!isNaN(val) && val !== 0) {
          const isLikelyAmount =
            numStr.includes(",") ||
            numStr.includes(".") ||
            numStr.includes("-") ||
            numStr.includes("+") ||
            Math.abs(val) > 10;
          if (isLikelyAmount || amountVal === null) {
            amountVal = val;
            matchedNumberStr = numStr;
          }
        }
      }

      if (amountVal !== null) {
        let descVal = textWithoutDate
          .replace(matchedNumberStr, "")
          .replace(/[R\$|;\t\-+\*\|]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (descVal.length < 2) {
          descVal = "Transação Automática";
        }

        transactions.push({
          date: dateVal,
          description: descVal,
          amount: amountVal,
          type: amountVal >= 0 ? "CREDIT" : "DEBIT",
          category: "Geral",
        });
      }
    }
  }

  if (transactions.length === 0) {
    throw new Error("Não foi possível extrair nenhuma transação válida da resposta do modelo.");
  }

  return {
    transactions,
    currency,
    summary,
  };
}
