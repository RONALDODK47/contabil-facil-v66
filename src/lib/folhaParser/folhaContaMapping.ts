/**
 * Mapeamento de Contas Contábeis para Folha de Pagamento
 * 
 * Similar ao sistema de Fiscal, mas para rubricas de folha.
 * Permite mapear:
 * - Rubricas de PROVENTOS → Conta Contábil de Crédito
 * - Rubricas de DESCONTOS → Conta Contábil de Débito
 * - Rubricas INFORMATIVAS → Conta Contábil de Crédito
 * 
 * Estrutura de armazenamento:
 * {
 *   "empresa": {
 *     "1": "6101.01.01",  // SALARIO EMPREGADO → Despesa com Salários
 *     "812": "2.101.02",  // INSS FERIAS → Passivo INSS
 *     "996": "2.105.01"   // FGTS DO MES → Passivo FGTS
 *   }
 * }
 */

export type FolhaRubricaChave = string; // Código da rubrica (ex: "1", "812", "996")

export type FolhaContaMap = Partial<Record<FolhaRubricaChave, string>>; // Rubrica → Código de Conta

export type FolhaTipoRubrica = 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA';

export interface FolhaRegraMapping {
  rubrica: string;
  nomeRubrica: string;
  tipo: FolhaTipoRubrica;
  contaDebito?: string;
  contaCredito?: string;
  descricao?: string;
}

const STORAGE_KEY = 'folhaParser_conta_map_v1';

type PersistPayload = Record<string, FolhaContaMap>;

function normEmpresa(empresa: string): string {
  const v = empresa.trim().toLowerCase();
  return v || '__default__';
}

function readRaw(): PersistPayload {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as PersistPayload;
  } catch {
    return {};
  }
}

/**
 * Lê mapeamento de contas para uma empresa
 */
export function readFolhaContaMap(empresa: string): FolhaContaMap {
  const all = readRaw();
  return all[normEmpresa(empresa)] ?? {};
}

/**
 * Salva mapeamento de contas para uma empresa
 */
export function saveFolhaContaMap(empresa: string, map: FolhaContaMap): void {
  const all = readRaw();
  all[normEmpresa(empresa)] = map;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/**
 * Define o mapeamento para uma rubrica específica
 */
export function setFolhaRubricaConta(
  empresa: string,
  rubrica: string,
  conta: string,
): void {
  const map = readFolhaContaMap(empresa);
  map[rubrica] = conta;
  saveFolhaContaMap(empresa, map);
}

/**
 * Remove o mapeamento de uma rubrica
 */
export function removeFolhaRubricaConta(empresa: string, rubrica: string): void {
  const map = readFolhaContaMap(empresa);
  delete map[rubrica];
  saveFolhaContaMap(empresa, map);
}

/**
 * Obtém a conta mapeada para uma rubrica
 */
export function getFolhaRubricaConta(empresa: string, rubrica: string): string | undefined {
  const map = readFolhaContaMap(empresa);
  return map[rubrica];
}

/**
 * Detecta tipo de rubrica baseado em padrões comuns
 */
export function detectFolhaRubricaTipo(
  nomeRubrica: string,
): FolhaTipoRubrica | null {
  const n = nomeRubrica.toUpperCase();

  // Palavras-chave de PROVENTOS
  if (/SALARIO|HORA|BONUS|GRATIFICACAO|COMISSAO|VANTAGEM|13.SALARIO|PRO.LABORE/i.test(n)) {
    return 'PROVENTOS';
  }

  // Palavras-chave de DESCONTOS
  if (/INSS|IRRF|FALTAS|DESCONTOS|VALE|ADIANTAMENTO|PENSION|SUSTENTO/i.test(n)) {
    return 'DESCONTOS';
  }

  // Palavras-chave de INFORMATIVA (valores não deduzidos do salário)
  if (/FGTS|AVISO|RESCISAO|PROVISAO|INFORMA/i.test(n)) {
    return 'INFORMATIVA';
  }

  return null;
}

/**
 * Mapeamento padrão de rubricas para contas (recomendações)
 * Esses valores servem como sugestão inicial
 */
export const FOLHA_REGRAS_PADRAO: FolhaRegraMapping[] = [
  // PROVENTOS (Despesas/Crédito)
  {
    rubrica: '1',
    nomeRubrica: 'SALARIO EMPREGADO',
    tipo: 'PROVENTOS',
    contaCredito: '6101.01.01', // Despesa com Salários
    descricao: 'Salário mensal do empregado',
  },
  {
    rubrica: '3',
    nomeRubrica: 'HORAS FERIAS',
    tipo: 'PROVENTOS',
    contaCredito: '6101.01.02', // Férias
    descricao: 'Horas de férias',
  },
  {
    rubrica: '9380',
    nomeRubrica: 'PRO-LABORE DIAS',
    tipo: 'PROVENTOS',
    contaCredito: '6101.02.01', // Pro-labore
    descricao: 'Remuneração de sócios',
  },
  {
    rubrica: '242',
    nomeRubrica: 'GRATIFICAÇÃO DE CAIXA',
    tipo: 'PROVENTOS',
    contaCredito: '6101.01.03', // Gratificações
    descricao: 'Gratificação de caixa',
  },

  // DESCONTOS (Passivos/Débito)
  {
    rubrica: '812',
    nomeRubrica: 'INSS FERIAS1',
    tipo: 'DESCONTOS',
    contaDebito: '2101.02.01', // Passivo INSS
    descricao: 'INSS sobre férias',
  },
  {
    rubrica: '843',
    nomeRubrica: 'INSS EMPREGADOR',
    tipo: 'DESCONTOS',
    contaDebito: '2101.02.01', // Passivo INSS (contribuição patronal)
    descricao: 'INSS - contribuição patronal',
  },
  {
    rubrica: '937',
    nomeRubrica: 'ADIANTAMENTO DE FERIAS',
    tipo: 'DESCONTOS',
    contaDebito: '2201.01.01', // Adiantamento de férias
    descricao: 'Adiantamento de férias',
  },
  {
    rubrica: '998',
    nomeRubrica: 'I.N.S.S.',
    tipo: 'DESCONTOS',
    contaDebito: '2101.02.02', // INSS (retenção)
    descricao: 'INSS retido',
  },

  // INFORMATIVA (Provisões/Crédito)
  {
    rubrica: '813',
    nomeRubrica: 'FGTS FERIAS1',
    tipo: 'INFORMATIVA',
    contaCredito: '2105.01.01', // Passivo FGTS
    descricao: 'FGTS sobre férias',
  },
  {
    rubrica: '996',
    nomeRubrica: 'F.G.T.S DO MES',
    tipo: 'INFORMATIVA',
    contaCredito: '2105.01.01', // Passivo FGTS
    descricao: 'FGTS mensal',
  },
];

/**
 * Obtém regra padrão para uma rubrica
 */
export function getFolhaRegraPadrao(rubrica: string): FolhaRegraMapping | undefined {
  return FOLHA_REGRAS_PADRAO.find((r) => r.rubrica === rubrica);
}

/**
 * Lista todas as regras padrão de um tipo específico
 */
export function listarFolhaRegrasDoTipo(tipo: FolhaTipoRubrica): FolhaRegraMapping[] {
  return FOLHA_REGRAS_PADRAO.filter((r) => r.tipo === tipo);
}

/**
 * Label de tipo de rubrica
 */
export function folhaTipoLabel(tipo: FolhaTipoRubrica): string {
  const labels: Record<FolhaTipoRubrica, string> = {
    PROVENTOS: 'Proventos',
    DESCONTOS: 'Descontos',
    INFORMATIVA: 'Informativa',
  };
  return labels[tipo];
}

/**
 * Aplica mapeamento de contas a um lançamento
 */
export function aplicarMapeamentoFolha(
  lancamento: any, // FolhaLancamento from folhaPDFParser
  empresa: string,
): { contaDebito?: string; contaCredito?: string } {
  const mapped = getFolhaRubricaConta(empresa, lancamento.rubrica);

  if (mapped) {
    // Se há mapeamento customizado, usar
    return {
      contaDebito: lancamento.natureza === 'D' ? mapped : undefined,
      contaCredito: lancamento.natureza === 'C' ? mapped : undefined,
    };
  }

  // Caso contrário, tentar regra padrão
  const regra = getFolhaRegraPadrao(lancamento.rubrica);
  if (regra) {
    return {
      contaDebito: regra.contaDebito,
      contaCredito: regra.contaCredito,
    };
  }

  return {};
}
