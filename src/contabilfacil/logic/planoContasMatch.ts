/**
 * Casa histórico do extrato com contas do plano por nome e sentido lógico.
 */
import { normalizeExtratoMatchText } from './extratoRegrasContasStorage';
import { sanitizeCodigoReduzido } from './planoContasMapper';
import type { PlanoOptionLike } from './extratoRegrasCobertura';
import {
  impostoContaCompativelComHistorico,
  isImpostoSemTipoIdentificavel,
} from './extratoRegrasCobertura';

const STOP = new Set([
  'DE', 'DA', 'DO', 'DOS', 'DAS', 'PARA', 'POR', 'COM', 'SEM', 'SOBRE', 'ENTRE',
  'LTDA', 'ME', 'EPP', 'SA', 'EIRELI', 'CIA', 'COMERCIO', 'SERVICOS', 'SERVICO',
  'BANCO', 'BRASIL', 'SICOOB', 'ITAU', 'BRADESCO', 'CAIXA', 'PIX', 'TED', 'DOC',
  'ENVIADO', 'ENV', 'EMIT', 'RECEBIDO', 'REC', 'PAGTO', 'PAGAMENTO', 'TRANSF',
]);

function tokensUteis(text: string): string[] {
  return normalizeExtratoMatchText(text)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Evita falso positivo (ex.: "REC" dentro de "RENDA" → IMPOSTO DE RENDA). */
function tokensHistoricoContaCombinam(ht: string, nt: string): boolean {
  if (ht === nt) return true;
  const shorter = ht.length <= nt.length ? ht : nt;
  const longer = ht.length <= nt.length ? nt : ht;
  if (shorter.length < 4) return false;
  return longer.includes(shorter);
}

function isHistoricoPixTedGenerico(hist: string, nature: 'D' | 'C'): boolean {
  const s = normalizeExtratoMatchText(hist);
  if (nature === 'D') {
    return /PIX\s*(EMIT|ENV|PAG|SAIDA)|PIXEMIT|TED\s+ENV|DOC\s+ENV|PAGAMENTO|BOLETO|SISPAG/.test(s);
  }
  return /PIX\s*REC|PIXRECEB|TED\s+REC|DOC\s+REC|RECEBIMENTO|DEPOSITO|CREDITO\s+PIX|CRED\s+PIX/.test(s);
}

function grupoConta(p: PlanoOptionLike): string {
  const g = String((p as { group?: string }).group ?? '').toUpperCase();
  if (g) return g;
  const code = String(p.code ?? '').replace(/\D/g, '');
  if (code.startsWith('1')) return 'ATIVO';
  if (code.startsWith('2')) return 'PASSIVO';
  if (code.startsWith('3')) return 'DESPESA';
  if (code.startsWith('4')) return 'RECEITA';
  return '';
}

function compactKey(text: string): string {
  return normalizeExtratoMatchText(text).replace(/\s+/g, '');
}

/** Score 0–100: quanto o nome da conta combina com o histórico do extrato. */
export function scorePlanoContaParaHistorico(
  historico: string,
  nature: 'D' | 'C',
  conta: PlanoOptionLike,
): number {
  const hist = normalizeExtratoMatchText(historico);
  const nome = normalizeExtratoMatchText(conta.name);
  if (!hist || !nome) return 0;

  const histCompact = compactKey(historico);
  const nomeCompact = compactKey(conta.name);
  if (histCompact.length >= 4 && nomeCompact.length >= 4) {
    if (histCompact.includes(nomeCompact) || nomeCompact.includes(histCompact)) {
      return 72;
    }
    const histLetters = historico.replace(/[^A-Za-z]/g, '').toUpperCase();
    const nomeLetters = conta.name.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (histLetters.length >= 4 && nomeLetters.length >= 4) {
      if (histLetters.includes(nomeLetters) || nomeLetters.includes(histLetters)) return 65;
    }
  }

  const histTokens = new Set(tokensUteis(hist));
  const nomeTokens = tokensUteis(nome);
  if (nomeTokens.length === 0) return 0;

  let matched = 0;
  for (const nt of nomeTokens) {
    for (const ht of histTokens) {
      if (tokensHistoricoContaCombinam(ht, nt)) {
        matched++;
        break;
      }
    }
  }

  let score = matched * 18;
  if (matched === nomeTokens.length && nomeTokens.length >= 2) score += 35;
  if (nome.includes(hist.slice(0, Math.min(12, hist.length)))) score += 25;
  if (hist.includes(nome.slice(0, Math.min(16, nome.length))) && nome.length >= 6) score += 30;

  const grupo = grupoConta(conta);
  if (/FORNEC|DUPLICATA\s+A\s+PAGAR/.test(nome) && nature === 'D') score += 12;
  if (/\bCLIENTE/.test(nome) && nature === 'C') score += 12;
  if (/TARIFA|CESTA|PACOTE/.test(nome) && /TARIFA|CESTA|PACOTE|MANUT/.test(hist)) score += 40;
  if (/RENDIMENTO|RECEITA\s+FINANCEIRA|JUROS/.test(nome) && /REND|JUROS|BB\s+RENDE|APLIC/.test(hist)) score += 40;
  if (/APLIC|CDB|RDB|INVEST/.test(nome) && /APLIC|CDB|RESGATE|BB\s+RENDE/.test(hist)) score += 35;
  if (/IMPOSTO|TRIBUTO|DARF|GPS|IRPJ|CSLL|PIS|COFINS|ISS|FGTS|INSS/.test(nome) &&
    /IMPOSTO|TRIBUTO|DARF|GPS|IRPJ|CSLL|PIS|COFINS|ISS|FGTS|INSS|RFB/.test(hist)) {
    if (impostoContaCompativelComHistorico(hist, nome)) score += 35;
    else if (isImpostoSemTipoIdentificavel(hist) && /FUNDO\s+FIXO/.test(nome)) score += 40;
  }
  if (/FOLHA|SALARIO|FERIAS|PROLABORE/.test(nome) && /FOLHA|SALARIO|FERIAS|PROLABORE/.test(hist)) score += 35;
  if (/COLIGAD|PARTES?\s+RELACIONAD|MUTUO|EMPREST/.test(nome) && /COLIGAD|MUTUO|EMPREST/.test(hist)) score += 25;
  if (/FUNDO\s+FIXO/.test(nome) && /FUNDO|FIXO/.test(hist)) score += 20;

  if (grupo === 'DESPESA' && nature === 'D' && /DESPESA|CUSTO|TARIFA|IMPOSTO/.test(nome)) score += 8;
  if (grupo === 'RECEITA' && nature === 'C' && /RECEITA|RENDIMENTO/.test(nome)) score += 8;

  if (isHistoricoPixTedGenerico(hist, nature)) {
    const contaGeral =
      (/\bCLIENTES?\b|DUPLICATA\s+A\s+RECEBER|CONTAS\s+A\s+RECEBER/.test(nome) && nature === 'C') ||
      (/\bFORNECEDOR|\bFORN\b|DUPLICATA\s+A\s+PAGAR/.test(nome) && nature === 'D');
    if (contaGeral) {
      score += 45;
    } else {
      score = Math.min(score, 15);
    }
  }

  return Math.min(100, score);
}

export function pickBestPlanoContasParaHistorico(
  historico: string,
  nature: 'D' | 'C',
  plano: PlanoOptionLike[],
  limit = 5,
): Array<{ reduzido: string; name: string; score: number }> {
  const hits: Array<{ reduzido: string; name: string; score: number }> = [];
  for (const p of plano) {
    const red = sanitizeCodigoReduzido(p.codigoReduzido) || sanitizeCodigoReduzido(p.code);
    if (!red) continue;
    const score = scorePlanoContaParaHistorico(historico, nature, p);
    if (score >= 28) hits.push({ reduzido: red, name: p.name, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** A conta sugerida pela IA faz sentido para o histórico? */
export function contaTemSentidoLogicoParaHistorico(
  historico: string,
  contaNome: string,
  nature: 'D' | 'C',
  planoHit?: PlanoOptionLike,
): boolean {
  const conta: PlanoOptionLike = planoHit ?? { code: '', name: contaNome };
  return scorePlanoContaParaHistorico(historico, nature, conta) >= 36;
}

/** Bloco de texto com candidatos por lançamento — guia a IA. */
export function buildContaCandidatosTextoParaIa(
  lancamentos: Array<{ description: string; nature: string }>,
  plano: PlanoOptionLike[],
): string {
  const lines: string[] = [
    '=== CANDIDATOS DE CONTA POR LANÇAMENTO (match nome/sentido no plano) ===',
    'PIX/TED/PAGAMENTO genérico → use SOMENTE conta GERAL (FORNECEDORES ou CLIENTES).',
    'Tarifa/imposto/folha/coligada → use conta específica quando o histórico identificar o tipo.',
  ];
  let count = 0;
  for (const row of lancamentos.slice(0, 60)) {
    const nature = row.nature === 'C' ? ('C' as const) : ('D' as const);
    const cands = pickBestPlanoContasParaHistorico(row.description, nature, plano, 4);
    if (!cands.length) continue;
    count++;
    lines.push(
      `· [${nature}] ${row.description.slice(0, 72)} → ${cands.map((c) => `reduzido ${c.reduzido} (${c.name})`).join(' | ')}`,
    );
  }
  if (count === 0) return '';
  return lines.join('\n').slice(0, 12_000);
}
