/** Ponte global: qualquer módulo pode enviar palpites ao chat flutuante. */

export type AiInsightSeverity = 'info' | 'warning' | 'alert';

export interface AiInsightPayload {
  /** Origem: ocr, extrato, parcelamento, emprestimo, importacao, sistema… */
  source: string;
  message: string;
  severity?: AiInsightSeverity;
  /** Evita spam da mesma mensagem em curto intervalo */
  dedupeKey?: string;
}

export type ProactiveChatBridge = {
  pushInsight: (payload: AiInsightPayload) => void;
  isChatOpen: () => boolean;
};

let bridge: ProactiveChatBridge | null = null;

export function registerProactiveChatBridge(next: ProactiveChatBridge | null): void {
  bridge = next;
}

export function pushAiInsight(payload: AiInsightPayload): void {
  bridge?.pushInsight(payload);
}

export function isProactiveChatOpen(): boolean {
  return bridge?.isChatOpen() ?? false;
}
