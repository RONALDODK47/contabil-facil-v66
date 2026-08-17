/**
 * Detecta continuação de conversa — evita motor/Wikipedia em «pq?» (FlowMind).
 */

export function normalizarCurto(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .trim()
    .replace(/[!?.…]+$/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * @param {string} mensagem
 * @param {Array<{role?:string,content?:string,text?:string}>} [historico]
 */
export function ehContinuacaoConversa(mensagem, historico) {
  if (!historico?.length) return false;
  const t = normalizarCurto(mensagem);
  if (!t) return false;

  if (
    ['pq', 'por que', 'porque', 'como assim', 'hm', 'hmm', 'e', 'e ai', 'continua', 'fala mais'].includes(
      t,
    )
  ) {
    return true;
  }

  const gatilhos = [
    'pq ',
    'por que ',
    'porque ',
    'pq voce',
    'pq você',
    'pq vc',
    'como assim',
    'nao entendi',
    'não entendi',
    'o que quer dizer',
    'o que voce quis',
    'o que você quis',
    'explica ',
    'explique ',
    'respondeu',
    'disse ',
    'falou ',
    'mandou ',
    'quis dizer',
    'ta errado',
    'tá errado',
    'esta errado',
    'está errado',
  ];
  return gatilhos.some((x) => t.includes(x));
}

export function ehFactualExplicito(mensagem, sentidoId, historico) {
  if (ehContinuacaoConversa(mensagem, historico)) return false;
  return ['clima', 'cep', 'cnpj', 'cotacao', 'data_hora', 'matematica', 'capacidades'].includes(
    sentidoId,
  );
}
