/** Respostas instantâneas — espelho FlowMind cerebro_agente._resposta_imediata_local */
export function tryInstantReply(text: string): string | null {
  const bruto = text.trim();
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
  if (['ok', 'blz', 'valeu', 'obrigado', 'obrigada', 'thanks'].includes(t)) {
    return 'Perfeito.';
  }

  const m = t.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*([+\-*/x])\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if (m) {
    const a = Number.parseFloat(m[1].replace(',', '.'));
    const b = Number.parseFloat(m[3].replace(',', '.'));
    const op = m[2].replace('x', '*');
    let r: number;
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
