/**
 * Mapper de Folha de Pagamento para Lançamentos Contábeis
 * 
 * Converte:
 * - FolhaParserResult → VisionBalanceteRow (lançamentos contábeis)
 * - Aplica mapeamento de contas
 * - Valida dados
 * - Gera IDs únicos
 */

import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import type { FolhaParserResult, FolhaLancamento } from './folhaPDFParser';
import {
  aplicarMapeamentoFolha,
  getFolhaRegraPadrao,
} from './folhaContaMapping';

export interface FolhaLancamentoContabil {
  id: string;
  data: string; // DD/MM/YYYY
  historico: string;
  descricao: string;
  rubrica: string;
  nomeRubrica: string;
  tipo: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA';
  valor: number;
  natureza: 'D' | 'C';
  contaDebito?: string;
  contaCredito?: string;
  ordem: number;
}

/**
 * Gera ID único para lançamento
 */
function gerarIdLancamento(empresa: string, rubrica: string, data: string, index: number): string {
  return `folha-${empresa?.replace(/[^a-z0-9]/gi, '').toLowerCase()}-${rubrica}-${data.replace(/\D/g, '')}-${index}`;
}

/**
 * Converte FolhaLancamento para FolhaLancamentoContabil com dados contábeis
 */
export function mapFolhaLancamentoParaContabil(
  lance: FolhaLancamento,
  folhaResult: FolhaParserResult,
  empresa: string,
  ordem: number,
): FolhaLancamentoContabil {
  // Aplicar mapeamento de contas
  const contas = aplicarMapeamentoFolha(lance, empresa);

  // Construir histórico/descrição
  const historico = `${lance.rubrica} - ${lance.nomeRubrica}`;
  const descricao = lance.nomeRubrica;

  // Gerar ID
  const id = gerarIdLancamento(empresa, lance.rubrica, folhaResult.data, ordem);

  return {
    id,
    data: folhaResult.data,
    historico,
    descricao,
    rubrica: lance.rubrica,
    nomeRubrica: lance.nomeRubrica,
    tipo: lance.tipo,
    valor: lance.valor,
    natureza: lance.natureza,
    contaDebito: contas.contaDebito,
    contaCredito: contas.contaCredito,
    ordem,
  };
}

/**
 * Converte FolhaParserResult para array de VisionBalanceteRow (formato do sistema)
 */
export function mapFolhaParseResultParaVisionBalancete(
  folhaResult: FolhaParserResult,
  empresa: string,
): {
  items: VisionBalanceteRow[];
  erros: string[];
} {
  const items: VisionBalanceteRow[] = [];
  const erros: string[] = [];

  if (folhaResult.errors.length > 0) {
    erros.push(...folhaResult.errors);
  }

  folhaResult.lancements.forEach((lance, index) => {
    try {
      const contabil = mapFolhaLancamentoParaContabil(lance, folhaResult, empresa, index + 1);

      // Validações básicas
      if (!contabil.data) {
        erros.push(`Lançamento ${index + 1}: data inválida`);
        return;
      }

      if (contabil.valor <= 0) {
        erros.push(`Lançamento ${index + 1}: valor deve ser positivo`);
        return;
      }

      // Converter para VisionBalanceteRow
      const visionRow: VisionBalanceteRow = {
        codigo: contabil.contaDebito || contabil.contaCredito || `${contabil.rubrica}`,
        classificacao: contabil.contaDebito || contabil.contaCredito,
        nome: contabil.descricao,
        data: contabil.data,
        ordem: contabil.ordem,
        saldoInicial: 0,
        naturezaSaldoInicial: undefined,
        debito: contabil.natureza === 'D' ? contabil.valor : 0,
        credito: contabil.natureza === 'C' ? contabil.valor : 0,
        saldoFinal: contabil.natureza === 'D' ? -contabil.valor : contabil.valor,
        naturezaSaldoFinal: contabil.natureza,
        tipo: 'A', // Analítica
        nivel: 0,
        historico: contabil.historico,
        id: contabil.id,
        importId: contabil.id,
      };

      items.push(visionRow);
    } catch (err) {
      erros.push(
        `Erro ao processar lançamento ${index + 1}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  return { items, erros };
}

/**
 * Valida mapeamento de contas antes de gerar lançamentos
 */
export function validarMapeamentoFolha(lancements: FolhaLancamento[]): {
  valido: boolean;
  avisos: string[];
} {
  const avisos: string[] = [];

  for (const lance of lancements) {
    const regra = getFolhaRegraPadrao(lance.rubrica);

    if (!regra) {
      avisos.push(
        `Rubrica ${lance.rubrica} (${lance.nomeRubrica}) não possui mapeamento padrão. Será necessário configurar manualmente.`,
      );
    }
  }

  return {
    valido: avisos.length === 0,
    avisos,
  };
}

/**
 * Sumário de lançamentos para exibição
 */
export interface FolhaLancamentoSumario {
  totalProventos: number;
  totalDescontos: number;
  totalInformativa: number;
  totalDebito: number;
  totalCredito: number;
  qtdLancamentos: number;
  competencia: string;
}

export function gerarSumarioFolha(folhaResult: FolhaParserResult): FolhaLancamentoSumario {
  let totalProventos = 0;
  let totalDescontos = 0;
  let totalInformativa = 0;
  let totalDebito = 0;
  let totalCredito = 0;

  for (const lance of folhaResult.lancements) {
    if (lance.tipo === 'PROVENTOS') {
      totalProventos += lance.valor;
      totalCredito += lance.valor;
    } else if (lance.tipo === 'DESCONTOS') {
      totalDescontos += lance.valor;
      totalDebito += lance.valor;
    } else if (lance.tipo === 'INFORMATIVA') {
      totalInformativa += lance.valor;
      totalCredito += lance.valor;
    }
  }

  return {
    totalProventos,
    totalDescontos,
    totalInformativa,
    totalDebito,
    totalCredito,
    qtdLancamentos: folhaResult.lancements.length,
    competencia: folhaResult.competencia,
  };
}

/**
 * Exporta lançamentos em formato texto/CSV para visualização
 */
export function exportarFolhaCSV(folhaResult: FolhaParserResult, empresa: string): string {
  const linhas: string[] = [];

  // Cabeçalho
  linhas.push(
    [
      'Data',
      'Rubrica',
      'Nome da Rubrica',
      'Tipo',
      'Natureza',
      'Valor',
      'Conta Débito',
      'Conta Crédito',
      'Descrição',
    ].join(';'),
  );

  // Dados
  folhaResult.lancements.forEach((lance) => {
    const contas = aplicarMapeamentoFolha(lance, empresa);
    linhas.push(
      [
        folhaResult.data,
        lance.rubrica,
        lance.nomeRubrica,
        lance.tipo,
        lance.natureza,
        lance.valor.toString().replace('.', ','),
        contas.contaDebito || '',
        contas.contaCredito || '',
        `${lance.rubrica} - ${lance.nomeRubrica}`,
      ].join(';'),
    );
  });

  return linhas.join('\n');
}
