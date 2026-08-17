/**
 * Respostas instantâneas — espelho de cerebro_agente._resposta_imediata_local (FlowMind).
 */
export function flowmindInstantReply(text) {
  const bruto = String(text ?? '').trim();
  if (!bruto || bruto.length > 200) return null;

  const t = bruto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?.,;:]+/g, '')
    .trim();

  if (!t) return null;

  if (['oi', 'oii', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'e ai'].includes(t)) {
    return t === 'bom dia' ? 'Bom dia! Como posso ajudar?' : 'Oi!';
  }
  if (
    ['tudo bem', 'td bem', 'como vai', 'como vc ta', 'como voce ta', 'como voce esta', 'como ta o dia', 'como ta o dia hoje', 'como esta o dia'].includes(t) ||
    /^como (ta|esta) (o dia|seu dia|o seu dia)/.test(t)
  ) {
    return 'Tudo bem! E com você?';
  }
  if (['ok', 'blz', 'valeu', 'obrigado', 'obrigada', 'thanks', 'show', 'legal', 'entendi', 'certo'].includes(t)) {
    return 'Perfeito.';
  }
  if (['tchau', 'ate mais', 'ate logo', 'flw', 'falou'].includes(t)) {
    return 'Até mais! Qualquer coisa, estou por aqui.';
  }
  if (t === 'como assim' || t === 'hm' || t === 'hmm') {
    return null;
  }

  const m = t.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*([+\-*/x])\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if (m) {
    const a = Number.parseFloat(m[1].replace(',', '.'));
    const b = Number.parseFloat(m[3].replace(',', '.'));
    const op = m[2].replace('x', '*');
    let r;
    if (op === '+') r = a + b;
    else if (op === '-') r = a - b;
    else if (op === '*') r = a * b;
    else if (op === '/') {
      if (b === 0) return 'Não dá para dividir por zero.';
      r = a / b;
    } else return null;
    const txt = Number.isInteger(r) ? String(r) : String(Number(r.toFixed(6))).replace(/\.?0+$/, '');
    return `Resultado: ${txt}.`;
  }

  return null;
}

export function flowmindFallbackOffline(modelLabel, message) {
  const m = String(message ?? '').trim().toLowerCase();
  if (m.includes('recado') || m.includes('mensagem para')) {
    const alvo = m.includes('carol') ? 'Carol' : m.includes('esposa') ? 'sua esposa' : 'quem você quiser';
    return `Pode mandar assim para ${alvo}: "Oi! Só passando para dizer que estou pensando em você. Um beijo!" — (${modelLabel} demorou; aguarde o modelo carregar e tente de novo.)`;
  }
  return `O cérebro **${modelLabel}** demorou para responder. Aguarde alguns segundos e tente de novo (na primeira mensagem o modelo pode estar carregando na memória).`;
}
