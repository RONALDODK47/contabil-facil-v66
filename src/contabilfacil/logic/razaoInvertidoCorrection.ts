import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { listarContasInvertidas } from '../../extratoVision/utils/naturezaContabil';

/**
 * Regra de correção para contas invertidas: quando uma conta fica com saldo
 * invertido (natureza oposta ao esperado), todos os lançamentos que a deixam
 * invertida são transferidos para uma conta de contrapartida.
 */
export interface RazaoInvertidoCorrection {
  /** Identificador único */
  id: string;
  /** Código/classificação da conta que está invertida (ex.: "1.1.01.02") */
  contaInvertida: string;
  /** Nome da conta invertida (ex.: "Bancos") */
  nomeContaInvertida: string;
  /** Código/classificação da conta de contrapartida (ex.: "4.9.99") */
  contaContrapartida: string;
  /** Nome da conta de contrapartida */
  nomeContaContrapartida: string;
  /** Data de criação da regra */
  criadoEm: string;
  /** Se está ativa ou não */
  ativa: boolean;
}

export interface RazaoInvertidoCorrectionResult {
  /** Linhas de correção geradas */
  linhasCriadas: VisionBalanceteRow[];
  /** Quantidade de lançamentos movidos */
  lancamentosMovidos: number;
  /** Valor total movido */
  valorTotalMovido: number;
}

/**
 * Identifica qual linha está deixando a conta invertida (causando a inversão).
 * Retorna os lançamentos que, se removidos, fariam a conta voltar à natureza correta.
 */
function identificarLancamentosQueInvertem(
  contaCodigo: string,
  linhasContaInvertida: VisionBalanceteRow[],
  todasAsLinhas: VisionBalanceteRow[],
): VisionBalanceteRow[] {
  const linhasDoRazao = linhasContaInvertida.sort((a, b) => {
    const dataA = a.data || '0000-00-00';
    const dataB = b.data || '0000-00-00';
    if (dataA !== dataB) return dataA.localeCompare(dataB);
    return (a.ordem ?? 0) - (b.ordem ?? 0);
  });

  let saldoAcumulado = linhasDoRazao[0]?.saldoInicial ?? 0;
  const inversoras: VisionBalanceteRow[] = [];

  // Determina a natureza esperada pela classificação
  const classificacao = linhasDoRazao[0]?.classificacao || contaCodigo;
  const primeiroDigito = parseInt(classificacao.charAt(0), 10);
  const naturezaEsperada = primeiroDigito >= 1 && primeiroDigito <= 3 ? 'D' : 'C';

  // Percorre cronologicamente os lançamentos
  for (const linha of linhasDoRazao) {
    const debito = linha.debito ?? 0;
    const credito = linha.credito ?? 0;

    // Calcula saldo com natureza considerada
    saldoAcumulado = saldoAcumulado + debito - credito;

    // Verifica se o saldo acumulado tem natureza oposta à esperada
    const saldoTemNaturezaInvertida = naturezaEsperada === 'D' ? saldoAcumulado < 0 : saldoAcumulado > 0;

    // Apenas lançamentos de natureza oposta à da conta podem ser considerados inversores
    const ownNat: 'D' | 'C' | null = debito > credito ? 'D' : credito > debito ? 'C' : null;
    const ownNatInvertida = ownNat !== null && ownNat !== naturezaEsperada;

    if (saldoTemNaturezaInvertida && ownNatInvertida && !inversoras.includes(linha)) {
      inversoras.push(linha);
    }
  }

  return inversoras.slice(0, 5); // Limita a 5 lançamentos para não gerar correções enormes
}

/**
 * Gera linhas de correção: move lançamentos que deixam a conta invertida
 * para a conta de contrapartida configurada.
 */
export function gerarLinhasCorrecaoRazaoInvertido(
  contaInvertidaCodigo: string,
  contaContrapartidaCodigo: string,
  contaContrapartidaNome: string,
  allRazaoRows: VisionBalanceteRow[],
): RazaoInvertidoCorrectionResult {
  // Filtra linhas da conta invertida usando comparação exata com hierarquia
  const linhasInvertidas = allRazaoRows.filter((r) => {
    const rCodigo = (r.codigo || '').trim();
    const rCls = (r.classificacao || '').trim();
    const contaInvClean = contaInvertidaCodigo.trim();

    return rCodigo === contaInvClean ||
           rCls === contaInvClean ||
           rCls.startsWith(contaInvClean + '.');
  });

  if (linhasInvertidas.length === 0) {
    return { linhasCriadas: [], lancamentosMovidos: 0, valorTotalMovido: 0 };
  }

  const lancamentosQueInvertem = identificarLancamentosQueInvertem(
    contaInvertidaCodigo,
    linhasInvertidas,
    allRazaoRows,
  );

  let ordem = Math.max(...allRazaoRows.map((r) => r.ordem ?? 0)) + 1;
  let valorTotalMovido = 0;
  const linhasCriadas: VisionBalanceteRow[] = [];

  for (const lancamento of lancamentosQueInvertem) {
    const debito = lancamento.debito ?? 0;
    const credito = lancamento.credito ?? 0;
    const valor = Math.max(debito, credito);

    if (valor <= 0) continue;

    valorTotalMovido += valor;

    // Linha de débito na conta de contrapartida (estorno do crédito original)
    if (credito > 0) {
      linhasCriadas.push({
        codigo: contaContrapartidaCodigo,
        classificacao: contaContrapartidaCodigo,
        nome: `CORREÇÃO RAZÃO INVERTIDO · Estorno de ${lancamento.nome || 'Movimento'}`,
        data: lancamento.data,
        ordem: ordem++,
        debito: credito,
        credito: 0,
        saldoInicial: 0,
        saldoFinal: 0,
        tipo: 'A',
      });
    }

    // Linha de crédito na conta de contrapartida (estorno do débito original)
    if (debito > 0) {
      linhasCriadas.push({
        codigo: contaContrapartidaCodigo,
        classificacao: contaContrapartidaCodigo,
        nome: `CORREÇÃO RAZÃO INVERTIDO · Estorno de ${lancamento.nome || 'Movimento'}`,
        data: lancamento.data,
        ordem: ordem++,
        debito: 0,
        credito: debito,
        saldoInicial: 0,
        saldoFinal: 0,
        tipo: 'A',
      });
    }
  }

  return {
    linhasCriadas,
    lancamentosMovidos: lancamentosQueInvertem.length,
    valorTotalMovido,
  };
}

/**
 * Aplica a correção ao razão: adiciona linhas geradas e marca as antigas como comentadas.
 */
export function aplicarCorrecaoRazaoInvertido(
  allRazaoRows: VisionBalanceteRow[],
  contaInvertidaCodigo: string,
  contaContrapartidaCodigo: string,
  contaContrapartidaNome: string,
): VisionBalanceteRow[] {
  const resultado = gerarLinhasCorrecaoRazaoInvertido(
    contaInvertidaCodigo,
    contaContrapartidaCodigo,
    contaContrapartidaNome,
    allRazaoRows,
  );

  if (resultado.linhasCriadas.length === 0) {
    return allRazaoRows;
  }

  // Retorna razão com as novas linhas de correção adicionadas
  return [...allRazaoRows, ...resultado.linhasCriadas];
}

/**
 * Lista todas as contas invertidas do razão atual.
 */
export function listarContasInvertidaskComDetalhes(
  allRazaoRows: VisionBalanceteRow[],
): Array<{
  codigo: string;
  classificacao: string;
  nome: string;
  saldoFinal: number;
  natureza: 'D' | 'C';
}> {
  const contasInvertidas = listarContasInvertidas(allRazaoRows);
  const resultado: Array<{
    codigo: string;
    classificacao: string;
    nome: string;
    saldoFinal: number;
    natureza: 'D' | 'C';
  }> = [];

  const seenKeys = new Set<string>();

  for (const linha of contasInvertidas) {
    const key = `${linha.classificacao || linha.codigo}|${linha.nome}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const saldoFinal = linha.saldoFinal ?? 0;
    const natureza = saldoFinal < 0 ? 'C' : 'D';

    resultado.push({
      codigo: linha.codigo || '',
      classificacao: linha.classificacao || linha.codigo || '',
      nome: linha.nome || 'SEM NOME',
      saldoFinal,
      natureza,
    });
  }

  return resultado;
}
