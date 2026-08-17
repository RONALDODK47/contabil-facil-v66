import { PARCELAMENTO_CAMPOS } from '../../lib/parcelamentoColunasExtract';

export type DataIngestionType =
  | 'loans'
  | 'installments'
  | 'apps'
  | 'extrato'
  | 'plano'
  | 'balancete'
  | 'folha'
  | 'fiscal';

export type OcrColunaCampoDef = {
  id: string;
  name: string;
  required?: boolean;
  color: string;
  borderColor: string;
  isIgnore?: boolean;
};

export type OcrColunasModuleConfig = {
  title: string;
  confirmLabel: string;
  campos: OcrColunaCampoDef[];
  dataColIds: string[];
  headerKeywords: string[];
  /** Extrato OCR: painel alterna quais colunas aparecem no mapeamento (não altera o OCR em si). */
  supportsValorModo?: boolean;
  /** Plano de contas (e similares): seletor DocTR / IA / Híbrido na extração. */
  supportsExtractEngine?: boolean;
  /** Tag padrão do modelo de layout (variant de PDF). */
  layoutTag?: string;
};

export type PdfIngestVariant = {
  id: string;
  label: string;
};

export const FOLHA_PDF_VARIANTS: PdfIngestVariant[] = [
  { id: 'folha', label: 'Folha / holerite' },
  { id: 'folha_impostos', label: 'Impostos da folha' },
  { id: 'folha_prolabore', label: 'Pró-labore' },
];

export const FISCAL_PDF_VARIANTS: PdfIngestVariant[] = [
  { id: 'fiscal_acumulador', label: 'Acumuladores' },
  { id: 'fiscal_impostos', label: 'Impostos' },
];

export function folhaVariantDescriptionPrefix(variantId: string): string {
  switch (variantId) {
    case 'folha_impostos':
      return '[IMPOSTOS FOLHA]';
    case 'folha_prolabore':
      return '[PROLABORE]';
    default:
      return '[FOLHA]';
  }
}

export function fiscalVariantDescriptionPrefix(variantId: string): string {
  switch (variantId) {
    case 'fiscal_impostos':
      return '[IMPOSTOS]';
    case 'fiscal_acumulador':
      return '[ACUMULADOR]';
    default:
      return '[FISCAL]';
  }
}

const IGNORAR_CAMPOS: OcrColunaCampoDef[] = [
  {
    id: 'ignorar1',
    name: 'Ignorar coluna 1',
    color: 'bg-slate-600',
    borderColor: 'border-slate-400 border-dashed',
    isIgnore: true,
  },
  {
    id: 'ignorar2',
    name: 'Ignorar coluna 2',
    color: 'bg-slate-600',
    borderColor: 'border-slate-400 border-dashed',
    isIgnore: true,
  },
  {
    id: 'ignorar3',
    name: 'Ignorar coluna 3',
    color: 'bg-slate-600',
    borderColor: 'border-slate-400 border-dashed',
    isIgnore: true,
  },
];

const COMMON_HEADERS = [
  'empresa',
  'cliente',
  'contrato',
  'nome',
  'codigo',
  'data',
  'valor',
  'descricao',
  'total',
  'saldo',
  'principal',
  'vencimento',
];

const DC_CAMPOS: OcrColunaCampoDef[] = [
  { id: 'data', name: 'Data', color: 'bg-violet-500', borderColor: 'border-violet-500' },
  { id: 'descricao', name: 'Descrição / Histórico', color: 'bg-blue-500', borderColor: 'border-blue-500' },
  { id: 'debito', name: 'Débito (R$)', color: 'bg-red-500', borderColor: 'border-red-500' },
  { id: 'credito', name: 'Crédito (R$)', color: 'bg-emerald-600', borderColor: 'border-emerald-600' },
  { id: 'valorDc', name: 'Valor (D/C)', color: 'bg-orange-500', borderColor: 'border-orange-500' },
  ...IGNORAR_CAMPOS,
];

function folhaProfileConfig(profile?: string): OcrColunasModuleConfig {
  const tag = (profile || 'folha').trim() || 'folha';
  if (tag === 'folha_impostos') {
    return {
      title: 'Mapear colunas — impostos da folha',
      confirmLabel: 'Importar impostos da folha',
      layoutTag: tag,
      dataColIds: ['data', 'descricao', 'debito', 'credito', 'valorDc'],
      headerKeywords: [...COMMON_HEADERS, 'inss', 'fgts', 'irrf', 'imposto', 'debito', 'credito'],
      campos: DC_CAMPOS,
    };
  }
  if (tag === 'folha_prolabore') {
    return {
      title: 'Mapear colunas — pró-labore',
      confirmLabel: 'Importar pró-labore',
      layoutTag: tag,
      dataColIds: ['data', 'descricao', 'debito', 'credito', 'valorDc'],
      headerKeywords: [...COMMON_HEADERS, 'prolabore', 'pro-labore', 'socio', 'debito', 'credito'],
      campos: DC_CAMPOS,
    };
  }
  return {
    title: 'Mapear colunas — folha / relatório',
    confirmLabel: 'Importar lançamentos',
    layoutTag: 'folha',
    dataColIds: ['data', 'descricao', 'debito', 'credito', 'valorDc'],
    headerKeywords: [...COMMON_HEADERS, 'colaborador', 'salario', 'funcionario', 'debito', 'credito'],
    campos: DC_CAMPOS,
  };
}

const SALDO_CAMPOS: OcrColunaCampoDef[] = [
  { id: 'codigo', name: 'Código reduzido', color: 'bg-indigo-500', borderColor: 'border-indigo-500' },
  { id: 'classificacao', name: 'Classificação', color: 'bg-blue-500', borderColor: 'border-blue-500' },
  { id: 'descricao', name: 'Descrição', color: 'bg-emerald-500', borderColor: 'border-emerald-500' },
  { id: 'saldoAnterior', name: 'Saldo Anterior (D/C)', color: 'bg-cyan-600', borderColor: 'border-cyan-600' },
  { id: 'debito', name: 'Débito (R$)', color: 'bg-red-500', borderColor: 'border-red-500' },
  { id: 'credito', name: 'Crédito (R$)', color: 'bg-emerald-600', borderColor: 'border-emerald-600' },
  { id: 'valorDc', name: 'Saldo Atual (D/C)', color: 'bg-orange-500', borderColor: 'border-orange-500' },
  ...IGNORAR_CAMPOS,
];

function balanceteProfileConfig(profile?: string): OcrColunasModuleConfig {
  if (profile === 'balancete_saldo') {
    return {
      title: 'Mapear colunas — saldo por conta',
      confirmLabel: 'Importar saldos',
      layoutTag: 'balancete_saldo',
      dataColIds: ['codigo', 'classificacao', 'descricao', 'saldoAnterior', 'debito', 'credito', 'valorDc'],
      headerKeywords: [...COMMON_HEADERS, 'reduzido', 'classifica', 'saldo', 'anterior', 'debito', 'credito'],
      campos: SALDO_CAMPOS,
    };
  }
  return {
    title: 'Mapear colunas — razão / balancete',
    confirmLabel: 'Importar lançamentos',
    layoutTag: 'balancete',
    dataColIds: [
      'data',
      'descricao',
      'contaPartida',
      'contaContrapartida',
      'valorDc',
      'saldoPeriodo',
      'saldoExercicio',
    ],
    headerKeywords: [
      ...COMMON_HEADERS,
      'partida',
      'contrapartida',
      'classifica',
      'historico',
      'lancamento',
      'saldo',
      'exercicio',
    ],
    campos: [
      { id: 'data', name: 'Data', color: 'bg-violet-500', borderColor: 'border-violet-500' },
      { id: 'descricao', name: 'Descrição', color: 'bg-emerald-500', borderColor: 'border-emerald-500' },
      {
        id: 'contaPartida',
        name: 'Conta de partida',
        color: 'bg-cyan-500',
        borderColor: 'border-cyan-500',
      },
      {
        id: 'contaContrapartida',
        name: 'Conta de contrapartida',
        color: 'bg-blue-500',
        borderColor: 'border-blue-500',
      },
      {
        id: 'debito',
        name: 'Débito',
        color: 'bg-amber-500',
        borderColor: 'border-amber-500',
      },
      {
        id: 'credito',
        name: 'Crédito',
        color: 'bg-yellow-500',
        borderColor: 'border-yellow-500',
      },
      {
        id: 'valorDc',
        name: 'Valor',
        color: 'bg-orange-500',
        borderColor: 'border-orange-500',
      },
      {
        id: 'saldoPeriodo',
        name: 'Saldo do período',
        color: 'bg-red-500',
        borderColor: 'border-red-500',
      },
      {
        id: 'saldoExercicio',
        name: 'Saldo do exercício',
        color: 'bg-indigo-500',
        borderColor: 'border-indigo-500',
      },
      ...IGNORAR_CAMPOS,
    ],
  };
}

const ACUMULADOR_CAMPOS: OcrColunaCampoDef[] = [
  { id: 'data', name: 'Data', color: 'bg-violet-500', borderColor: 'border-violet-500' },
  { id: 'descricao', name: 'Descrição', color: 'bg-blue-500', borderColor: 'border-blue-500' },
  { id: 'acumulador', name: 'Acumulador (código)', color: 'bg-cyan-500', borderColor: 'border-cyan-500' },
  { id: 'debito', name: 'Débito (R$)', color: 'bg-red-500', borderColor: 'border-red-500' },
  { id: 'credito', name: 'Crédito (R$)', color: 'bg-emerald-600', borderColor: 'border-emerald-600' },
  { id: 'valorDc', name: 'Valor (D/C)', color: 'bg-orange-500', borderColor: 'border-orange-500' },
  ...IGNORAR_CAMPOS,
];

function fiscalProfileConfig(profile?: string): OcrColunasModuleConfig {
  const tag = (profile || 'fiscal_impostos').trim() || 'fiscal_impostos';
  if (tag === 'fiscal_acumulador') {
    return {
      title: 'Mapear colunas — acumuladores (entrada/saída/serviço)',
      confirmLabel: 'Importar acumuladores',
      layoutTag: tag,
      dataColIds: ['data', 'descricao', 'acumulador', 'debito', 'credito', 'valorDc'],
      headerKeywords: [...COMMON_HEADERS, 'acumulador', 'entrada', 'saida', 'servico', 'codigo'],
      campos: ACUMULADOR_CAMPOS,
    };
  }
  return {
    title: 'Mapear colunas — guias / impostos',
    confirmLabel: 'Importar impostos',
    layoutTag: 'fiscal_impostos',
    dataColIds: ['data', 'descricao', 'debito', 'credito', 'valorDc'],
    headerKeywords: [
      ...COMMON_HEADERS,
      'pis',
      'cofins',
      'icms',
      'irrf',
      'csll',
      'simples',
      'das',
      'imposto',
      'debito',
      'credito',
    ],
    campos: DC_CAMPOS,
  };
}

export function getOcrColunasConfig(
  dataType: DataIngestionType,
  profile?: string,
): OcrColunasModuleConfig {
  switch (dataType) {
    case 'loans':
      return {
        title: 'Mapear colunas — contratos',
        confirmLabel: 'Importar contratos',
        layoutTag: 'loans',
        dataColIds: [
          'empresa',
          'contrato',
          'tipo',
          'principal',
          'taxa',
          'parcelas',
          'dataInicio',
          'carencia',
          'tipoCarencia',
          'indexador',
          'iof',
          'custos',
        ],
        headerKeywords: COMMON_HEADERS,
        campos: [
          { id: 'empresa', name: 'Empresa', color: 'bg-blue-500', borderColor: 'border-blue-500' },
          { id: 'contrato', name: 'Contrato', color: 'bg-indigo-500', borderColor: 'border-indigo-500' },
          { id: 'tipo', name: 'Tipo (SAC/PRICE)', color: 'bg-violet-500', borderColor: 'border-violet-500' },
          { id: 'principal', name: 'Principal (R$)', color: 'bg-emerald-500', borderColor: 'border-emerald-500' },
          { id: 'taxa', name: 'Taxa (%)', color: 'bg-amber-500', borderColor: 'border-amber-500' },
          { id: 'parcelas', name: 'Parcelas', color: 'bg-cyan-500', borderColor: 'border-cyan-500' },
          { id: 'dataInicio', name: 'Data início', color: 'bg-teal-500', borderColor: 'border-teal-500' },
          { id: 'carencia', name: 'Carência (meses)', color: 'bg-orange-500', borderColor: 'border-orange-500' },
          { id: 'tipoCarencia', name: 'Tipo carência', color: 'bg-rose-500', borderColor: 'border-rose-500' },
          { id: 'indexador', name: 'Indexador', color: 'bg-lime-500', borderColor: 'border-lime-500' },
          { id: 'iof', name: 'IOF (R$)', color: 'bg-fuchsia-500', borderColor: 'border-fuchsia-500' },
          { id: 'custos', name: 'Custos (R$)', color: 'bg-pink-500', borderColor: 'border-pink-500' },
          ...IGNORAR_CAMPOS,
        ],
      };
    case 'installments':
      return {
        title: 'Mapear colunas — cronograma',
        confirmLabel: 'Importar cronograma',
        layoutTag: 'installments',
        dataColIds: ['numero', 'vencimento', 'valor', 'pagamento', 'juros', 'encargos', 'honorarios', 'multa'],
        headerKeywords: [
          ...COMMON_HEADERS,
          'parcela',
          'vencimento',
          'principal',
          'pagamento',
          'juros',
          'multa',
          'honorario',
          'encargo',
        ],
        campos: PARCELAMENTO_CAMPOS.map((campo) => ({
          id: campo.id,
          name: campo.name,
          required: campo.required,
          color: campo.color,
          borderColor: campo.borderColor,
          isIgnore: campo.id.startsWith('ignorar'),
        })),
      };
    case 'apps':
      return {
        title: 'Mapear colunas — aplicações',
        confirmLabel: 'Importar aplicações',
        layoutTag: 'apps',
        dataColIds: ['nomeAtivo', 'valorAplicado', 'taxa', 'indexador', 'dataAplicacao'],
        headerKeywords: [...COMMON_HEADERS, 'ativo', 'aplicacao', 'indexador'],
        campos: [
          { id: 'nomeAtivo', name: 'Nome do ativo', color: 'bg-blue-500', borderColor: 'border-blue-500' },
          { id: 'valorAplicado', name: 'Valor aplicado (R$)', color: 'bg-emerald-500', borderColor: 'border-emerald-500' },
          { id: 'taxa', name: 'Taxa (%)', color: 'bg-amber-500', borderColor: 'border-amber-500' },
          { id: 'indexador', name: 'Indexador', color: 'bg-violet-500', borderColor: 'border-violet-500' },
          { id: 'dataAplicacao', name: 'Data aplicação', color: 'bg-cyan-500', borderColor: 'border-cyan-500' },
          ...IGNORAR_CAMPOS,
        ],
      };
    case 'extrato':
      return {
        title: 'Leitor e recortador — extrato',
        confirmLabel: 'Colar extrato na tabela',
        supportsValorModo: true,
        layoutTag: 'extrato',
        dataColIds: [
          'data',
          'descricao',
          'valorCredito',
          'valorDebito',
          'valorMisto',
          'contaDebito',
          'contaCredito',
          'contaContabil',
          'historicoOperacao',
        ],
        headerKeywords: [...COMMON_HEADERS, 'natureza', 'conta', 'debito', 'credito', 'conciliado', 'operacao'],
        campos: [
          { id: 'data', name: 'Data', color: 'bg-cyan-500', borderColor: 'border-cyan-500' },
          { id: 'descricao', name: 'Descrição / Histórico', color: 'bg-blue-500', borderColor: 'border-blue-500' },
          { id: 'valorDebito', name: 'Valor débito (R$)', color: 'bg-red-500', borderColor: 'border-red-500' },
          { id: 'valorCredito', name: 'Valor crédito (R$)', color: 'bg-emerald-600', borderColor: 'border-emerald-600' },
          {
            id: 'valorMisto',
            name: 'Valor misto débito/crédito',
            color: 'bg-orange-500',
            borderColor: 'border-orange-500',
          },
          { id: 'contaDebito', name: 'Conta débito', color: 'bg-red-700', borderColor: 'border-red-700' },
          { id: 'contaCredito', name: 'Conta crédito', color: 'bg-emerald-700', borderColor: 'border-emerald-700' },
          { id: 'contaContabil', name: 'Conta contábil', color: 'bg-violet-500', borderColor: 'border-violet-500' },
          { id: 'historicoOperacao', name: 'Operação (TXT)', color: 'bg-indigo-500', borderColor: 'border-indigo-500' },
          ...IGNORAR_CAMPOS,
        ],
      };
    case 'plano':
      return {
        title: 'Mapear colunas — plano de contas',
        confirmLabel: 'Importar contas',
        supportsExtractEngine: true,
        layoutTag: 'plano',
        dataColIds: ['codigoReduzido', 'codigoClassificacao', 'descricao', 'tipo', 'nivel'],
        headerKeywords: [
          'classifica',
          'reduzido',
          'codigo',
          'descricao',
          'nome',
          'tipo',
          'nivel',
          'grau',
          'sintet',
          'analit',
          'plano de contas',
        ],
        campos: [
          {
            id: 'codigoReduzido',
            name: 'Código reduzido',
            color: 'bg-indigo-500',
            borderColor: 'border-indigo-500',
          },
          {
            id: 'codigoClassificacao',
            name: 'Código classificação',
            color: 'bg-blue-500',
            borderColor: 'border-blue-500',
          },
          {
            id: 'descricao',
            name: 'Descrição',
            color: 'bg-emerald-500',
            borderColor: 'border-emerald-500',
          },
          { id: 'tipo', name: 'Tipo (S/A)', color: 'bg-cyan-500', borderColor: 'border-cyan-500' },
          { id: 'nivel', name: 'Nível', color: 'bg-teal-500', borderColor: 'border-teal-500' },
          ...IGNORAR_CAMPOS,
        ],
      };
    case 'balancete':
      return balanceteProfileConfig(profile);
    case 'folha':
      return folhaProfileConfig(profile);
    case 'fiscal':
      return fiscalProfileConfig(profile);
  }
}
