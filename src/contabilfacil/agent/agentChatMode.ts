import type { AgentChatTurn } from './agentClient';

/** Cumprimentos e papo social — sempre leve. */
const SOCIAL_CHAT =
  /^(oi|olá|ola|hey|e\s*a[ií]|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|obrigad|valeu|ok|certo|entendi|legal|bacana|show|perfeito|até|tchau)\b/i;

/** Perguntas explicativas — resposta em texto, sem ferramentas. */
const EXPLANATION_QUESTION =
  /^(como|o\s+que|qual|quais|quem|onde|quando|por\s*que|me\s+(explica|conta|fala|diz)|explique|pode\s+(me\s+)?(explicar|falar|contar)|o\s+que\s+(é|são)|me\s+diz\s+(sobre|o\s+que)|fala\s+(sobre|de|da|do))\b/i;

/** Pedido de ação no software (imperativo / comando). */
const ACTION_REQUEST =
  /\b(exporta(r)?|valida(r)?|navega(r)?|importa(r)?|seleciona(r)?|gera(r)?|executa(r)?|roda(r)?|abra|abre|vá\s+para|vai\s+para|ir\s+para|faça|faz|confira|verifica|diagnostica|diagnóstico|faz\s+backup|cadastr|reponha|repor|altera(r)?\s+(o\s+|a\s+)?(parâmetro|parametro|simulação|simulacao|contrato)|lista(r)?\s+(os\s+|as\s+)?(contratos|produtos|estoque)|mostra(r)?\s+(o\s+|a\s+|os\s+|as\s+)?(cronograma|contrato|balancete|resumo)|precifica(r)?\s+(o\s+|a\s+|os\s+|as\s+)?|calcula(r)?\s+(o\s+|a\s+)?|baixa(r)?\s+(o\s+|a\s+)?(pdf|txt|arquivo)|aplica(r)?|corrige|monta|cria(r)?|salva|envia|abre\s+(a\s+)?aba)\b/i;

/** Consulta a dados reais do sistema (precisa de ferramentas). */
const LIVE_DATA_REQUEST =
  /\b(quantos\s+contratos|quais\s+contratos\s+(tenho|existem|ativo)|me\s+(mostra|liste|lista)\s+(os\s+)?contratos|status\s+(do|da)|situação\s+(do|da)|saldo\s+(do|de)|parcelas\s+(do|de)|cronograma\s+(do|de|atual)|resumo\s+(da\s+|do\s+)?precifica|estoque\s+(do|da)|produtos\s+acabados)\b/i;

/** Tarefas compostas / vários passos. */
const MULTI_STEP =
  /(\d+[\.\)]\s|primeiro.+depois|em\s+seguida|passo\s+a\s+passo|e\s+depois|e\s+então)/i;

/**
 * Conversa geral = modo leve (rápido).
 * Modo pesado só quando o pedido exige agir no software ou consultar dados reais.
 */
export function needsAgentTools(text: string, priorTurns: AgentChatTurn[]): boolean {
  if (priorTurns.some((t) => t.functionCall || t.functionResponse)) return true;

  const t = text.trim();
  if (!t) return false;

  if (SOCIAL_CHAT.test(t)) return false;
  if (EXPLANATION_QUESTION.test(t)) return false;

  if (ACTION_REQUEST.test(t)) return true;
  if (LIVE_DATA_REQUEST.test(t)) return true;

  if (MULTI_STEP.test(t) && t.length > 50) return true;

  if (
    t.length > 160 &&
    /\b(contrato|domínio|dominio|precifica|exporta|emprest|sped|ocr|balancete|gerencial)\b/i.test(t) &&
    !t.endsWith('?')
  ) {
    return true;
  }

  return false;
}

/** Histórico enviado à API — conversas longas (horas) sem estourar RAM. */
export const FAST_CHAT_HISTORY_TURNS = 24;

export function trimTurnsForFastChat<T>(turns: T[], maxTurns = FAST_CHAT_HISTORY_TURNS): T[] {
  if (turns.length <= maxTurns) return turns;
  return turns.slice(-maxTurns);
}
