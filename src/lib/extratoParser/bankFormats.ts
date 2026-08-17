export type BankCode = 'BANCO_DO_BRASIL' | 'ITAU' | 'INTER' | 'NUBANK' | 'SANTANDER' | 'SICREDI' | 'WISE' | 'INFINITE_PAY' | 'BRADESCO' | 'CAIXA' | 'CRESOL';

export interface BankColumn {
  name: string;
  description: string;
  /** Nulo quando o banco não traz a coluna preenchida no extrato (ex.: Saldo na Wise). */
  example: string | null;
}

export interface BankLayout {
  id: string;
  name: string;
  description: string;
  columns: BankColumn[];
  icon: string;
  imageUrl?: string;
}

export interface BankInfo {
  code: BankCode;
  name: string;
  displayName: string;
  logo: string;
  color: string;
  layouts: BankLayout[];
}

export const BANK_FORMATS: Record<BankCode, BankInfo> = {
  BANCO_DO_BRASIL: {
    code: 'BANCO_DO_BRASIL',
    name: 'Banco do Brasil',
    displayName: 'Banco do Brasil',
    logo: '🏦',
    color: 'from-blue-600 to-blue-700',
    layouts: [
      {
        id: 'bdb_padrao',
        name: 'Extrato Padrão',
        description: 'Layout padrão do Banco do Brasil com todas as transações do período',
        icon: '📊',
        columns: [
          {
            name: 'Data',
            description: 'Data da transação (YYYY-MM-DD)',
            example: '2026-06-01',
          },
          {
            name: 'Descrição',
            description: 'Descrição do tipo de transação',
            example: 'Pix - Recebido - POLO SUL CL',
          },
          {
            name: 'Valor',
            description: 'Valor da transação (positivo ou negativo)',
            example: '6300.00 / -248.59',
          },
          {
            name: 'Saldo',
            description: 'Saldo da conta após transação',
            example: '50000.00',
          },
          {
            name: 'Categoria',
            description: 'Categoria automática da transação',
            example: 'Receitas / Fornecedores',
          },
        ],
      },
      {
        id: 'bdb_comprovante',
        name: 'Comprovante / Extrato CC',
        description: 'Extrato de Conta Corrente BB onde o valor e sinal (+/-) aparecem antes da data no PDF (formato "ComprovanteBB")',
        icon: '🧾',
        imageUrl: '/extratos/bb_extrato_comprovante.png',
        columns: [
          {
            name: 'Valor',
            description: 'Valor da transação com sinal (+/-)',
            example: '183,00 (+) / 2.458,92 (-)',
          },
          {
            name: 'Data',
            description: 'Data da transação (DD/MM/AAAA)',
            example: '04/05/2026',
          },
          {
            name: 'Lote',
            description: 'Código do lote',
            example: '14397',
          },
          {
            name: 'Documento',
            description: 'Número do documento',
            example: '11106073834502',
          },
          {
            name: 'Histórico',
            description: 'Descrição da transação',
            example: 'Pix - Recebido 01/05 09:03 JOSE ANTONIO',
          },
        ],
      },
    ],
  },
  ITAU: {
    code: 'ITAU',
    name: 'Itaú',
    displayName: 'Itaú Empresas',
    logo: '🧡',
    color: 'from-orange-600 to-orange-700',
    layouts: [
      {
        id: 'itau_completo',
        name: 'Extrato Completo',
        description: 'Layout completo do Itaú com lançamentos, razão social e CNPJ/CPF do contraparte',
        icon: '📊',
        columns: [
          {
            name: 'Data',
            description: 'Data do lançamento',
            example: '2026-05-05',
          },
          {
            name: 'Lançamento',
            description: 'Descrição do tipo de operação',
            example: 'TED RECEBIDA / SISPAG FORNECEDORES',
          },
          {
            name: 'Razão Social',
            description: 'Nome do favorecido/pagador',
            example: 'POLO SUL CLIMATIZACAO LTDA',
          },
          {
            name: 'CNPJ/CPF',
            description: 'Documento do favorecido/pagador',
            example: '58.952.046/0001-90',
          },
          {
            name: 'Valor (R$)',
            description: 'Valor já com sinal (positivo ou negativo)',
            example: '100.000,00 / -231,00',
          },
        ],
      },
    ],
  },
  INTER: {
    code: 'INTER',
    name: 'Banco Inter',
    displayName: 'Banco Inter',
    logo: '🏢',
    color: 'from-orange-500 to-orange-600',
    layouts: [
      {
        id: 'inter_completo',
        name: 'Extrato Completo',
        description: 'Layout completo do Banco Inter com todas as operações',
        icon: '📊',
        columns: [
          {
            name: 'Data',
            description: 'Data da operação',
            example: '2026-06-09',
          },
          {
            name: 'Descrição',
            description: 'Descrição da operação',
            example: 'Resgate: "CDB DI LIQ BANCO INTER SA"',
          },
          {
            name: 'Valor',
            description: 'Valor da operação',
            example: '810.54',
          },
          {
            name: 'Saldo',
            description: 'Saldo em conta',
            example: '810.54',
          },
          {
            name: 'Categoria',
            description: 'Categoria da operação',
            example: 'Investimento',
          },
        ],
      },
    ],
  },
  NUBANK: {
    code: 'NUBANK',
    name: 'Nubank',
    displayName: 'Nubank',
    logo: '💜',
    color: 'from-purple-600 to-purple-700',
    layouts: [
      {
        id: 'nubank_completo',
        name: 'Extrato Completo',
        description: 'Layout completo do Nubank com identificação de beneficiários',
        icon: '📊',
        columns: [
          {
            name: 'Data',
            description: 'Data da transferência',
            example: '2026-04-06',
          },
          {
            name: 'Descrição',
            description: 'Descrição com nome do beneficiário/pagador',
            example: 'Transferência recebida pelo Pix AMO',
          },
          {
            name: 'Valor',
            description: 'Valor da transferência',
            example: '5000.00',
          },
          {
            name: 'Saldo',
            description: 'Saldo após operação',
            example: null,
          },
          {
            name: 'Categoria',
            description: 'Tipo de movimento',
            example: 'Income / Transfer Sent',
          },
        ],
      },
    ],
  },
  SANTANDER: {
    code: 'SANTANDER',
    name: 'Santander',
    displayName: 'Santander Empresas',
    logo: '🏛️',
    color: 'from-red-600 to-red-700',
    layouts: [
      {
        id: 'santander_completo',
        name: 'Extrato Completo',
        description: 'Layout do Santander com data ISO, descrição e valor com sinal',
        icon: '📊',
        columns: [
          {
            name: 'Data',
            description: 'Data da transação (YYYY-MM-DD)',
            example: '2026-01-02',
          },
          {
            name: 'Descrição',
            description: 'Descrição da operação',
            example: 'Iof Adicional - Automatico',
          },
          {
            name: 'Valor',
            description: 'Valor da operação (com sinal)',
            example: '-2,94 / +0,01',
          },
        ],
      },
    ],
  },
  SICREDI: {
    code: 'SICREDI',
    name: 'Sicredi',
    displayName: 'Sicredi',
    logo: '🟢',
    color: 'from-green-600 to-green-700',
    layouts: [
      {
        id: 'sicredi_completo',
        name: 'Extrato Completo (Colunas)',
        description: 'Layout do Sicredi extraído por posição X/Y das colunas (PDFs onde a ordem de texto não é a ordem visual)',
        icon: '📊',
        columns: [
          {
            name: 'Data',
            description: 'Data da transação',
            example: '2026-04-01',
          },
          {
            name: 'Descrição',
            description: 'Descrição com CPF/CNPJ',
            example: 'RECEBIMENTO PIX 58773215104 ANDRE LUIZ',
          },
          {
            name: 'Valor',
            description: 'Valor da transação',
            example: '10.00',
          },
          {
            name: 'Saldo',
            description: 'Saldo após transação',
            example: '58.23',
          },
          {
            name: 'Categoria',
            description: 'Tipo de movimento',
            example: 'Receita / Pagamento',
          },
        ],
      },
      {
        id: 'sicredi_texto',
        name: 'Extrato Texto Puro',
        description: 'Layout do Sicredi onde o PDF entrega texto em ordem de leitura: Data | Descrição | Documento | Valor (R$) | Saldo (R$)',
        icon: '📄',
        columns: [
          {
            name: 'Data',
            description: 'Data da transação (DD/MM/AAAA)',
            example: '04/05/2026',
          },
          {
            name: 'Descrição',
            description: 'Descrição com CPF/CNPJ do contraparte',
            example: 'RECEBIMENTO PIX 93378300191 THIAGO NASCENTE GOMI',
          },
          {
            name: 'Documento',
            description: 'Código do documento ou tipo de operação',
            example: 'PIX_CRED / C41630102',
          },
          {
            name: 'Valor (R$)',
            description: 'Valor com sinal (negativo = débito)',
            example: '35,00 / -7.000,00',
          },
          {
            name: 'Saldo (R$)',
            description: 'Saldo após a transação',
            example: '-12,34',
          },
        ],
      },
    ],
  },
  WISE: {
    code: 'WISE',
    name: 'Wise',
    displayName: 'Wise',
    logo: '💱',
    color: 'from-teal-600 to-teal-700',
    layouts: [
      {
        id: 'wise_completo',
        name: 'Extrato Completo',
        description: 'Layout completo do Wise com transferências internacionais',
        icon: '📊',
        columns: [
          {
            name: 'Data',
            description: 'Data da transação',
            example: '2026-06-24',
          },
          {
            name: 'Descrição',
            description: 'Descrição do beneficiário/pagador',
            example: 'Recebeu dinheiro de PlanA.Earth GmbH',
          },
          {
            name: 'Valor',
            description: 'Valor da transferência',
            example: '8233.33',
          },
          {
            name: 'Saldo',
            description: 'Saldo em conta',
            example: '8233.33',
          },
          {
            name: 'Categoria',
            description: 'Tipo de movimento',
            example: 'Receita / Transferência',
          },
        ],
      },
    ],
  },
  INFINITE_PAY: {
    code: 'INFINITE_PAY',
    name: 'InfinitePay',
    displayName: 'InfinitePay (Cloudwalk)',
    logo: '⚪',
    color: 'from-zinc-800 to-black',
    layouts: [
      {
        id: 'infinitepay_movimentacoes',
        name: 'Relatório de Movimentações',
        description: 'Layout padrão da InfinitePay (Cloudwalk) com transações detalhadas e depósitos de vendas',
        icon: '📊',
        imageUrl: '/infinitepay-layout.png',
        columns: [
          {
            name: 'Data',
            description: 'Data da transação (DD Mes, YYYY)',
            example: '01 Mai, 2026',
          },
          {
            name: 'Tipo',
            description: 'Tipo da transação (Pix, Depósito de vendas, etc)',
            example: 'Depósito de vendas',
          },
          {
            name: 'Nome',
            description: 'Nome do contraparte ou origem',
            example: 'Vendas',
          },
          {
            name: 'Detalhe',
            description: 'Detalhes adicionais da transação',
            example: 'Depósito InfinitePay',
          },
          {
            name: 'Valor (R$)',
            description: 'Valor com sinal (+ ou -)',
            example: '+5.200,58 / -100,00',
          },
        ],
      },
    ],
  },
  BRADESCO: {
    code: 'BRADESCO',
    name: 'Bradesco',
    displayName: 'Bradesco Net Empresa',
    logo: '🟥',
    color: 'from-red-700 to-red-800',
    layouts: [
      {
        id: 'bradesco_netempresa',
        name: 'Net Empresa (Últimos Lançamentos)',
        description: 'Layout do Bradesco Net Empresa com colunas: Data | Lançamento | Dcto. | Crédito (R$) | Débito (R$) | Saldo (R$)',
        icon: '🧾',
        imageUrl: '/extratos/bradesco_netempresa.png',
        columns: [
          {
            name: 'Data',
            description: 'Data da transação (DD/MM/AAAA)',
            example: '19/02/2026',
          },
          {
            name: 'Lançamento',
            description: 'Descrição completa da transação',
            example: 'CARTAO VISA ELECTRON CIELO S.A - INSTITUICAO DE PAG',
          },
          {
            name: 'Dcto.',
            description: 'Número do documento da transação',
            example: '9625193',
          },
          {
            name: 'Crédito (R$)',
            description: 'Valor de crédito (positivo)',
            example: '5,92 / 206,63',
          },
          {
            name: 'Débito (R$)',
            description: 'Valor de débito (negativo)',
            example: '-1.191,61 / -601,98',
          },
          {
            name: 'Saldo (R$)',
            description: 'Saldo da conta após a transação',
            example: '982,69 / 1.189,32',
          },
        ],
      },
    ],
  },
  CAIXA: {
    code: 'CAIXA',
    name: 'Caixa Econômica Federal',
    displayName: 'Caixa Econômica Federal',
    logo: '🔷',
    color: 'from-sky-600 to-blue-800',
    layouts: [
      {
        id: 'caixa_extrato_periodo',
        name: 'Extrato por Período',
        description:
          'Layout do internet banking Caixa PJ com colunas: Data | Nr. Doc | Histórico/Complemento | Favorecido | CPF/CNPJ | Valor | Saldo, extraído por posição X/Y das colunas',
        icon: '📊',
        imageUrl: '/extratos/caixa_extrato_periodo.png',
        columns: [
          {
            name: 'Data',
            description: 'Data e hora do lançamento (DD/MM/AAAA - HH:MM:SS)',
            example: '02/02/2026 - 17:07:44',
          },
          {
            name: 'Histórico/Complemento',
            description: 'Tipo da operação (PIX Recebido, Deb Pix Chave, Tar Pix, etc.)',
            example: 'PIX RECEBIDO / DEB PIX CHAVE / TAR PIX',
          },
          {
            name: 'Favorecido',
            description: 'Nome do favorecido/pagador (quando informado)',
            example: 'Fornecedor Ltda',
          },
          {
            name: 'Valor',
            description: 'Valor do lançamento com sinal C (crédito) ou D (débito)',
            example: '20.000,00 C / 8,50 D',
          },
          {
            name: 'Saldo',
            description: 'Saldo da conta após o lançamento',
            example: '40.371,66 C',
          },
        ],
      },
      {
        id: 'caixa_app_periodo',
        name: 'Extrato por Período (App)',
        description:
          'Layout do aplicativo Caixa (exportação de tela) agrupado por dia, sem saldo por lançamento nem CPF/CNPJ — apenas histórico, favorecido e valor com sinal',
        icon: '📱',
        imageUrl: '/extratos/caixa_app_extrato_periodo.png',
        columns: [
          {
            name: 'Data',
            description: 'Data do lançamento, herdada do cabeçalho do dia',
            example: '2026-03-02',
          },
          {
            name: 'Histórico',
            description: 'Tipo da operação (Deb Pix Chave, Tar Pix, Pix Recebido, etc.)',
            example: 'Deb Pix Chave / Tar Pix / Pix Recebido',
          },
          {
            name: 'Favorecido',
            description: 'Nome do favorecido/pagador (quando informado), pode vir em 2-3 linhas',
            example: 'Marcos Augusto Hygino',
          },
          {
            name: 'Valor',
            description: 'Valor do lançamento já com sinal (positivo ou negativo)',
            example: '-8,50 / 20.000,00',
          },
        ],
      },
    ],
  },
  CRESOL: {
    code: 'CRESOL',
    name: 'Cresol',
    displayName: 'Cresol',
    logo: '🟢',
    color: 'from-emerald-700 to-emerald-900',
    layouts: [
      {
        id: 'cresol_extrato_periodo',
        name: 'Extrato por Período',
        description:
          'Layout do internet banking Cresol, agrupado por dia (com "Saldo do Dia"), com data, histórico e valor com sinal (+ crédito / - débito), extraído por posição X/Y das colunas',
        icon: '📊',
        imageUrl: '/extratos/cresol_extrato_periodo.png',
        columns: [
          {
            name: 'Data',
            description: 'Data do lançamento (DD/MM/AAAA), em coluna própria à esquerda do histórico',
            example: '01/06/2026',
          },
          {
            name: 'Histórico',
            description: 'Descrição da operação, podendo quebrar em duas linhas',
            example: 'PIX DEBITO PARA: LUZIETE MACHADO DA SILVA',
          },
          {
            name: 'Valor',
            description: 'Valor com sinal: + para crédito, - para débito',
            example: '- R$ 150,00 / + R$ 796,27',
          },
          {
            name: 'Saldo do Dia',
            description: 'Saldo consolidado no cabeçalho de cada dia (não vira lançamento)',
            example: '+ R$ 734,25',
          },
        ],
      },
    ],
  },
};

export const BANKS_LIST = Object.values(BANK_FORMATS);
