/**
 * Taxonomia de rubricas da folha de pagamento
 * ---------------------------------------------------------------------------
 * O "Resumo da Folha" (Domínio) traz dezenas de rubricas com nomes diferentes que,
 * contabilmente, caem na MESMA conta. Ex.: SALARIO EMPREGADO, SALDO DE SALARIO HORAS,
 * SALDO DE SALARIO DIAS e HORAS NORMAIS são todos "salário". Sem agrupamento, o usuário
 * precisa cadastrar uma regra de débito/crédito para cada rubrica, competência após
 * competência.
 *
 * Este módulo classifica o nome da rubrica em um GRUPO contábil, para que uma única regra
 * cubra todas as variações de nome — inclusive as que ainda não apareceram.
 *
 * Regras de ouro respeitadas aqui:
 *
 * 1. Nem tudo que contém "SALARIO" é salário. SALARIO FAMILIA e SALARIO MATERNIDADE são
 *    reembolsados pelo INSS: o débito NÃO é despesa com pessoal, é INSS a recuperar. Por
 *    isso têm grupo próprio, avaliado ANTES do grupo de salário.
 * 2. Nem toda linha do relatório vira lançamento. "LIQUIDO RESCISAO", "LIQUIDO DA FOLHA" e
 *    as linhas de BASE (base INSS/FGTS/IRRF) são totalizadores — contabilizá-las duplicaria
 *    a folha. Esses grupos vêm com `contabiliza: false`.
 * 3. O nome da rubrica chega sujo do PDF: prefixo "995 - ", dígitos colados no fim
 *    ("GRATIFICACOES1", "SALARIO EMPREGADO 2"), pontuação solta ("SALARIO FAMILIA ."). A
 *    normalização abaixo remove esse ruído antes de casar os padrões.
 */

export type FolhaGrupoTipo = 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA';

export type FolhaGrupoId =
  // --- Proventos que compõem a remuneração (débito = despesa com pessoal) ---
  | 'SALARIO'
  | 'DSR'
  | 'HORAS_EXTRAS'
  | 'ADICIONAIS'
  | 'GRATIFICACAO'
  | 'PREMIOS'
  | 'COMISSOES'
  | 'FERIAS'
  | 'TERCO_FERIAS'
  | 'DECIMO_TERCEIRO'
  | 'AVISO_PREVIO'
  | 'PRO_LABORE'
  | 'ESTAGIO'
  | 'AUTONOMO'
  | 'BENEFICIOS_PROVENTO'
  // --- Verbas pagas na rescisão (crédito é rescisões a pagar) ---
  | 'RESCISAO_VERBAS'
  // --- Proventos com contrapartida própria (NÃO são despesa da empresa) ---
  | 'SALARIO_FAMILIA'
  | 'SALARIO_MATERNIDADE'
  // --- Descontos ---
  | 'INSS_SEGURADO'
  | 'INSS_FERIAS'
  | 'INSS_RESCISAO'
  | 'IRRF'
  | 'CONSIGNADO'
  | 'ADIANTAMENTO_SALARIO'
  | 'ADIANTAMENTO_FERIAS'
  | 'ADIANTAMENTO_13'
  | 'VALE_TRANSPORTE'
  | 'VALE_ALIMENTACAO'
  | 'PLANO_SAUDE'
  | 'PENSAO_ALIMENTICIA'
  | 'SINDICAL'
  | 'FALTAS_ATRASOS'
  | 'OUTROS_DESCONTOS'
  // --- Encargos informativos ---
  | 'FGTS'
  | 'INSS_PATRONAL'
  | 'PIS_FOLHA'
  // --- Transferência do líquido da rescisão (contabiliza) ---
  | 'LIQUIDO_RESCISAO'
  // --- Totalizadores: NÃO contabilizar ---
  | 'LIQUIDO'
  | 'BASE_CALCULO';

export interface FolhaGrupoDef {
  id: FolhaGrupoId;
  /** Rótulo exibido na tela de regras. */
  label: string;
  tipo: FolhaGrupoTipo;
  /**
   * `false` quando a rubrica é apenas um totalizador/base do relatório. Contabilizar essas
   * linhas duplica o valor da folha, então elas ficam de fora da geração de lançamentos.
   */
  contabiliza: boolean;
  /** Explicação curta mostrada como ajuda no cadastro da regra. */
  descricao: string;
  /** Sugestão de natureza da perna de débito, para orientar quem cadastra a regra. */
  sugestaoDebito: string;
  /** Sugestão de natureza da perna de crédito. */
  sugestaoCredito: string;
  /** Padrões de nome (já normalizados: sem acento, maiúsculo, sem dígitos de ruído). */
  patterns: RegExp[];
  /** Nomes reais vistos em relatórios — usados como exemplo na UI e nos testes. */
  exemplos: string[];
}

/**
 * Normaliza o nome da rubrica vindo do relatório/parser.
 *
 * Entrada típica: "995 - SALARIO FAMILIA .", "GRATIFICACOES1", "SALDO DE SALARIO HORAS2".
 * Saída:          "SALARIO FAMILIA", "GRATIFICACOES", "SALDO DE SALARIO HORAS".
 */
export function normalizeRubricaNome(raw: string): string {
  let t = String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();

  // Prefixo de código da rubrica: "995 - SALARIO FAMILIA"
  t = t.replace(/^\s*\d{1,6}\s*[-–—:]\s*/, '');
  // Sufixo de código quando o PDF cola a coluna "Rubrica" no fim do nome
  t = t.replace(/\s*\d{1,6}\s*$/, '');
  // Ruído de pontuação/asterisco do Domínio
  t = t.replace(/[*]/g, ' ').replace(/[.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Dígitos colados na última palavra ("GRATIFICACOES1", "REMUNERADO2")
  t = t.replace(/([A-Z])\d+\b/g, '$1');

  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Definições de grupo, na ORDEM DE AVALIAÇÃO (mais específico primeiro).
 *
 * A ordem é significativa: SALARIO_FAMILIA precede SALARIO, DECIMO_TERCEIRO precede FERIAS
 * e SALARIO, INSS_SEGURADO precede OUTROS_DESCONTOS. Mover uma entrada para cima ou para
 * baixo muda a classificação.
 */
export const FOLHA_GRUPOS: FolhaGrupoDef[] = [
  // -------------------------------------------------------------------------
  // Totalizadores — antes de tudo, para não serem capturados por "SALARIO"/"RESCISAO".
  // -------------------------------------------------------------------------
  {
    id: 'LIQUIDO_RESCISAO',
    label: 'Líquido da rescisão (transferência)',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao:
      'Líquido do empregado desligado, descontado da folha mensal para ser pago à parte. NÃO é totalizador: é ele que separa o "Folha Mensal" do "Rescisão" no Domínio. Debita salários a pagar e credita rescisões a pagar — sem esta regra, salários a pagar fecha acima do líquido real.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Rescisões a pagar',
    patterns: [/\bLIQUIDO\b.*\bRESCISAO\b/, /\bRESCISAO\b.*\bLIQUIDO\b/, /\bLIQUIDO\s+RESCISORIO\b/],
    exemplos: ['LIQUIDO RESCISAO'],
  },
  {
    id: 'LIQUIDO',
    label: 'Líquido da folha (totalizador)',
    tipo: 'DESCONTOS',
    contabiliza: false,
    descricao:
      'Total da folha já resultante dos proventos menos descontos. É totalizador do relatório — contabilizar duplicaria a folha. O líquido da RESCISÃO é outra coisa e tem histórico próprio.',
    sugestaoDebito: '—',
    sugestaoCredito: '—',
    patterns: [/\bLIQUIDO\b/, /\bNETO\s+A\s+PAGAR\b/, /\bVALOR\s+A\s+RECEBER\b/],
    exemplos: ['LIQUIDO DA FOLHA', 'LIQUIDO GERAL', 'LIQUIDO A PAGAR'],
  },
  {
    id: 'BASE_CALCULO',
    label: 'Bases de cálculo (informação, não contabiliza)',
    tipo: 'INFORMATIVA',
    contabiliza: false,
    descricao: 'Linhas de base de INSS/FGTS/IRRF. Servem de conferência, não geram lançamento.',
    sugestaoDebito: '—',
    sugestaoCredito: '—',
    patterns: [/^BASE\b/, /\bBASE\s+DE\s+CALCULO\b/, /\bSALARIO\s+CONTRIBUICAO\b/],
    exemplos: ['BASE INSS', 'BASE FGTS', 'BASE DE CALCULO IRRF'],
  },
  // -------------------------------------------------------------------------
  // Encargos com nome inconfundível — precisam vir antes de RESCISAO_VERBAS e FERIAS,
  // senão "FGTS DE RESCISAO" e "INSS FERIAS" cairiam no grupo errado.
  // -------------------------------------------------------------------------
  {
    id: 'FGTS',
    label: 'FGTS',
    tipo: 'INFORMATIVA',
    contabiliza: true,
    descricao:
      'FGTS do mês, sobre férias, 13º e rescisão. É encargo da empresa: despesa contra FGTS a recolher — não sai do salário do empregado.',
    sugestaoDebito: 'Despesa com FGTS',
    sugestaoCredito: 'FGTS a recolher',
    patterns: [/\bF\s*\.?\s*G\s*\.?\s*T\s*\.?\s*S\b/, /\bFGTS\b/, /\bFUNDO\s+DE\s+GARANTIA\b/],
    exemplos: ['F.G.T.S DO MES', 'FGTS FERIAS', 'FGTS 13o SALARIO RESCISAO', 'F.G.T.S DE RESCISAO'],
  },
  {
    id: 'PIS_FOLHA',
    label: 'PIS sobre a folha de pagamento',
    tipo: 'INFORMATIVA',
    contabiliza: true,
    descricao:
      'PIS de 1% sobre a folha, devido pelas entidades imunes e isentas. Vem do relatório "Apuração de Tributos Federais", é encargo da empresa e tem conta própria — não se confunde com o PIS sobre faturamento.',
    sugestaoDebito: 'Despesa com PIS sobre a folha',
    sugestaoCredito: 'PIS a recolher',
    patterns: [/\bPIS\b.*\bFOLHA\b/, /\bFOLHA\b.*\bPIS\b/, /\bPIS\s+SOBRE\s+A?\s*FOLHA\b/],
    exemplos: ['PIS Folha', 'PIS SOBRE FOLHA DE PAGAMENTO'],
  },
  {
    id: 'INSS_PATRONAL',
    label: 'INSS patronal / terceiros / RAT',
    tipo: 'INFORMATIVA',
    contabiliza: true,
    descricao:
      'Contribuição previdenciária a cargo da empresa (patronal, RAT/SAT e terceiros). Despesa contra INSS a recolher.',
    sugestaoDebito: 'Despesa com encargos sociais',
    sugestaoCredito: 'INSS a recolher',
    patterns: [
      /\bINSS\s+(EMPRESA|PATRONAL|EMPREGADOR)\b/,
      /\bINSS\b.*\bRAT\b/,
      /\bR\.?A\.?T\b/,
      /\bS\.?A\.?T\b/,
      /\bTERCEIROS\b/,
    ],
    exemplos: ['INSS EMPREGADOR', 'INSS PATRONAL', 'INSS Empresa e RAT Folha', 'RAT/SAT', 'TERCEIROS'],
  },
  {
    id: 'INSS_RESCISAO',
    label: 'INSS sobre rescisão',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao:
      'INSS retido nas verbas rescisórias, inclusive sobre o 13º da rescisão. Fica fora do INSS mensal porque a contrapartida é a rescisão a pagar, não salários a pagar.',
    sugestaoDebito: 'Rescisões a pagar',
    sugestaoCredito: 'INSS a recolher',
    patterns: [/\bINSS\b.*\bRESCISAO\b/, /\bRESCISAO\b.*\bINSS\b/],
    exemplos: ['INSS SOBRE RESCISAO', 'INSS 13 SAL RESCISAO'],
  },
  {
    id: 'INSS_FERIAS',
    label: 'INSS sobre férias',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao:
      'INSS retido sobre férias. Histórico próprio: a contrapartida é a conta de férias a pagar, e não a de salários.',
    sugestaoDebito: 'Férias a pagar',
    sugestaoCredito: 'INSS a recolher',
    patterns: [/\bINSS\b.*\bFERIAS\b/, /\bFERIAS\b.*\bINSS\b/],
    exemplos: ['INSS FERIAS', 'INSS DIFERENCA FERIAS'],
  },
  {
    id: 'INSS_SEGURADO',
    label: 'INSS retido do empregado (mensal)',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao:
      'Contribuição previdenciária descontada do trabalhador na folha mensal. O INSS de férias e o de rescisão têm históricos próprios, porque debitam contas diferentes.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'INSS a recolher',
    patterns: [/\bI\s*\.?\s*N\s*\.?\s*S\s*\.?\s*S\b/, /\bINSS\b/, /\bPREVIDENCIA\s+SOCIAL\b/],
    exemplos: ['I.N.S.S.', 'INSS FOLHA'],
  },
  {
    id: 'IRRF',
    label: 'IRRF retido',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao: 'Imposto de renda retido na fonte sobre a remuneração.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'IRRF a recolher',
    patterns: [/\bI\s*\.?\s*R\s*\.?\s*R\s*\.?\s*F\b/, /\bIRRF\b/, /\bIMPOSTO\s+DE\s+RENDA\b/, /\bI\s*R\s+SOBRE\b/],
    exemplos: ['I.R.R.F', 'IRRF FERIAS', 'IMPOSTO DE RENDA NA FONTE'],
  },
  // -------------------------------------------------------------------------
  // Adiantamentos — cada um baixa um ativo diferente, e precisam preceder FERIAS/13º,
  // que casariam com "ADIANTAMENTO DE FERIAS" pelo nome.
  // -------------------------------------------------------------------------
  {
    id: 'ADIANTAMENTO_FERIAS',
    label: 'Adiantamento de férias',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao:
      'Baixa do valor de férias pago antecipadamente. Cada tipo de adiantamento tem o seu próprio ativo, por isso não se junta com adiantamento de salário nem de 13º.',
    sugestaoDebito: 'Férias a pagar',
    sugestaoCredito: 'Adiantamento de férias (ativo)',
    patterns: [/\bADIANTAMENTO\b.*\bFERIAS\b/, /\bANTECIPACAO\b.*\bFERIAS\b/],
    exemplos: ['ADIANTAMENTO DE FERIAS'],
  },
  {
    id: 'ADIANTAMENTO_13',
    label: 'Adiantamento de 13º salário',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao:
      'Baixa da primeira parcela do 13º já paga. Ativo próprio, separado dos demais adiantamentos.',
    sugestaoDebito: '13º salário a pagar',
    sugestaoCredito: 'Adiantamento de 13º salário (ativo)',
    patterns: [
      /\bADIANTAMENTO\b.*\b13\b/,
      /\bADIANTAMENTO\b.*\bDECIMO\b/,
      /\b13\b.*\bADIANTAMENTO\b/,
      /\bPRIMEIRA\s+PARCELA\b.*\b13\b/,
    ],
    exemplos: ['ADIANTAMENTO 13 SALARIO', 'ADIANTAMENTO DECIMO TERCEIRO'],
  },
  {
    id: 'ADIANTAMENTO_SALARIO',
    label: 'Adiantamento de salário',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao:
      'Vale/adiantamento quinzenal de salário. Baixa o adiantamento a empregados registrado no ativo.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Adiantamento de salários (ativo)',
    patterns: [/\bADIANTAMENTO/, /\bVALE\s+SALARIO\b/, /\bANTECIPACAO\b/],
    exemplos: ['ADIANTAMENTO DE SALARIO', 'VALE SALARIO'],
  },
  // -------------------------------------------------------------------------
  // Consignado — nome próprio, sem risco de colisão.
  // -------------------------------------------------------------------------
  {
    id: 'CONSIGNADO',
    label: 'Empréstimo consignado',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao:
      'Desconto de empréstimo consignado repassado ao banco. Cada contrato aparece com um número diferente no nome — o grupo cobre todos.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Consignações a repassar',
    patterns: [
      /\bCRED\.?\s*TRAB\b/,
      /\bCONSIGNAD/,
      /\bDESC\.?\s*EMP\b/,
      /\bEMPRESTIMO\b/,
      /\bFINANCIAMENTO\b/,
    ],
    exemplos: ['DESC. EMP. CRED. TRAB N 000000105484445', 'EMPRESTIMO CONSIGNADO'],
  },
  // -------------------------------------------------------------------------
  // Verbas rescisórias — qualquer provento da rescisão, antes de 13º/férias/salário.
  // -------------------------------------------------------------------------
  {
    id: 'RESCISAO_VERBAS',
    label: 'Verbas rescisórias',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao:
      'Proventos pagos na rescisão — saldo de salário, 13º e férias da rescisão, aviso indenizado. O crédito é rescisões a pagar, NÃO salários a pagar: são obrigações de natureza e prazo diferentes.',
    sugestaoDebito: 'Despesa com rescisões / verbas rescisórias',
    sugestaoCredito: 'Rescisões a pagar',
    patterns: [/\bRESCISAO\b/, /\bRESCISORI/, /\bDEMISSAO\b/],
    exemplos: [
      '13 SALARIO INTEGRAL RESCISAO',
      '1/3 FERIAS PROPORCIONAIS RESCISAO',
      'SALDO DE SALARIO RESCISAO',
    ],
  },
  // -------------------------------------------------------------------------
  // Proventos com contrapartida própria — ANTES do grupo SALARIO.
  // -------------------------------------------------------------------------
  {
    id: 'SALARIO_FAMILIA',
    label: 'Salário-família',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao:
      'Benefício pago pela empresa e REEMBOLSADO pelo INSS. Não é despesa com pessoal: o débito é INSS a recuperar/compensar, não a conta de salários.',
    sugestaoDebito: 'INSS a recuperar / a compensar (ativo)',
    sugestaoCredito: 'Salários a pagar',
    patterns: [/\bSALARIO\s*FAMILIA\b/, /\bSAL\.?\s*FAMILIA\b/],
    exemplos: ['SALARIO FAMILIA .', 'SALARIO FAMILIA'],
  },
  {
    id: 'SALARIO_MATERNIDADE',
    label: 'Salário-maternidade',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao:
      'Pago pela empresa e compensado com o INSS. Mesma lógica do salário-família: débito em INSS a recuperar.',
    sugestaoDebito: 'INSS a recuperar / a compensar (ativo)',
    sugestaoCredito: 'Salários a pagar',
    patterns: [/\bSALARIO\s*MATERNIDADE\b/, /\bLICENCA\s+MATERNIDADE\b/],
    exemplos: ['SALARIO MATERNIDADE', 'LICENCA MATERNIDADE'],
  },
  // -------------------------------------------------------------------------
  // 13º e férias — antes de SALARIO (os nomes contêm "SALARIO"/"FERIAS").
  // -------------------------------------------------------------------------
  {
    id: 'DECIMO_TERCEIRO',
    label: '13º salário',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao:
      'Gratificação natalina, em qualquer variação de nome (integral, proporcional, adiantamento, rescisão).',
    sugestaoDebito: 'Despesa com 13º salário',
    sugestaoCredito: '13º salário a pagar',
    patterns: [
      /\b13\s*[ºO°]?\s*SALARIO\b/,
      /\b13\s+SAL\b/,
      /\bDECIMO\s+TERCEIRO\b/,
      /\bGRATIFICACAO\s+NATALINA\b/,
      /\b13\s*[ºO°]?\b/,
    ],
    exemplos: ['13o SALARIO', 'DECIMO TERCEIRO PROPORCIONAL', '13 SALARIO INTEGRAL'],
  },
  {
    id: 'TERCO_FERIAS',
    label: '1/3 constitucional de férias',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao: 'Adicional de um terço sobre as férias. Costuma ter conta separada das férias.',
    sugestaoDebito: 'Despesa com férias (1/3 constitucional)',
    sugestaoCredito: 'Férias a pagar',
    patterns: [/\b1\s*\/\s*3\b/, /\bUM\s+TERCO\b/, /\bTERCO\s+CONSTITUCIONAL\b/, /\bABONO\s+CONSTITUCIONAL\b/],
    exemplos: ['1/3 DAS FERIAS', '1/3 FERIAS PROPORCIONAIS'],
  },
  {
    id: 'FERIAS',
    label: 'Férias',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao:
      'Férias em todas as variações: gozadas, proporcionais, horas de férias, médias incorporadas e abono pecuniário.',
    sugestaoDebito: 'Despesa com férias',
    sugestaoCredito: 'Férias a pagar',
    patterns: [/\bFERIAS\b/, /\bABONO\s+PECUNIARIO\b/],
    exemplos: [
      'HORAS FERIAS',
      'FERIAS PROPORCIONAIS',
      'MEDIA VALOR FERIAS',
      'MEDIA HORAS FERIAS',
    ],
  },
  // -------------------------------------------------------------------------
  // Demais proventos.
  // -------------------------------------------------------------------------
  {
    id: 'AVISO_PREVIO',
    label: 'Aviso prévio',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao: 'Aviso prévio indenizado ou trabalhado.',
    sugestaoDebito: 'Despesa com aviso prévio',
    sugestaoCredito: 'Salários a pagar',
    patterns: [/\bAVISO\s+PREVIO\b/, /\bAVISO\s+INDENIZADO\b/],
    exemplos: ['AVISO PREVIO INDENIZADO', 'AVISO PREVIO TRABALHADO'],
  },
  {
    id: 'PRO_LABORE',
    label: 'Pró-labore',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao: 'Remuneração de sócios e administradores — conta separada da folha de empregados.',
    sugestaoDebito: 'Despesa com pró-labore',
    sugestaoCredito: 'Pró-labore a pagar',
    patterns: [/\bPRO\s*-?\s*LABORE\b/, /\bPROLABORE\b/],
    exemplos: ['PRO-LABORE DIAS', 'PRO LABORE'],
  },
  {
    id: 'ESTAGIO',
    label: 'Estagiários',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao: 'Bolsa-auxílio de estágio — não é salário e não integra encargos.',
    sugestaoDebito: 'Despesa com estagiários',
    sugestaoCredito: 'Bolsa de estágio a pagar',
    patterns: [/\bESTAGI/, /\bBOLSA\s+AUXILIO\b/],
    exemplos: ['BOLSA ESTAGIO', 'ESTAGIARIO'],
  },
  {
    id: 'AUTONOMO',
    label: 'Autônomos / contribuintes individuais',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao: 'Serviços de autônomos lançados na folha (RPA).',
    sugestaoDebito: 'Despesa com serviços de terceiros',
    sugestaoCredito: 'Autônomos a pagar',
    patterns: [/\bAUTONOMO/, /\bCONTRIBUINTE\s+INDIVIDUAL\b/, /\bR\.?P\.?A\b/],
    exemplos: ['AUTONOMOS', 'CONTRIBUINTE INDIVIDUAL'],
  },
  {
    id: 'DSR',
    label: 'DSR — descanso semanal remunerado',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao: 'Repouso semanal remunerado, inclusive DSR sobre horas extras e comissões.',
    sugestaoDebito: 'Despesa com salários (DSR)',
    sugestaoCredito: 'Salários a pagar',
    patterns: [/\bDESCANSO\s+SEMANAL\b/, /\bREPOUSO\s+SEMANAL\b/, /\bD\s*S\s*R\b/],
    exemplos: ['DESCANSO SEMANAL REMUNERADO', 'DSR SOBRE HORAS EXTRAS'],
  },
  {
    id: 'HORAS_EXTRAS',
    label: 'Horas extras',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao: 'Horas extras em qualquer percentual, incluindo médias de horas extras.',
    sugestaoDebito: 'Despesa com horas extras',
    sugestaoCredito: 'Salários a pagar',
    patterns: [/\bHORA?S?\s+EXTRA/, /\bH\.?\s*E\.?\s*\d{1,3}\s*%/, /\bEXTRAORDINARIA/],
    exemplos: ['HORAS EXTRAS 50%', 'HORA EXTRA 100%', 'MEDIA HORAS EXTRAS'],
  },
  {
    id: 'ADICIONAIS',
    label: 'Adicionais (noturno, insalubridade, periculosidade)',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao: 'Adicionais legais sobre a remuneração e adicional por tempo de serviço.',
    sugestaoDebito: 'Despesa com adicionais',
    sugestaoCredito: 'Salários a pagar',
    patterns: [
      /\bADICIONAL\s+NOTURNO\b/,
      /\bINSALUBRIDADE\b/,
      /\bPERICULOSIDADE\b/,
      /\bANUENIO\b/,
      /\bQUINQUENIO\b/,
      /\bTRIENIO\b/,
      /\bADICIONAL\s+DE\s+TEMPO\b/,
    ],
    exemplos: ['ADICIONAL NOTURNO', 'INSALUBRIDADE 20%', 'PERICULOSIDADE'],
  },
  {
    id: 'PREMIOS',
    label: 'Prêmios e bonificações',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao:
      'Prêmios, bônus e produtividade. Vão para a mesma conta de despesa das gratificações, e não para despesa com salários.',
    sugestaoDebito: 'Despesa com prêmios e gratificações',
    sugestaoCredito: 'Salários a pagar',
    patterns: [/\bPREMIO/, /\bPREMIACAO\b/, /\bBONUS\b/, /\bBONIFICACAO/, /\bPRODUTIVIDADE\b/],
    exemplos: ['PREMIO PRODUCAO', 'BONUS', 'PREMIO ASSIDUIDADE'],
  },
  {
    id: 'COMISSOES',
    label: 'Comissões',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao: 'Remuneração variável por produção, comissão ou premiação.',
    sugestaoDebito: 'Despesa com comissões',
    sugestaoCredito: 'Salários a pagar',
    patterns: [/\bCOMISSAO/, /\bCOMISSOES\b/, /\bPRODUCAO\b/],
    exemplos: ['COMISSOES', 'COMISSAO SOBRE VENDAS'],
  },
  {
    id: 'GRATIFICACAO',
    label: 'Gratificações e abonos',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao:
      'Gratificações de qualquer natureza (função, caixa, livre) e abonos que integram a remuneração.',
    sugestaoDebito: 'Despesa com prêmios e gratificações',
    sugestaoCredito: 'Salários a pagar',
    patterns: [/\bGRATIFICAC/, /\bGRATIFICACOES\b/, /\bABONO\b/],
    exemplos: ['GRATIFICACOES', 'GRATIFICACAO', 'GRATIFICACAO DE FUNCAO', 'GRATIFICACAO DE CAIXA'],
  },
  {
    id: 'BENEFICIOS_PROVENTO',
    label: 'Benefícios pagos em folha',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao: 'Auxílios e ajudas de custo lançados como provento (não confundir com o desconto).',
    sugestaoDebito: 'Despesa com benefícios',
    sugestaoCredito: 'Salários a pagar',
    patterns: [/\bAUXILIO\b/, /\bAJUDA\s+DE\s+CUSTO\b/, /\bDIARIAS?\b/, /\bCESTA\s+BASICA\b/],
    exemplos: ['AUXILIO CRECHE', 'AJUDA DE CUSTO', 'CESTA BASICA'],
  },
  {
    id: 'SALARIO',
    label: 'Salário / remuneração base',
    tipo: 'PROVENTOS',
    contabiliza: true,
    descricao:
      'Salário base em todas as variações de nome: por horas, por dias, saldo de salário, ordenado, horas normais.',
    sugestaoDebito: 'Despesa com salários',
    sugestaoCredito: 'Salários a pagar',
    patterns: [
      /\bSALARIO\b/,
      /\bSALDO\s+DE\s+SALARIO\b/,
      /\bORDENADO\b/,
      /\bHORAS\s+NORMAIS\b/,
      /\bDIAS\s+NORMAIS\b/,
      /\bREMUNERACAO\s+MENSAL\b/,
      /\bMENSALISTA\b/,
      /\bHORISTA\b/,
    ],
    exemplos: [
      'SALARIO EMPREGADO',
      'SALDO DE SALARIO HORAS',
      'SALDO DE SALARIO DIAS',
      'HORAS NORMAIS',
    ],
  },
  // -------------------------------------------------------------------------
  // Demais descontos.
  // -------------------------------------------------------------------------
  {
    id: 'VALE_TRANSPORTE',
    label: 'Vale-transporte (desconto)',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao: 'Parcela do vale-transporte descontada do empregado (até 6% do salário).',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Vale-transporte (recuperação de despesa)',
    patterns: [/\bVALE\s*-?\s*TRANSPORTE\b/, /\bV\.?\s*T\.?\b/, /\bPASSAGEM/],
    exemplos: ['VALE TRANSPORTE', 'DESCONTO V.T.'],
  },
  {
    id: 'VALE_ALIMENTACAO',
    label: 'Vale-alimentação / refeição (desconto)',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao: 'Parcela de alimentação/refeição descontada do empregado.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Vale-alimentação (recuperação de despesa)',
    patterns: [/\bVALE\s*-?\s*(ALIMENTACAO|REFEICAO)\b/, /\bV\.?\s*[AR]\.?\b/, /\bALIMENTACAO\b/, /\bREFEICAO\b/],
    exemplos: ['VALE ALIMENTACAO', 'VALE REFEICAO'],
  },
  {
    id: 'PLANO_SAUDE',
    label: 'Plano de saúde / odontológico',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao: 'Mensalidade e coparticipação de assistência médica ou odontológica.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Plano de saúde a repassar',
    patterns: [
      /\bPLANO\s+DE\s+SAUDE\b/,
      /\bASSIST\w*\s+MEDICA\b/,
      /\bODONTO/,
      /\bUNIMED\b/,
      /\bCOPARTICIPACAO\b/,
      /\bCONVENIO\s+MEDICO\b/,
    ],
    exemplos: ['PLANO DE SAUDE', 'COPARTICIPACAO UNIMED', 'ASSISTENCIA ODONTOLOGICA'],
  },
  {
    id: 'PENSAO_ALIMENTICIA',
    label: 'Pensão alimentícia',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao: 'Valor retido por determinação judicial e repassado ao beneficiário.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Pensão alimentícia a repassar',
    patterns: [/\bPENSAO\b/, /\bALIMENTICIA\b/, /\bALIMENTOS\s+JUDICI/],
    exemplos: ['PENSAO ALIMENTICIA'],
  },
  {
    id: 'SINDICAL',
    label: 'Contribuições sindicais',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao: 'Contribuição sindical, assistencial, confederativa ou mensalidade do sindicato.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Contribuição sindical a recolher',
    patterns: [/\bSINDIC/, /\bCONTRIB\w*\s+ASSISTENCIAL\b/, /\bCONFEDERATIVA\b/],
    exemplos: ['CONTRIBUICAO SINDICAL', 'MENSALIDADE SINDICAL'],
  },
  {
    id: 'FALTAS_ATRASOS',
    label: 'Faltas e atrasos',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao: 'Desconto por faltas, atrasos e o DSR correspondente.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Despesa com salários (redução)',
    patterns: [/\bFALTAS?\b/, /\bATRASOS?\b/, /\bAUSENCIA/],
    exemplos: ['FALTAS', 'DSR SOBRE FALTAS', 'ATRASOS'],
  },
  // -------------------------------------------------------------------------
  // Fallback de desconto — última posição.
  // -------------------------------------------------------------------------
  {
    id: 'OUTROS_DESCONTOS',
    label: 'Outros descontos',
    tipo: 'DESCONTOS',
    contabiliza: true,
    descricao: 'Descontos diversos sem grupo específico (mensalidades, seguros, danos, farmácia).',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Outras retenções a repassar',
    patterns: [/\bDESCONTO/, /\bSEGURO\s+DE\s+VIDA\b/, /\bFARMACIA\b/, /\bMENSALIDADE\b/],
    exemplos: ['DESCONTO FARMACIA', 'SEGURO DE VIDA'],
  },
];

const GRUPOS_POR_ID = new Map<FolhaGrupoId, FolhaGrupoDef>(FOLHA_GRUPOS.map((g) => [g.id, g]));

export function getFolhaGrupo(id: FolhaGrupoId): FolhaGrupoDef | undefined {
  return GRUPOS_POR_ID.get(id);
}

export function folhaGrupoLabel(id: FolhaGrupoId): string {
  return GRUPOS_POR_ID.get(id)?.label ?? id;
}

export interface FolhaClassificacao {
  grupo: FolhaGrupoDef;
  /** Nome já normalizado que produziu o casamento — útil para depurar regras. */
  nomeNormalizado: string;
}

/**
 * Classifica o nome/histórico de uma rubrica em um grupo contábil.
 *
 * `tipoRelatorio` é a seção do relatório (PROVENTOS/DESCONTOS/INFORMATIVA) quando conhecida.
 * Ela desempata nomes ambíguos: "FERIAS" na seção de DESCONTOS é adiantamento/INSS de férias,
 * não provento de férias. Quando o tipo é informado, grupos de tipo incompatível são
 * ignorados — exceto os totalizadores, que valem em qualquer seção.
 */
export function classificarRubricaFolha(
  nomeOuHistorico: string,
  tipoRelatorio?: FolhaGrupoTipo,
): FolhaClassificacao | null {
  const nome = normalizeRubricaNome(nomeOuHistorico);
  if (!nome) return null;

  for (const grupo of FOLHA_GRUPOS) {
    if (tipoRelatorio && grupo.contabiliza && grupo.tipo !== tipoRelatorio) continue;
    if (grupo.patterns.some((p) => p.test(nome))) {
      return { grupo, nomeNormalizado: nome };
    }
  }

  return null;
}

/** Atalho: só o id do grupo, ou `null`. */
export function classificarRubricaFolhaId(
  nomeOuHistorico: string,
  tipoRelatorio?: FolhaGrupoTipo,
): FolhaGrupoId | null {
  return classificarRubricaFolha(nomeOuHistorico, tipoRelatorio)?.grupo.id ?? null;
}

/** `true` quando a rubrica é um totalizador/base que não deve virar lançamento. */
export function rubricaContabiliza(nomeOuHistorico: string, tipoRelatorio?: FolhaGrupoTipo): boolean {
  const hit = classificarRubricaFolha(nomeOuHistorico, tipoRelatorio);
  return hit ? hit.grupo.contabiliza : true;
}

/**
 * Agrupa uma lista de rubricas por grupo contábil — alimenta a tela de regras, que passa a
 * oferecer "um histórico por grupo" em vez de uma linha por rubrica.
 */
export function agruparRubricasFolha(
  rubricas: Array<{ descricao: string; tipo?: FolhaGrupoTipo }>,
): Array<{ grupo: FolhaGrupoDef; rubricas: string[] }> {
  const mapa = new Map<FolhaGrupoId, { grupo: FolhaGrupoDef; rubricas: Set<string> }>();

  for (const item of rubricas) {
    const hit = classificarRubricaFolha(item.descricao, item.tipo);
    if (!hit) continue;
    const atual = mapa.get(hit.grupo.id);
    if (atual) atual.rubricas.add(item.descricao);
    else mapa.set(hit.grupo.id, { grupo: hit.grupo, rubricas: new Set([item.descricao]) });
  }

  return FOLHA_GRUPOS.filter((g) => mapa.has(g.id)).map((g) => ({
    grupo: g,
    rubricas: [...mapa.get(g.id)!.rubricas].sort(),
  }));
}

// ===========================================================================
// DESTINO CONTÁBIL — o agrupamento que o usuário realmente cadastra
// ===========================================================================
/**
 * Grupo de rubrica é *natureza*; destino contábil é *para onde o lançamento vai*.
 *
 * A contabilidade não distingue salário de DSR, de gratificação ou de hora extra: tudo debita
 * despesa com salários e credita salários a pagar. Se o sistema pedisse uma regra por grupo,
 * o usuário cadastraria quatro regras idênticas. O destino junta os grupos que caem no MESMO
 * par débito/crédito, de forma que cada destino vira UM ÚNICO histórico a cadastrar.
 *
 * O que separa um destino do outro é justamente ter contrapartida diferente: salário-família
 * é provento como o salário, mas o débito é INSS a recuperar — destino próprio. Faltas reduzem
 * a despesa em vez de aumentá-la (pernas invertidas) — destino próprio.
 */
export type FolhaDestinoId =
  | 'REMUNERACAO'
  | 'GRATIFICACOES_PREMIOS'
  | 'FALTAS'
  | 'FERIAS'
  | 'DECIMO_TERCEIRO'
  | 'BENEFICIO_INSS'
  | 'PRO_LABORE'
  | 'ESTAGIO'
  | 'AUTONOMO'
  | 'INSS_RETIDO'
  | 'INSS_FERIAS'
  | 'INSS_RESCISAO'
  | 'RESCISAO'
  | 'IRRF_RETIDO'
  | 'FGTS'
  | 'INSS_PATRONAL'
  | 'PIS_FOLHA'
  | 'CONSIGNADO'
  | 'ADIANTAMENTO_SALARIO'
  | 'ADIANTAMENTO_FERIAS'
  | 'ADIANTAMENTO_13'
  | 'RETENCOES_REPASSE'
  | 'LIQUIDO_RESCISAO'
  | 'NAO_CONTABILIZA';

export interface FolhaDestinoDef {
  id: FolhaDestinoId;
  /** Nome do histórico único que o usuário cadastra. */
  label: string;
  /** Por que estes grupos compartilham o mesmo par de contas. */
  descricao: string;
  sugestaoDebito: string;
  sugestaoCredito: string;
  /** Grupos de rubrica que caem neste destino. */
  grupos: FolhaGrupoId[];
  /** `false` para o destino dos totalizadores, que não geram lançamento. */
  contabiliza: boolean;
  /**
   * Quando preenchido, cada lançamento deste destino gera TAMBÉM um lançamento de
   * compensação, que zera a conta de débito daqui contra a conta de crédito do destino
   * apontado.
   *
   * É o caso do salário-família: a empresa paga ao empregado (D INSS a recuperar / C salários
   * a pagar) e depois abate o valor na guia (D INSS a recolher / C INSS a recuperar). Sem o
   * segundo lançamento, "INSS a recuperar" acumula saldo para sempre e o INSS a recolher fica
   * acima do que a Apuração de Tributos manda pagar.
   */
  compensaAutomaticamenteCom?: FolhaDestinoId;
}

export const FOLHA_DESTINOS: FolhaDestinoDef[] = [
  {
    id: 'REMUNERACAO',
    label: 'Salários e remuneração',
    descricao:
      'Tudo que compõe a remuneração normal e vai para a mesma dupla de contas: salário base, saldo de salário, DSR, horas extras, adicionais, comissões, aviso prévio e benefícios pagos em folha. Prêmios e gratificações NÃO entram aqui — têm conta de despesa própria.',
    sugestaoDebito: 'Despesa com salários',
    sugestaoCredito: 'Salários a pagar',
    grupos: [
      'SALARIO',
      'DSR',
      'HORAS_EXTRAS',
      'ADICIONAIS',
      'COMISSOES',
      'AVISO_PREVIO',
      'BENEFICIOS_PROVENTO',
    ],
    contabiliza: true,
  },
  {
    id: 'GRATIFICACOES_PREMIOS',
    label: 'Prêmios e gratificações',
    descricao:
      'Gratificações (de função, de caixa, livres), abonos, prêmios e bônus. O débito vai para a conta de despesa com prêmios e gratificações — e não para despesa com salários — por isso é um histórico separado da remuneração.',
    sugestaoDebito: 'Despesa com prêmios e gratificações',
    sugestaoCredito: 'Salários a pagar',
    grupos: ['GRATIFICACAO', 'PREMIOS'],
    contabiliza: true,
  },
  {
    id: 'FALTAS',
    label: 'Faltas e atrasos (redução da despesa)',
    descricao:
      'Desconto por falta ou atraso. Não entra em "Salários e remuneração" porque as pernas são invertidas: reduz a despesa em vez de aumentá-la.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Despesa com salários (redução)',
    grupos: ['FALTAS_ATRASOS'],
    contabiliza: true,
  },
  {
    id: 'FERIAS',
    label: 'Férias (com o 1/3)',
    descricao:
      'Férias e o terço constitucional, que costumam ter conta de despesa e provisão próprias. Se a empresa lança férias junto com o salário, aponte este destino para as mesmas contas da remuneração.',
    sugestaoDebito: 'Despesa com férias',
    sugestaoCredito: 'Férias a pagar',
    grupos: ['FERIAS', 'TERCO_FERIAS'],
    contabiliza: true,
  },
  {
    id: 'DECIMO_TERCEIRO',
    label: '13º salário',
    descricao: 'Gratificação natalina em qualquer variação — conta de despesa e provisão próprias.',
    sugestaoDebito: 'Despesa com 13º salário',
    sugestaoCredito: '13º salário a pagar',
    grupos: ['DECIMO_TERCEIRO'],
    contabiliza: true,
  },
  {
    id: 'BENEFICIO_INSS',
    label: 'Salário-família e maternidade (reembolso INSS)',
    descricao:
      'São proventos como o salário, MAS a empresa não arca com eles: o valor é compensado com o INSS. Por isso o débito é INSS a recuperar e não despesa com pessoal — esta é a exceção que não pode entrar no histórico de salários.',
    sugestaoDebito: 'INSS a recuperar / a compensar (ativo)',
    sugestaoCredito: 'Salários a pagar',
    grupos: ['SALARIO_FAMILIA', 'SALARIO_MATERNIDADE'],
    contabiliza: true,
    compensaAutomaticamenteCom: 'INSS_RETIDO',
  },
  {
    id: 'PRO_LABORE',
    label: 'Pró-labore',
    descricao: 'Remuneração de sócios — despesa e passivo separados da folha de empregados.',
    sugestaoDebito: 'Despesa com pró-labore',
    sugestaoCredito: 'Pró-labore a pagar',
    grupos: ['PRO_LABORE'],
    contabiliza: true,
  },
  {
    id: 'ESTAGIO',
    label: 'Estagiários',
    descricao: 'Bolsa-auxílio de estágio — não é salário e não gera encargos.',
    sugestaoDebito: 'Despesa com estagiários',
    sugestaoCredito: 'Bolsa de estágio a pagar',
    grupos: ['ESTAGIO'],
    contabiliza: true,
  },
  {
    id: 'AUTONOMO',
    label: 'Autônomos',
    descricao: 'Serviços de autônomos e contribuintes individuais lançados na folha.',
    sugestaoDebito: 'Despesa com serviços de terceiros',
    sugestaoCredito: 'Autônomos a pagar',
    grupos: ['AUTONOMO'],
    contabiliza: true,
  },
  {
    id: 'INSS_RETIDO',
    label: 'INSS retido do empregado (mensal)',
    descricao:
      'INSS descontado do trabalhador na folha mensal — debita salários a pagar. O INSS de férias e o de rescisão têm histórico próprio porque debitam outras contas.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'INSS a recolher',
    grupos: ['INSS_SEGURADO'],
    contabiliza: true,
  },
  {
    id: 'INSS_FERIAS',
    label: 'INSS sobre férias',
    descricao:
      'INSS retido sobre férias. Separado do INSS mensal porque a perna de débito é férias a pagar.',
    sugestaoDebito: 'Férias a pagar',
    sugestaoCredito: 'INSS a recolher',
    grupos: ['INSS_FERIAS'],
    contabiliza: true,
  },
  {
    id: 'INSS_RESCISAO',
    label: 'INSS sobre rescisão',
    descricao:
      'INSS retido nas verbas rescisórias, inclusive o do 13º da rescisão. Debita rescisões a pagar, não salários a pagar.',
    sugestaoDebito: 'Rescisões a pagar',
    sugestaoCredito: 'INSS a recolher',
    grupos: ['INSS_RESCISAO'],
    contabiliza: true,
  },
  {
    id: 'RESCISAO',
    label: 'Verbas rescisórias',
    descricao:
      'Proventos pagos na rescisão. A obrigação é rescisões a pagar, com natureza e prazo próprios — por isso não se mistura com salários a pagar.',
    sugestaoDebito: 'Despesa com rescisões / verbas rescisórias',
    sugestaoCredito: 'Rescisões a pagar',
    grupos: ['RESCISAO_VERBAS'],
    contabiliza: true,
  },
  {
    id: 'IRRF_RETIDO',
    label: 'IRRF retido',
    descricao: 'Imposto de renda retido na fonte, em qualquer base de cálculo.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'IRRF a recolher',
    grupos: ['IRRF'],
    contabiliza: true,
  },
  {
    id: 'FGTS',
    label: 'FGTS',
    descricao:
      'FGTS do mês, de férias, de 13º e de rescisão. É encargo da empresa (não sai do salário do empregado) e todas as variações vão para a mesma conta a recolher.',
    sugestaoDebito: 'Despesa com FGTS',
    sugestaoCredito: 'FGTS a recolher',
    grupos: ['FGTS'],
    contabiliza: true,
  },
  {
    id: 'INSS_PATRONAL',
    label: 'INSS patronal / RAT / terceiros',
    descricao:
      'Contribuição previdenciária a cargo da empresa, vinda do relatório de Apuração de Tributos Federais. É despesa da empresa, não sai do salário do empregado.',
    sugestaoDebito: 'Despesa com encargos sociais',
    sugestaoCredito: 'INSS a recolher',
    grupos: ['INSS_PATRONAL'],
    contabiliza: true,
  },
  {
    id: 'PIS_FOLHA',
    label: 'PIS sobre a folha',
    descricao:
      'PIS de 1% sobre a folha das entidades imunes e isentas. Conta de despesa e de recolhimento próprias, separadas do PIS sobre faturamento.',
    sugestaoDebito: 'Despesa com PIS sobre a folha',
    sugestaoCredito: 'PIS a recolher',
    grupos: ['PIS_FOLHA'],
    contabiliza: true,
  },
  {
    id: 'CONSIGNADO',
    label: 'Empréstimo consignado',
    descricao:
      'Desconto de consignado repassado ao banco. Cada contrato aparece com um número diferente no nome da rubrica — sem agrupar, seria uma regra nova a cada contrato novo.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Consignações a repassar',
    grupos: ['CONSIGNADO'],
    contabiliza: true,
  },
  {
    id: 'ADIANTAMENTO_SALARIO',
    label: 'Adiantamento de salário',
    descricao:
      'Vale/adiantamento quinzenal já pago. Baixa o adiantamento a empregados registrado no ativo — não é despesa nova.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Adiantamento de salários (ativo)',
    grupos: ['ADIANTAMENTO_SALARIO'],
    contabiliza: true,
  },
  {
    id: 'ADIANTAMENTO_FERIAS',
    label: 'Adiantamento de férias',
    descricao:
      'Baixa das férias pagas antecipadamente. Ativo e contrapartida próprios, separados do adiantamento de salário.',
    sugestaoDebito: 'Férias a pagar',
    sugestaoCredito: 'Adiantamento de férias (ativo)',
    grupos: ['ADIANTAMENTO_FERIAS'],
    contabiliza: true,
  },
  {
    id: 'ADIANTAMENTO_13',
    label: 'Adiantamento de 13º salário',
    descricao:
      'Baixa da primeira parcela do 13º já paga. Ativo próprio, separado dos demais adiantamentos.',
    sugestaoDebito: '13º salário a pagar',
    sugestaoCredito: 'Adiantamento de 13º salário (ativo)',
    grupos: ['ADIANTAMENTO_13'],
    contabiliza: true,
  },
  {
    id: 'RETENCOES_REPASSE',
    label: 'Retenções a repassar (VT, VA, saúde, pensão, sindicato)',
    descricao:
      'Descontos que a empresa retém do empregado e repassa a terceiros. Cobre o caso comum de conta de repasse única; se cada retenção tem conta própria, cadastre-as com regras por histórico.',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Retenções a repassar',
    grupos: [
      'VALE_TRANSPORTE',
      'VALE_ALIMENTACAO',
      'PLANO_SAUDE',
      'PENSAO_ALIMENTICIA',
      'SINDICAL',
      'OUTROS_DESCONTOS',
    ],
    contabiliza: true,
  },
  {
    id: 'LIQUIDO_RESCISAO',
    label: 'Líquido da rescisão (transferir para rescisões a pagar)',
    descricao:
      'Tira da folha mensal o líquido de quem foi desligado, que será pago à parte. É o lançamento que faz "Salários a pagar" fechar com o "Folha Mensal" do Domínio e "Rescisões a pagar" fechar com a linha "Rescisão".',
    sugestaoDebito: 'Salários a pagar',
    sugestaoCredito: 'Rescisões a pagar',
    grupos: ['LIQUIDO_RESCISAO'],
    contabiliza: true,
  },
  {
    id: 'NAO_CONTABILIZA',
    label: 'Totalizadores (não contabilizam)',
    descricao:
      'Líquido a pagar, líquido de rescisão e linhas de base. São resultado dos outros lançamentos — contabilizar duplicaria a folha.',
    sugestaoDebito: '—',
    sugestaoCredito: '—',
    grupos: ['LIQUIDO', 'BASE_CALCULO'],
    contabiliza: false,
  },
];

const DESTINO_POR_GRUPO = new Map<FolhaGrupoId, FolhaDestinoDef>();
for (const destino of FOLHA_DESTINOS) {
  for (const grupoId of destino.grupos) DESTINO_POR_GRUPO.set(grupoId, destino);
}

const DESTINO_POR_ID = new Map<FolhaDestinoId, FolhaDestinoDef>(FOLHA_DESTINOS.map((d) => [d.id, d]));

export function getFolhaDestino(id: FolhaDestinoId): FolhaDestinoDef | undefined {
  return DESTINO_POR_ID.get(id);
}

export function folhaDestinoLabel(id: FolhaDestinoId): string {
  return DESTINO_POR_ID.get(id)?.label ?? id;
}

/** Destino contábil de um grupo de rubrica. */
export function destinoDoGrupo(grupoId: FolhaGrupoId): FolhaDestinoDef | undefined {
  return DESTINO_POR_GRUPO.get(grupoId);
}

/**
 * Destinos para os quais uma rubrica é redirecionada quando o relatório é só de RESCISÃO.
 *
 * Nesse caso não importa o nome: "SALDO DE SALARIO HORAS" num Resumo de Rescisão é o saldo do
 * empregado desligado e credita rescisões a pagar, não salários a pagar. Encargos da empresa
 * (FGTS, INSS patronal) e retenções de terceiros seguem para as contas de sempre — a obrigação
 * é a mesma, mudou só a verba que a originou.
 */
const DESTINO_NA_RESCISAO: Partial<Record<FolhaDestinoId, FolhaDestinoId>> = {
  REMUNERACAO: 'RESCISAO',
  GRATIFICACOES_PREMIOS: 'RESCISAO',
  FERIAS: 'RESCISAO',
  DECIMO_TERCEIRO: 'RESCISAO',
  FALTAS: 'RESCISAO',
  INSS_RETIDO: 'INSS_RESCISAO',
  INSS_FERIAS: 'INSS_RESCISAO',
};

export interface FolhaClassificacaoOpcoes {
  /**
   * `true` quando o relatório de origem é exclusivamente de rescisão (cabeçalho
   * "Cálculo: Rescisão"). Redireciona as verbas para as contas de rescisão.
   */
  calculoRescisao?: boolean;
}

/** Classifica uma rubrica direto no destino contábil (histórico único a cadastrar). */
export function classificarRubricaDestino(
  nomeOuHistorico: string,
  tipoRelatorio?: FolhaGrupoTipo,
  opcoes?: FolhaClassificacaoOpcoes,
): FolhaDestinoDef | null {
  const grupoId = classificarRubricaFolhaId(nomeOuHistorico, tipoRelatorio);
  if (!grupoId) return null;

  const destino = DESTINO_POR_GRUPO.get(grupoId);
  if (!destino) return null;

  if (opcoes?.calculoRescisao) {
    const redirecionado = DESTINO_NA_RESCISAO[destino.id];
    if (redirecionado) return DESTINO_POR_ID.get(redirecionado) ?? destino;
  }

  return destino;
}

/**
 * Agrupa as rubricas da folha importada por DESTINO contábil — é esta lista que a tela de
 * regras oferece: um histórico por destino, e não um por rubrica.
 */
export function agruparRubricasPorDestino(
  rubricas: Array<{ descricao: string; tipo?: FolhaGrupoTipo }>,
): Array<{ destino: FolhaDestinoDef; grupos: FolhaGrupoDef[]; rubricas: string[] }> {
  const mapa = new Map<
    FolhaDestinoId,
    { destino: FolhaDestinoDef; grupos: Map<FolhaGrupoId, FolhaGrupoDef>; rubricas: Set<string> }
  >();

  for (const item of rubricas) {
    const hit = classificarRubricaFolha(item.descricao, item.tipo);
    if (!hit) continue;
    const destino = DESTINO_POR_GRUPO.get(hit.grupo.id);
    if (!destino) continue;
    let entrada = mapa.get(destino.id);
    if (!entrada) {
      entrada = { destino, grupos: new Map(), rubricas: new Set() };
      mapa.set(destino.id, entrada);
    }
    entrada.grupos.set(hit.grupo.id, hit.grupo);
    entrada.rubricas.add(item.descricao);
  }

  return FOLHA_DESTINOS.filter((d) => mapa.has(d.id)).map((d) => {
    const entrada = mapa.get(d.id)!;
    return {
      destino: d,
      grupos: [...entrada.grupos.values()],
      rubricas: [...entrada.rubricas].sort(),
    };
  });
}
