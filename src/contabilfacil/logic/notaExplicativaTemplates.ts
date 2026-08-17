import type { NotaExplicativaEmpresaDados, NotaExplicativaSecaoTemplate } from './notaExplicativaTypes';
import { empresaEhImuneOuIsenta, empresaTemEndividamento, NOTA_ENDIVIDAMENTO_LABELS } from './notaExplicativaTypes';
import { empresaTemAtividade } from './notaExplicativaCpc';

const sempre = () => true;

export const NOTA_EXPLICATIVA_SECOES: NotaExplicativaSecaoTemplate[] = [
  {
    id: 'introducao',
    ordem: 1,
    titulo: '1. Contexto da entidade e base legal',
    cpcs: ['Lei 6.404/76', 'CPC 26'],
    aplicaQuando: sempre,
    corpo: `As presentes notas explicativas integram as demonstrações contábeis de {{razaoSocial}}, inscrita no CNPJ {{cnpj}}, com sede em {{municipio}}/{{uf}}, referentes ao exercício findo em {{dataEncerramento}}.

As principais atividades econômicas da entidade são: {{atividadesLabel}}.

As demonstrações foram elaboradas em conformidade com a legislação societária brasileira (Lei nº 6.404/76) e com as normas expedidas pelo Conselho Federal de Contabilidade, em especial o CPC 26 (R1) — Apresentação das Demonstrações Contábeis.`,
  },
  {
    id: 'base_elaboracao',
    ordem: 2,
    titulo: '2. Base de elaboração e regime contábil',
    cpcs: ['CPC 26', 'ITG 2000'],
    aplicaQuando: sempre,
    corpo: `As demonstrações contábeis foram elaboradas com base no custo histórico, exceto quando outra base de mensuração for exigida pelas normas contábeis.

Moeda funcional e de apresentação: {{moedaFuncional}}. Unidade de medida: {{unidadeMedida}}.

Regime tributário de referência para divulgações fiscais: {{regimeLabel}}.

{{#auditoriaIndependente}}As demonstrações foram auditadas por auditor independente registrado na CVM/CRA, conforme NBC TA 700.{{/auditoriaIndependente}}
{{^auditoriaIndependente}}As demonstrações não foram objeto de auditoria independente.{{/auditoriaIndependente}}`,
  },
  {
    id: 'politicas',
    ordem: 3,
    titulo: '3. Principais políticas contábeis',
    cpcs: ['CPC 26'],
    aplicaQuando: sempre,
    corpo: `As principais políticas contábeis adotadas, alinhadas ao CPC 26, compreendem:

a) Reconhecimento de receitas e despesas pelo regime de competência;
b) Avaliação de investimentos, imobilizado e intangível conforme normas específicas;
c) Mensuração de passivos trabalhistas e tributários com base nas melhores estimativas disponíveis;
d) Apresentação comparativa das demonstrações, quando aplicável.

Atividades econômicas declaradas: {{atividadesLabel}}.`,
  },
  {
    id: 'caixa',
    ordem: 4,
    titulo: '4. Caixa e equivalentes de caixa',
    cpcs: ['CPC 03', 'CPC 26'],
    aplicaQuando: sempre,
    corpo: `Caixa e equivalentes de caixa compreendem saldos em conta corrente, aplicações financeiras de liquidez imediata e numerário em caixa, mensurados conforme NBC TG 03 (CPC 03).

Os saldos são apresentados no ativo circulante e reconciliados com a demonstração dos fluxos de caixa do exercício.`,
  },
  {
    id: 'receber',
    ordem: 5,
    titulo: '5. Contas a receber de clientes',
    cpcs: ['CPC 48'],
    aplicaQuando: (d) =>
      empresaTemAtividade(d, 'comercio', 'industria', 'servicos', 'agroindustria'),
    corpo: `Os direitos de recebimento de clientes são mensurados pelo valor de face, ajustado pela perda esperada de crédito (CPC 48), considerando histórico de inadimplência e fatores prospectivos.

Duplicatas descontadas e títulos cedidos em garantia, quando existentes, são divulgados com os saldos líquidos apresentados no balanço.`,
  },
  {
    id: 'estoque',
    ordem: 6,
    titulo: '6. Estoques',
    cpcs: ['CPC 16'],
    aplicaQuando: (d) => empresaTemAtividade(d, 'comercio', 'industria', 'agroindustria', 'rural'),
    corpo: `Os estoques {{estoqueDescricaoAtividade}} são mensurados pelo menor valor entre o custo de aquisição/produção e o valor realizável líquido, conforme CPC 16.

O custo é determinado {{metodoCustoEstoque}}. Perdas por obsolescência, deterioração e ajustes ao valor realizável líquido são reconhecidas no resultado do período.`,
  },
  {
    id: 'imobilizado',
    ordem: 7,
    titulo: '7. Ativo imobilizado',
    cpcs: ['CPC 27'],
    aplicaQuando: (d) => empresaTemAtividade(d, 'industria', 'rural', 'agroindustria', 'comercio'),
    corpo: `O imobilizado é mensurado pelo custo de aquisição ou construção, deduzidas a depreciação acumulada e perdas por redução ao valor recuperável (CPC 27).

As taxas de depreciação refletem a vida útil econômica estimada dos bens. Benfeitorias em imóveis de terceiros são amortizadas pelo prazo contratual ou vida útil, o que for menor.`,
  },
  {
    id: 'rural',
    ordem: 8,
    titulo: '8. Atividade rural e ativos biológicos',
    cpcs: ['CPC 29'],
    aplicaQuando: (d) => empresaTemAtividade(d, 'rural', 'agroindustria'),
    corpo: `A entidade desenvolve atividade rural/agrícola, enquadrada no CPC 29 (Ativo Biológico e Atividade Agrícola).

Produtos agrícolas e ativos biológicos são mensurados ao valor justo menos custos de venda na colheita, quando aplicável, ou pelo custo, conforme classificação e estágio do ativo.

Receitas de subvenções e incentivos ligados à atividade rural, quando recebidos, são divulgados conforme a natureza (investimento ou receita operacional).`,
  },
  {
    id: 'receita',
    ordem: 9,
    titulo: '9. Receita operacional bruta',
    cpcs: ['CPC 47'],
    aplicaQuando: sempre,
    corpo: `A receita operacional bruta do exercício foi de {{receitaBrutaExercicio}}, reconhecida conforme CPC 47:

{{receitaPorAtividade}}

O reconhecimento ocorre quando a entidade satisfaz a obrigação de desempenho, transferindo o controle do bem ou serviço ao cliente, pelo valor da contraprestação a que tem direito.`,
  },
  {
    id: 'folha',
    ordem: 10,
    titulo: '10. Folha de pagamento e encargos sociais',
    cpcs: ['CPC 33'],
    aplicaQuando: sempre,
    corpo: `A entidade empregava em média {{numeroEmpregados}} colaboradores no exercício.

Salários, férias, 13º salário, encargos sociais (INSS, FGTS) e provisões trabalhistas são reconhecidos no regime de competência, conforme CPC 33 e legislação trabalhista vigente.`,
  },
  {
    id: 'endividamento',
    ordem: 11,
    titulo: '11. Empréstimos, financiamentos e passivos financeiros',
    cpcs: ['CPC 48', 'CPC 26', 'CPC 03'],
    aplicaQuando: empresaTemEndividamento,
    corpo: `A entidade possui operações de endividamento no exercício, classificadas entre circulante e não circulante conforme CPC 26 e mensuradas ao custo amortizado nos termos do CPC 48.

{{#possuiEmprestimos}}
Empréstimos bancários
Os empréstimos e financiamentos de curto prazo totalizaram {{saldoEmprestimosCP}} e os de longo prazo {{saldoEmprestimosLP}}, apresentados em passivo circulante e não circulante conforme vencimentos contratuais. Juros, encargos e variações cambiais (quando aplicável) são reconhecidos no resultado pelo regime de competência. Os fluxos de captação e amortização são evidenciados na demonstração dos fluxos de caixa (CPC 03), na atividade de financiamento.
{{/possuiEmprestimos}}

{{#possuiFinanciamentos}}
Financiamentos
Os financiamentos contratados no exercício totalizaram {{saldoFinanciamentosCP}} (circulante) e {{saldoFinanciamentosLP}} (não circulante), vinculados à aquisição de ativos ou à atividade operacional conforme contrato. Bens dados em garantia e eventuais restrições contratuais (covenants) são divulgados quando relevantes.
{{/possuiFinanciamentos}}

Modalidades e normas específicas (peculiaridades)
{{textoPeculiaridadesEndividamento}}

{{#endividamentoObservacoes}}
Observações adicionais: {{endividamentoObservacoes}}
{{/endividamentoObservacoes}}`,
  },
  {
    id: 'imunidade_isencao',
    ordem: 12,
    titulo: '12. Imunidade e isenção tributária',
    cpcs: ['NBC TG 1001', 'ITG 2000', 'CPC 26'],
    aplicaQuando: empresaEhImuneOuIsenta,
    corpo: `{{textoImunidadeIsencao}}

Fundamento legal declarado: {{fundamentoImunidadeIsencao}}.

A entidade mantém escrituração contábil regular e demonstrações compatíveis com sua natureza jurídica, observando a NBC TG 1001 quando aplicável a entidades sem fins lucrativos, imunes ou isentas.

As receitas e despesas são classificadas conforme a destinação dos recursos e a vinculação legal, com divulgação das restrições ao uso de ativos e dos saldos vinculados, quando existentes.`,
  },
  {
    id: 'tributos',
    ordem: 13,
    titulo: '13. Regime tributário e tributos',
    cpcs: ['CPC 32'],
    aplicaQuando: (d) => !empresaEhImuneOuIsenta(d),
    corpo: `{{textoRegimeTributario}}

Os tributos incidentes sobre a atividade (PIS, COFINS, ICMS, ISS, IPI, quando aplicáveis conforme {{atividadesLabel}}) foram apurados conforme a legislação vigente e registrados em conformidade com o regime declarado.`,
  },
  {
    id: 'patrimonio',
    ordem: 14,
    titulo: '14. Patrimônio líquido e capital social',
    cpcs: ['CPC 26'],
    aplicaQuando: sempre,
    corpo: `O capital social subscrito e integralizado é de {{capitalSocial}}.

O patrimônio líquido ao final do exercício totalizou {{patrimonioLiquido}}, composto por capital social, reservas legais/statutárias (quando existentes), ajustes de avaliação patrimonial e lucros/prejuízos acumulados.`,
  },
  {
    id: 'partes_relacionadas',
    ordem: 15,
    titulo: '15. Partes relacionadas',
    cpcs: ['CPC 05', 'CPC 26'],
    aplicaQuando: sempre,
    corpo: `Saldos e transações com partes relacionadas (sócios, controladas, coligadas e demais definidas no CPC 05), quando existentes, são divulgados com natureza, valores e condições contratuais.

Na ausência de operações relevantes, declara-se que não houve transações significativas com partes relacionadas no exercício.`,
  },
  {
    id: 'eventos_subsequentes',
    ordem: 16,
    titulo: '16. Eventos subsequentes',
    cpcs: ['CPC 26'],
    aplicaQuando: sempre,
    corpo: `Entre a data do encerramento do exercício e a autorização para emissão destas demonstrações, não ocorreram eventos subsequentes que exigissem ajuste ou divulgação nas demonstrações contábeis, exceto se indicado em aditamento específico.`,
  },
];

export function buildTemplateContext(dados: NotaExplicativaEmpresaDados): Record<string, string> {
  const atividadesLabel = dados.atividades
    .map((a) => {
      const map: Record<string, string> = {
        comercio: 'comércio',
        industria: 'indústria',
        servicos: 'serviços',
        rural: 'atividade rural',
        agroindustria: 'agroindústria',
      };
      return map[a] ?? a;
    })
    .join(', ');

  const receitaLinhas: string[] = [];
  if (empresaTemAtividade(dados, 'comercio')) {
    receitaLinhas.push('• Venda de mercadorias: reconhecimento no momento da transferência do controle ao comprador (CPC 47).');
  }
  if (empresaTemAtividade(dados, 'industria')) {
    receitaLinhas.push('• Venda de produtos industrializados: reconhecimento na entrega e aceite pelo cliente.');
  }
  if (empresaTemAtividade(dados, 'servicos')) {
    receitaLinhas.push('• Prestação de serviços: reconhecimento ao longo do tempo ou em um ponto no tempo, conforme obrigação de desempenho.');
  }
  if (empresaTemAtividade(dados, 'rural', 'agroindustria')) {
    receitaLinhas.push('• Produtos agrícolas/agroindustriais: reconhecimento na colheita ou na transferência, conforme CPC 29 e CPC 47.');
  }

  const regimeMap: Record<string, string> = {
    simples_nacional: 'Simples Nacional',
    lucro_presumido: 'Lucro Presumido',
    lucro_real: 'Lucro Real',
    imune: 'Imune (imunidade constitucional)',
    isenta: 'Isenta (isenção legal)',
  };

  let textoRegime = '';
  let textoImunidadeIsencao = '';
  if (dados.regime === 'imune') {
    textoImunidadeIsencao =
      'A entidade é imune ao imposto de renda e às contribuições sociais, nos termos da Constituição Federal e da legislação aplicável à sua natureza jurídica. A imunidade constitucional não dispensa a escrituração contábil, o cumprimento das obrigações acessórias compatíveis com o enquadramento e a apresentação das demonstrações contábeis.';
    textoRegime = textoImunidadeIsencao;
  } else if (dados.regime === 'isenta') {
    textoImunidadeIsencao =
      'A entidade é isenta do imposto de renda e da CSLL, conforme previsto em lei específica que autoriza o benefício fiscal. A isenção legal não dispensa a escrituração contábil regular nem as obrigações acessórias aplicáveis ao enquadramento declarado.';
    textoRegime = textoImunidadeIsencao;
  } else if (dados.regime === 'simples_nacional') {
    textoRegime =
      'A entidade é optante pelo Simples Nacional (Lei Complementar nº 123/2006). A apuração consolidada de tributos segue o regime especial, com escrituração compatível com ITG 2000 / NBC TG 1000 quando aplicável a PMEs.';
  } else if (dados.regime === 'lucro_presumido') {
    textoRegime =
      'A entidade apura o IRPJ e a CSLL pelo regime de Lucro Presumido. Tributos correntes são reconhecidos com base na legislação vigente; ativos e passivos tributários diferidos são avaliados conforme CPC 32 quando aplicável.';
  } else {
    textoRegime =
      'A entidade apura o IRPJ e a CSLL pelo Lucro Real. Ativos e passivos tributários diferidos são reconhecidos conforme CPC 32, com base nas alíquotas vigentes e na expectativa de realização dos créditos tributários.';
  }

  let estoqueDesc = 'de mercadorias para revenda';
  let metodoCusto = 'pela média ponderada móvel';
  if (empresaTemAtividade(dados, 'industria', 'agroindustria')) {
    estoqueDesc = 'de produtos acabados, em elaboração e matérias-primas';
    metodoCusto = 'pelo custo médio ou PEPS, conforme natureza do item';
  } else if (empresaTemAtividade(dados, 'rural')) {
    estoqueDesc = 'de produtos agrícolas e insumos';
    metodoCusto = 'pelo custo de produção/aquisição';
  }

  const peculiaridades: string[] = [];
  for (const tipo of dados.tiposEndividamento ?? []) {
    const label = NOTA_ENDIVIDAMENTO_LABELS[tipo];
    const detalhe: Record<string, string> = {
      emprestimo_bancario:
        'Mensuração ao custo amortizado (CPC 48); segregação CP/LP (CPC 26); juros no resultado.',
      financiamento_bens:
        'Passivo vinculado ao ativo financiado; depreciação do bem (CPC 27) e amortização do passivo (CPC 48).',
      financiamento_rural:
        'Crédito rural/agrícola com normas do Manual de Crédito Rural e CPC 29 quando houver ativo biológico vinculado.',
      arrendamento_mercantil:
        'Reconhecimento de direito de uso e obrigação de arrendamento (CPC 06), com segregação financeiro vs. operacional.',
      debentures:
        'Emissão de títulos de dívida; custo de transação deduzido do passivo; juros pelo método da taxa efetiva (CPC 48).',
      mutuo_partes_relacionadas:
        'Divulgação de saldos e condições com partes relacionadas (CPC 05), além da mensuração do passivo (CPC 48).',
      acc_ace_exportacao:
        'Financiamento à exportação; passivo financeiro mensurado conforme CPC 48 até liquidação da operação.',
      custos_emprestimos_ativo:
        'Encargos financeiros capitalizados em ativo qualificado em elaboração, nos termos do CPC 20.',
    };
    peculiaridades.push(`• ${label}: ${detalhe[tipo] ?? 'Conforme CPC 48.'}`);
  }
  if (peculiaridades.length === 0 && empresaTemEndividamento(dados)) {
    peculiaridades.push(
      '• Endividamento genérico: passivos financeiros ao custo amortizado (CPC 48), classificação CP/LP (CPC 26) e fluxos na DFC (CPC 03).',
    );
  }

  return {
    razaoSocial: dados.razaoSocial || '[RAZÃO SOCIAL]',
    nomeFantasia: dados.nomeFantasia || dados.razaoSocial || '[NOME FANTASIA]',
    cnpj: dados.cnpj || '[CNPJ]',
    exercicio: dados.exercicio || String(new Date().getFullYear()),
    dataEncerramento: dados.dataEncerramento || `31/12/${dados.exercicio}`,
    municipio: dados.municipio || '[MUNICÍPIO]',
    uf: dados.uf || '[UF]',
    regimeLabel: regimeMap[dados.regime] ?? dados.regime,
    moedaFuncional: dados.moedaFuncional,
    unidadeMedida: dados.unidadeMedida,
    capitalSocial: dados.capitalSocial || '[CAPITAL SOCIAL]',
    fundamentoImunidadeIsencao:
      dados.fundamentoImunidadeIsencao?.trim() ||
      (dados.regime === 'imune'
        ? '[ARTIGO DA CONSTITUIÇÃO / LEI QUE CONFERE A IMUNIDADE]'
        : dados.regime === 'isenta'
          ? '[LEI OU DECRETO QUE CONFERE A ISENÇÃO]'
          : ''),
    numeroEmpregados: dados.numeroEmpregados || '[Nº EMPREGADOS]',
    receitaBrutaExercicio: dados.receitaBrutaExercicio || '[RECEITA BRUTA DO EXERCÍCIO]',
    patrimonioLiquido: dados.patrimonioLiquido || '[PATRIMÔNIO LÍQUIDO]',
    atividadesLabel: atividadesLabel || '[ATIVIDADES]',
    receitaPorAtividade: receitaLinhas.join('\n') || '• Receita operacional conforme atividades declaradas e CPC 47.',
    estoqueDescricaoAtividade: estoqueDesc,
    metodoCustoEstoque: metodoCusto,
    textoRegimeTributario: textoRegime,
    textoImunidadeIsencao,
    auditoriaIndependente: dados.auditoriaIndependente ? 'sim' : '',
    possuiEmprestimos: dados.possuiEmprestimos ? 'sim' : '',
    possuiFinanciamentos: dados.possuiFinanciamentos ? 'sim' : '',
    saldoEmprestimosCP: dados.saldoEmprestimosCP || '[SALDO CP]',
    saldoEmprestimosLP: dados.saldoEmprestimosLP || '[SALDO LP]',
    saldoFinanciamentosCP: dados.saldoFinanciamentosCP || '[SALDO CP]',
    saldoFinanciamentosLP: dados.saldoFinanciamentosLP || '[SALDO LP]',
    textoPeculiaridadesEndividamento: peculiaridades.join('\n'),
    endividamentoObservacoes: dados.endividamentoObservacoes?.trim() ?? '',
  };
}
