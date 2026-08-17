export type TransactionCategory =
  | 'Receita'
  | 'Transporte'
  | 'Transferência'
  | 'Alimentação'
  | 'Tarifas/Encargos'
  | 'Empréstimos'
  | 'Cartão de Crédito'
  | 'Logística/Transporte'
  | 'Suprimentos'
  | 'Serviços'
  | 'Impostos'
  | 'Utilidades'
  | 'Compras'
  | 'Seguros'
  | 'Investimentos'
  | 'Outros';

const CATEGORY_KEYWORDS: Record<TransactionCategory, string[]> = {
  'Receita': [
    'recebimento',
    'pix',
    'ted', // Só chega aqui com valor positivo — TED recebida é entrada.
    'transferência entrada',
    'depósito',
    'crédito',
    'remuneração',
    'aluguel recebido',
  ],
  'Transporte': [
    'transporte',
    'uber',
    'táxi',
    'combustível',
    'gasolina',
    'diesel',
    'estacionamento',
    'pedágio',
    'passagem',
    'auto posto',
    'abastecimento',
    'transp', // Extrato trunca a razão social: "TRANSTUR TRANSP", "... TRANSPORTAD"
  ],
  'Transferência': [
    'pix',
    'ted',
    'transferência',
    'pagamento pix',
  ],
  'Alimentação': [
    'restaurante',
    'pizzaria',
    'sorveteria',
    'comida',
    'bebida',
    'açougue',
    'padaria',
    'mercado',
    'supermercado',
  ],
  'Tarifas/Encargos': [
    'tarifa',
    'taxa',
    'encargo',
    'juros',
    'multa',
    'amortização',
    'cpm',
    'cpmf',
  ],
  'Empréstimos': [
    'empréstimo',
    'financiamento',
    'parcela',
    'amortização',
    'liquida',
    'liquidação',
    'crédito pessoal',
    'procapsi',
  ],
  'Cartão de Crédito': [
    'débito fatura',
    'cartão',
    'deb.ct',
    'deb.cta',
    'fatura',
  ],
  'Logística/Transporte': [
    'transportes',
    'frete',
    'sedex',
    'pac',
    'logística',
    'entrega',
  ],
  'Suprimentos': [
    'suprimentos',
    'material',
    'compras',
    'fornecedor',
    'estoque',
    'produtos',
    'tintas',
    'papéis',
    'tubos',
    'aço',
    'ferragista',
  ],
  'Serviços': [
    'serviço',
    'consultoria',
    'manutenção',
    'reparo',
    'limpeza',
    'contabilidade',
  ],
  'Impostos': [
    'imposto',
    'icms',
    'irpj',
    'pis',
    'cofins',
    'inss',
    'fgts',
    'arrecadação',
    'darfc',
  ],
  'Utilidades': [
    'água',
    'luz',
    'energia',
    'telefone',
    'internet',
    'gás',
    'utilidade',
  ],
  'Compras': [
    'compra',
    'loja',
    'artigos',
    'peças',
  ],
  'Seguros': [
    'seguro',
    'vida',
    'saúde',
    'patrimonial',
    'convenio',
  ],
  'Investimentos': [
    'investimento',
    'aplicação',
    'fundo',
    'ações',
    'títulos',
  ],
  'Outros': [],
};

/**
 * Remove acentos e caixa. Extrato bancário quase sempre vem sem acentuação
 * ("AMORTIZACAO", "SERVICOS"), então comparar com as palavras-chave acentuadas
 * nunca casaria.
 */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Ordem de verificação, da categoria mais específica para a mais genérica.
 *
 * A ordem importa e não pode depender das chaves do objeto: "PAGAMENTO PIX
 * TUBOS VEROLA" é compra de suprimento, não uma transferência, e "LIQUIDACAO
 * BOLETO TRANSTUR TRANSP" é transporte, não empréstimo. Por isso Transferência
 * e Empréstimos — que casam por meio de pagamento, não por natureza do gasto —
 * ficam por último.
 *
 * Transporte e Alimentação vêm antes de Suprimentos de propósito: "COMPRAS
 * NACIONAIS AUTO POSTO" e "COMPRAS NACIONAIS SORVETERIA" casariam em
 * 'compras' e perderiam a natureza real.
 */
const CATEGORY_PRECEDENCE: TransactionCategory[] = [
  'Transporte',
  'Alimentação',
  'Cartão de Crédito',
  'Tarifas/Encargos',
  'Impostos',
  'Utilidades',
  'Seguros',
  'Investimentos',
  'Logística/Transporte',
  'Suprimentos',
  'Serviços',
  'Compras',
  'Empréstimos',
  'Transferência',
];

/** Palavras-chave já normalizadas, montadas uma única vez. */
const NORMALIZED_KEYWORDS: Record<string, string[]> = Object.fromEntries(
  Object.entries(CATEGORY_KEYWORDS).map(([cat, words]) => [cat, words.map(normalize)]),
);

export function classifyTransaction(
  description: string,
  amount: number
): TransactionCategory {
  const desc = normalize(description);

  // Entrada de dinheiro com palavra-chave de receita classifica como Receita:
  // 'pix' e 'ted' só significam transferência quando o valor é negativo.
  if (amount > 0) {
    for (const keyword of NORMALIZED_KEYWORDS['Receita']) {
      if (desc.includes(keyword)) {
        return 'Receita';
      }
    }
  }

  for (const category of CATEGORY_PRECEDENCE) {
    for (const keyword of NORMALIZED_KEYWORDS[category] ?? []) {
      if (desc.includes(keyword)) {
        return category;
      }
    }
  }

  return 'Outros';
}
