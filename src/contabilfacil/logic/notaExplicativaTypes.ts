export type NotaExplicativaAtividade =
  | 'comercio'
  | 'industria'
  | 'servicos'
  | 'rural'
  | 'agroindustria';

export type NotaExplicativaRegime =
  | 'simples_nacional'
  | 'lucro_presumido'
  | 'lucro_real'
  | 'imune'
  | 'isenta';

/** Modalidade de endividamento — cada uma aciona CPC(s) específico(s). */
export type NotaEndividamentoTipo =
  | 'emprestimo_bancario'
  | 'financiamento_bens'
  | 'financiamento_rural'
  | 'arrendamento_mercantil'
  | 'debentures'
  | 'mutuo_partes_relacionadas'
  | 'acc_ace_exportacao'
  | 'custos_emprestimos_ativo';

export type NotaExplicativaEmpresaDados = {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  exercicio: string;
  dataEncerramento: string;
  municipio: string;
  uf: string;
  atividades: NotaExplicativaAtividade[];
  regime: NotaExplicativaRegime;
  auditoriaIndependente: boolean;
  moedaFuncional: string;
  unidadeMedida: string;
  capitalSocial: string;
  /** Fundamento legal da imunidade ou isenção (artigo de lei, decreto, etc.). */
  fundamentoImunidadeIsencao: string;
  numeroEmpregados: string;
  receitaBrutaExercicio: string;
  patrimonioLiquido: string;
  /** Possui empréstimos bancários (passivo CP/LP). */
  possuiEmprestimos: boolean;
  /** Possui financiamentos (bens, rural, leasing etc.). */
  possuiFinanciamentos: boolean;
  /** Modalidades contratadas — define CPCs e texto da nota. */
  tiposEndividamento: NotaEndividamentoTipo[];
  saldoEmprestimosCP: string;
  saldoEmprestimosLP: string;
  saldoFinanciamentosCP: string;
  saldoFinanciamentosLP: string;
  endividamentoObservacoes: string;
};

export type NotaExplicativaCpcRef = {
  codigo: string;
  titulo: string;
  escopo: string;
};

export type NotaExplicativaSecaoTemplate = {
  id: string;
  ordem: number;
  titulo: string;
  cpcs: string[];
  aplicaQuando: (dados: NotaExplicativaEmpresaDados) => boolean;
  corpo: string;
};

export type NotaExplicativaSecaoGerada = {
  id: string;
  ordem: number;
  titulo: string;
  cpcs: NotaExplicativaCpcRef[];
  corpo: string;
};

export type NotaExplicativaProfile = {
  dados: NotaExplicativaEmpresaDados;
  overrides: Record<string, string>;
  updatedAt: string;
};

export const NOTA_ATIVIDADE_LABELS: Record<NotaExplicativaAtividade, string> = {
  comercio: 'Comércio (revenda de mercadorias)',
  industria: 'Indústria (fabricação / industrialização)',
  servicos: 'Prestação de serviços',
  rural: 'Atividade rural / agrícola',
  agroindustria: 'Agroindústria (rural + industrialização)',
};

export const NOTA_REGIME_LABELS: Record<NotaExplicativaRegime, string> = {
  simples_nacional: 'Simples Nacional',
  lucro_presumido: 'Lucro Presumido',
  lucro_real: 'Lucro Real',
  imune: 'Imune (imunidade constitucional)',
  isenta: 'Isenta (isenção legal)',
};

export function empresaEhImuneOuIsenta(dados: NotaExplicativaEmpresaDados): boolean {
  return dados.regime === 'imune' || dados.regime === 'isenta';
}

export const NOTA_ENDIVIDAMENTO_LABELS: Record<NotaEndividamentoTipo, string> = {
  emprestimo_bancario: 'Empréstimos bancários (CP / LP)',
  financiamento_bens: 'Financiamento de bens / máquinas / veículos',
  financiamento_rural: 'Financiamento rural / crédito agrícola',
  arrendamento_mercantil: 'Arrendamento mercantil / leasing (CPC 06)',
  debentures: 'Debêntures',
  mutuo_partes_relacionadas: 'Mútuo com partes relacionadas (CPC 05)',
  acc_ace_exportacao: 'ACC / ACE — financiamento à exportação',
  custos_emprestimos_ativo: 'Custos de empréstimos capitalizados em ativo (CPC 20)',
};

export function empresaTemEndividamento(dados: NotaExplicativaEmpresaDados): boolean {
  return (
    dados.possuiEmprestimos ||
    dados.possuiFinanciamentos ||
    (dados.tiposEndividamento?.length ?? 0) > 0
  );
}

export function defaultNotaExplicativaDados(razaoSocial = ''): NotaExplicativaEmpresaDados {
  const year = String(new Date().getFullYear());
  return {
    razaoSocial: razaoSocial.toUpperCase(),
    nomeFantasia: '',
    cnpj: '',
    exercicio: year,
    dataEncerramento: `31/12/${year}`,
    municipio: '',
    uf: '',
    atividades: ['servicos'],
    regime: 'simples_nacional',
    auditoriaIndependente: false,
    moedaFuncional: 'Real (BRL)',
    unidadeMedida: 'Unidade (R$)',
    capitalSocial: '',
    fundamentoImunidadeIsencao: '',
    numeroEmpregados: '',
    receitaBrutaExercicio: '',
    patrimonioLiquido: '',
    possuiEmprestimos: false,
    possuiFinanciamentos: false,
    tiposEndividamento: [],
    saldoEmprestimosCP: '',
    saldoEmprestimosLP: '',
    saldoFinanciamentosCP: '',
    saldoFinanciamentosLP: '',
    endividamentoObservacoes: '',
  };
}
