/**
 * Palpites proativos da IA — envia avisos ao chat quando algo parece errado.
 */
import { pushAiInsight, type AiInsightPayload } from '../contabilfacil/agent/agentProactiveBridge';
import { callAiAssist } from './aiAssistClient';

const recentKeys = new Map<string, number>();
const DEDUPE_MS = 45_000;

function shouldSkip(dedupeKey?: string): boolean {
  if (!dedupeKey) return false;
  const last = recentKeys.get(dedupeKey);
  if (last != null && Date.now() - last < DEDUPE_MS) return true;
  recentKeys.set(dedupeKey, Date.now());
  return false;
}

export function notifyAiInsight(payload: AiInsightPayload): void {
  if (shouldSkip(payload.dedupeKey)) return;
  pushAiInsight(payload);
}

export function notifyOcrIssue(
  issue: 'empty' | 'few_items' | 'heavy_corrections' | 'offline',
  detail?: string,
): void {
  const messages: Record<typeof issue, string> = {
    empty:
      '⚠️ OCR: não detectei texto legível neste documento. Confira delimitação/colunas ou use PDF com texto nativo — a IA já usa resolução automática.',
    few_items: `⚠️ OCR: poucos trechos encontrados${detail ? ` (${detail})` : ''}. Revise o mapeamento de colunas ou a nitidez do arquivo.`,
    heavy_corrections:
      '⚠️ OCR: corrigi muitas linhas automaticamente — confira valores, datas e contas antes de importar.',
    offline: '⚠️ Poucos trechos no OCR — revise delimitação/colunas ou nitidez do arquivo.',
  };
  notifyAiInsight({
    source: 'ocr',
    message: messages[issue],
    severity: issue === 'offline' ? 'alert' : 'warning',
    dedupeKey: `ocr-${issue}-${detail ?? ''}`.slice(0, 80),
  });
}

export function notifyImportIssue(source: string, errorMessage: string): void {
  notifyAiInsight({
    source: 'importacao',
    message: `⚠️ Importação (${source}): ${errorMessage}`,
    severity: 'warning',
    dedupeKey: `import-${source}-${errorMessage.slice(0, 60)}`,
  });
}

export function notifyValidationIssue(source: string, message: string): void {
  notifyAiInsight({
    source,
    message: `⚠️ ${message}`,
    severity: 'warning',
    dedupeKey: `val-${source}-${message.slice(0, 60)}`,
  });
}

export function notifySystemIssue(message: string, dedupeKey?: string): void {
  notifyAiInsight({
    source: 'sistema',
    message: `⚠️ ${message}`,
    severity: 'alert',
    dedupeKey: dedupeKey ?? `sys-${message.slice(0, 60)}`,
  });
}

/** Compara OCR bruto vs refinado e avisa se algo parece suspeito. */
export function reviewOcrRefineQuality(
  originalLines: string[],
  refinedLines: string[],
  context?: string,
): void {
  if (originalLines.length === 0) {
    notifyOcrIssue('empty', context);
    return;
  }
  let changes = 0;
  for (let i = 0; i < originalLines.length; i++) {
    if ((originalLines[i] ?? '').trim() !== (refinedLines[i] ?? '').trim()) changes++;
  }
  const ratio = changes / originalLines.length;
  if (originalLines.length >= 4 && ratio >= 0.35) {
    notifyOcrIssue('heavy_corrections', context);
  }
}

export async function requestAiProactiveReview(facts: {
  source: string;
  context: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const out = await callAiAssist('proactive_hint', {
    source: facts.source,
    context: facts.context,
    data: facts.data ?? {},
  });
  const hint = out.text?.trim();
  if (!hint || out.skipped) return;
  notifyAiInsight({
    source: facts.source,
    message: hint.startsWith('⚠️') || hint.startsWith('💡') ? hint : `💡 ${hint}`,
    severity: hint.includes('⚠️') ? 'warning' : 'info',
    dedupeKey: `proactive-${facts.source}-${facts.context.slice(0, 40)}`,
  });
}
