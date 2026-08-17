import type {
  NotaExplicativaAtividade,
  NotaExplicativaCpcRef,
  NotaExplicativaEmpresaDados,
  NotaEndividamentoTipo,
  NotaExplicativaRegime,
} from './notaExplicativaTypes';
import { empresaTemEndividamento } from './notaExplicativaTypes';

const CPC_CATALOGO: Record<string, Omit<NotaExplicativaCpcRef, 'codigo'>> = {
  'CPC 26': {
    titulo: 'Apresentação das Demonstrações Contábeis',
    escopo: 'Estrutura das DF, políticas, julgamentos e divulgações gerais.',
  },
  'CPC 03': {
    titulo: 'Demonstração dos Fluxos de Caixa',
    escopo: 'Método direto/indireto e classificação dos fluxos operacionais, de investimento e financiamento.',
  },
  'CPC 47': {
    titulo: 'Receita de Contrato com Cliente',
    escopo: 'Reconhecimento de receita de vendas de mercadorias e prestação de serviços.',
  },
  'CPC 16': {
    titulo: 'Estoques',
    escopo: 'Mensuração (custo ou valor realizável líquido), perdas e write-down.',
  },
  'CPC 48': {
    titulo: 'Instrumentos Financeiros',
    escopo:
      'Passivos financeiros ao custo amortizado, contas a receber, perda esperada de crédito e mensuração inicial/subsequente.',
  },
  'CPC 27': {
    titulo: 'Ativo Imobilizado',
    escopo: 'Depreciação, reavaliação, baixa e componentes significativos.',
  },
  'CPC 29': {
    titulo: 'Ativo Biológico e Atividade Agrícola',
    escopo: 'Mensuração de ativos biológicos, colheita e atividade agrícola.',
  },
  'CPC 32': {
    titulo: 'Tributos sobre o Lucro',
    escopo: 'IRPJ, CSLL, ativo e passivo tributários diferidos (lucro real).',
  },
  'CPC 33': {
    titulo: 'Benefícios a Empregados',
    escopo: 'Folha, férias, 13º, encargos e provisões trabalhistas.',
  },
  'CPC 06': {
    titulo: 'Operações de Arrendamento',
    escopo: 'Arrendamento mercantil / IFRS 16 — direito de uso, obrigação de arrendamento e divulgações.',
  },
  'CPC 05': {
    titulo: 'Divulgação de Partes Relacionadas',
    escopo: 'Transações e saldos com sócios, controladas, coligadas e demais partes relacionadas.',
  },
  'CPC 20': {
    titulo: 'Custos de Empréstimos',
    escopo: 'Capitalização de juros e encargos financeiros em ativos qualificados em elaboração.',
  },
  'CPC 15': {
    titulo: 'Combinação de Negócios',
    escopo: 'Aquisição de investidas e ágio por expectativa de rentabilidade futura.',
  },
  'ITG 2000': {
    titulo: 'Escrituração Contábil de Pequenas e Médias Empresas',
    escopo: 'Critérios simplificados de reconhecimento e mensuração para PMEs.',
  },
  'NBC TG 1000': {
    titulo: 'Contabilidade para PMEs',
    escopo: 'Conjunto reduzido de práticas para entidades de menor porte.',
  },
  'NBC TG 1001': {
    titulo: 'Contabilidade para Sociedades sem Fins Lucrativos',
    escopo:
      'Critérios de reconhecimento, mensuração e divulgação para entidades sem fins lucrativos, inclusive imunes e isentas.',
  },
  'Lei 6.404/76': {
    titulo: 'Lei das Sociedades por Ações',
    escopo: 'Obrigatoriedade e conteúdo mínimo das demonstrações e notas.',
  },
};

const CPC_POR_ATIVIDADE: Record<NotaExplicativaAtividade, string[]> = {
  comercio: ['CPC 16', 'CPC 47', 'CPC 48'],
  industria: ['CPC 16', 'CPC 27', 'CPC 47', 'CPC 48'],
  servicos: ['CPC 47', 'CPC 48'],
  rural: ['CPC 29', 'CPC 16', 'CPC 27'],
  agroindustria: ['CPC 29', 'CPC 16', 'CPC 27', 'CPC 47', 'CPC 48'],
};

const CPC_POR_REGIME: Record<NotaExplicativaRegime, string[]> = {
  simples_nacional: ['ITG 2000', 'NBC TG 1000'],
  lucro_presumido: ['CPC 32'],
  lucro_real: ['CPC 32'],
  imune: ['ITG 2000', 'NBC TG 1001'],
  isenta: ['ITG 2000', 'NBC TG 1001'],
};

const CPC_POR_ENDIVIDAMENTO: Record<NotaEndividamentoTipo, string[]> = {
  emprestimo_bancario: ['CPC 48', 'CPC 26'],
  financiamento_bens: ['CPC 48', 'CPC 27'],
  financiamento_rural: ['CPC 29', 'CPC 48'],
  arrendamento_mercantil: ['CPC 06'],
  debentures: ['CPC 48'],
  mutuo_partes_relacionadas: ['CPC 05', 'CPC 48'],
  acc_ace_exportacao: ['CPC 48'],
  custos_emprestimos_ativo: ['CPC 20'],
};

const CPC_BASE = ['Lei 6.404/76', 'CPC 26', 'CPC 03', 'CPC 33'];

export function resolveCpcsParaEmpresa(dados: NotaExplicativaEmpresaDados): NotaExplicativaCpcRef[] {
  const codes = new Set<string>(CPC_BASE);
  for (const atv of dados.atividades) {
    for (const c of CPC_POR_ATIVIDADE[atv] ?? []) codes.add(c);
  }
  for (const c of CPC_POR_REGIME[dados.regime] ?? []) codes.add(c);
  if (dados.auditoriaIndependente) codes.add('CPC 15');

  if (empresaTemEndividamento(dados)) {
    codes.add('CPC 48');
    codes.add('CPC 03');
    if (dados.possuiEmprestimos) {
      codes.add('CPC 26');
    }
    if (dados.possuiFinanciamentos) {
      codes.add('CPC 27');
    }
    for (const tipo of dados.tiposEndividamento ?? []) {
      for (const c of CPC_POR_ENDIVIDAMENTO[tipo] ?? []) codes.add(c);
    }
  }

  return Array.from(codes)
    .filter((c) => CPC_CATALOGO[c])
    .map((codigo) => ({ codigo, ...CPC_CATALOGO[codigo]! }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'));
}

export function empresaTemAtividade(
  dados: NotaExplicativaEmpresaDados,
  ...tipos: NotaExplicativaAtividade[]
): boolean {
  return tipos.some((t) => dados.atividades.includes(t));
}

export function cpcCatalogo(): NotaExplicativaCpcRef[] {
  return Object.entries(CPC_CATALOGO).map(([codigo, rest]) => ({ codigo, ...rest }));
}
