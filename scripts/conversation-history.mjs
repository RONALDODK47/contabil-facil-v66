/**
 * Histórico para conversas longas — janela deslizante (horas de papo sem estourar RAM).
 */

const DEFAULT_MAX_TURNS = 16;
const DEFAULT_MAX_CHARS = 700;

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {{ maxTurns?: number, maxChars?: number }} opts
 */
export function buildConversationContext(messages, opts = {}) {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  const system = messages.filter((m) => m.role === 'system');
  const dialog = messages.filter((m) => m.role !== 'system');

  const trimmed = dialog.slice(-maxTurns).map((m) => ({
    role: m.role,
    content: String(m.content ?? '')
      .trim()
      .slice(0, maxChars),
  }));

  return [...system, ...trimmed.filter((m) => m.content)];
}

/** Limite de turnos guardados no cliente (sessão longa). */
export const CLIENT_HISTORY_MAX = 48;

/**
 * @template T
 * @param {T[]} turns
 * @param {number} max
 */
export function trimClientHistory(turns, max = CLIENT_HISTORY_MAX) {
  if (turns.length <= max) return turns;
  return turns.slice(-max);
}
