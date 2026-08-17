/** Declarações de ferramentas expostas ao Gemini (execução no browser — RPA). */

export const AGENT_TOOL_DECLARATIONS = [
  {
    name: 'navegar_aba',
    description: 'Navega para uma aba principal do simulador Contábil Fácil.',
    parameters: {
      type: 'object',
      properties: {
        aba: {
          type: 'string',
          enum: ['manager', 'pricing', 'debug'],
          description: 'manager=Contábil, pricing=Precificação, debug=Debug/erros',
        },
      },
      required: ['aba'],
    },
  },
  {
    name: 'obter_contexto_sistema',
    description:
      'Retorna sindicato ativo, aba atual, contratos e mapa completo do que o agente pode fazer no sistema.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'listar_capacidades_sistema',
    description:
      'Lista abas, APIs, regras CPC e limitações conhecidas do software — use para decidir o plano antes de agir.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'solicitar_ajuda_cursor',
    description:
      'RPA de escalação: quando o sistema NÃO permite concluir (bug, feature ausente, API off, ferramenta inexistente). Copia um prompt para a área de transferência — o usuário cola no Composer do Cursor se quiser. Use após tentar alternativas.',
    parameters: {
      type: 'object',
      properties: {
        resumo: { type: 'string', description: 'Pedido do usuário em uma frase' },
        limitacao: { type: 'string', description: 'O que o software não faz ou o erro exato' },
        tentativas: {
          type: 'string',
          description: 'Ferramentas RPA já executadas e resultados',
        },
        sugestaoTecnica: {
          type: 'string',
          description: 'O que implementar no código (arquivos/módulos sugeridos)',
        },
        prioridade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
      },
      required: ['resumo', 'limitacao'],
    },
  },
  {
    name: 'listar_contratos_emprestimo',
    description: 'Lista contratos de empréstimo do sindicato ativo (número, banco, sistema, parcelas).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'selecionar_contrato_emprestimo',
    description: 'Seleciona um contrato de empréstimo por id ou número do contrato.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID do contrato' },
        numeroContrato: { type: 'string', description: 'Número do contrato exibido na lista' },
      },
    },
  },
  {
    name: 'resumo_cronograma_emprestimo',
    description:
      'Resumo do cronograma do contrato selecionado: parcelas, saldo, curto/longo CPC, carência.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'diagnostico_export_dominio',
    description: 'Executa diagnóstico do TXT Domínio (transferências LP→CP, contas, provisões).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'exportar_dominio_txt',
    description: 'Gera e baixa o arquivo TXT de importação Domínio do contrato selecionado.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'exportar_pdf_cronograma',
    description: 'Gera e baixa o PDF do cronograma do contrato selecionado.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'listar_produtos_acabados',
    description: 'Lista produtos acabados (PA) do sindicato na precificação.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'listar_estoque_precificacao',
    description:
      'Lista insumos, matéria-prima ou mercadorias. Filtre por categoria e por PA (estoque separado por produto).',
    parameters: {
      type: 'object',
      properties: {
        categoria: {
          type: 'string',
          enum: ['insumo', 'materia_prima', 'mercadoria', 'produto_acabado'],
        },
        produtoAcabadoNome: {
          type: 'string',
          description: 'Nome do PA para ver só o estoque daquele produto',
        },
      },
    },
  },
  {
    name: 'resumo_precificacao',
    description: 'Resumo de precificação: custos, preços, margens e faltantes de estoque.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'cadastrar_ou_atualizar_estoque',
    description:
      'Cria ou atualiza item de estoque (insumo/MP/mercadoria/PA). Para insumo/MP use produtoAcabadoNome quando o estoque for por PA.',
    parameters: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        categoria: {
          type: 'string',
          enum: ['insumo', 'materia_prima', 'mercadoria', 'produto_acabado'],
        },
        produtoAcabadoNome: { type: 'string' },
        id: { type: 'string' },
        sku: { type: 'string' },
        unitPrice: { type: 'number' },
        unitsPurchased: { type: 'number' },
        measureQuantity: { type: 'number' },
        directCost: { type: 'number' },
        monthlyQty: { type: 'number' },
      },
      required: ['nome', 'categoria'],
    },
  },
  {
    name: 'repor_estoque_precificacao',
    description: 'Acrescenta estoque faltante (um item ou todos os faltantes da composição).',
    parameters: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        id: { type: 'string' },
        reporTodos: { type: 'boolean' },
      },
    },
  },
  {
    name: 'navegar_subaba_precificacao',
    description:
      'Abre subaba da precificação: dashboard, estoque, custos, creditos, dre, precificacao, calculos, roa.',
    parameters: {
      type: 'object',
      properties: {
        subaba: {
          type: 'string',
          enum: [
            'dashboard',
            'estoque',
            'custos',
            'creditos',
            'dre',
            'precificacao',
            'comparacao-aliquotas',
            'calculos',
            'roa',
          ],
        },
        itemEstoqueId: { type: 'string', description: 'Opcional: focar item no editor de estoque' },
      },
      required: ['subaba'],
    },
  },
  {
    name: 'alterar_parametro_simulacao',
    description:
      'Altera campos da simulação do contrato selecionado (ex.: principal, carência, taxa, parcelas).',
    parameters: {
      type: 'object',
      properties: {
        principalStr: { type: 'string', description: 'Valor principal formatado BR, ex.: 150.000,00' },
        monthsStr: { type: 'string', description: 'Quantidade de parcelas' },
        gracePeriodStr: { type: 'string', description: 'Meses de carência' },
        graceType: { type: 'string', enum: ['capitalized', 'paid'] },
        system: { type: 'string', enum: ['SAC', 'PRICE'] },
        varMode: {
          type: 'string',
          enum: ['none', 'pronampe', 'selic', 'cdi', 'custom'],
        },
        contractDateStr: { type: 'string', description: 'Data contrato AAAA-MM-DD' },
        firstInstallmentDateStr: { type: 'string', description: '1ª parcela AAAA-MM-DD' },
      },
    },
  },
] as const;

export type AgentToolName = (typeof AGENT_TOOL_DECLARATIONS)[number]['name'];
