import type { StockCategory } from './pricingTypes';
import { STOCK_CATEGORY_LABELS } from './pricingTypes';

export const CREDITS_HELP_TITLE = 'Créditos recuperáveis — regimes e segmentos';

export const CREDITS_HELP_BODY = `
Cadastre os créditos **no editor de cada item** (aba Estoque). Esta aba mostra apenas a consolidação em cards (total, produto acabado, mercadoria).

**Simples Nacional**
• PIS/COFINS: geralmente sem crédito na maioria dos anexos (comércio/indústria/serviços).
• ICMS: crédito restrito; verifique sublimite e anexo III/V para indústria/comércio.
• Segmentos: comércio (mercadoria), indústria (produto acabado), serviços (serviço).

**Lucro Presumido**
• PIS/COFINS: créditos limitados (insumos essenciais, energia, aluguel de máquinas — conforme legislação).
• ICMS: crédito na aquisição de mercadorias para revenda e insumos industriais.
• IPI: crédito na cadeia industrial (matéria-prima → produto acabado).
• Segmentos: indústria e comércio têm mais créditos; serviços, em regra, menos.

**Lucro Real**
• PIS/COFINS (não cumulativo): crédito amplo sobre insumos, energia, frete, serviços ligados à atividade.
• ICMS/IPI: crédito integral conforme documento fiscal e uso na operação.
• Segmentos: indústria (MP + insumos + IPI), comércio (mercadoria + ICMS), serviços (despesas operacionais creditáveis).

**Como usar nesta aba**
Cadastre cada crédito mensal estimado na sub-aba do segmento (produto acabado, mercadoria ou serviço) e informe o regime. O rateio do crédito na precificação é feito só dentro da categoria escolhida.
• Também use esta aba quando houver **imposto pago a maior** (pagamento indevido/duplicado): informe o valor recuperável estimado para compensação ou restituição, conforme apuração fiscal.
`.trim();

export const MARKUP_MARGIN_HELP_TITLE = 'Markup × Margem de lucro — quando usar';

export const MARKUP_MARGIN_HELP_BODY = `
**Somente Markup**
• Aplica percentual sobre o **custo unitário total** (material + custos + despesas rateados − créditos): Preço = Custo total/un. × (1 + markup%).
• Ex.: custo total R$ 30,45 com markup 30% → preço R$ 39,58 (cobre estrutura e lucro).
• Segmentos: produto acabado, mercadoria e serviço com rateio de custos fixos.

**Somente Margem de lucro**
• Aplica percentual **sobre o preço de venda**, com base no custo unitário total: Preço = Custo total/un. ÷ (1 − margem%).
• Use quando a meta é atingir margem contábil/financeira (ex.: 30% do preço final).
• Segmentos: serviços, indústria B2B, contratos onde a margem é KPI principal.

**Markup + Margem juntos**
• Preço final = Custo total/un. × (1 + markup%) ÷ (1 − margem%). **Os dois percentuais entram no valor de venda.**
• A tabela mostra: % markup, % margem e **valor unitário (venda)** com os dois aplicados no preço final.
• Qualquer mudança em markup ou margem altera o valor final (ex.: 0,1% + 1% já mudam o preço).
• Use quando quer markup sobre o custo **e** margem de lucro sobre o preço de venda ao mesmo tempo.
• Segmentos: indústria de alimentos, cosméticos, produto acabado com BOM (insumos + matéria-prima).

**Produto acabado com estoque**
Cadastre os **insumos da receita inteira** e informe o **Rendimento (un./receita)** — ex.: 7 pudins. O sistema divide o custo dos insumos por 7 (R$ 10,10 ÷ 7 = R$ 1,44/un.). **Qtd/mês (vendas)** é separada: serve para rateio e venda total, não para dividir a receita. Embalagens: **1 un. por pudim** na composição.

**Meta sem prejuízo**
Se o preço de venda ficar **abaixo** do custo total/un., a coluna de meta indica quantas unidades ainda faltam usando margem de contribuição (preço − material). Aumente volume, cadastre mais produtos no segmento ou ajuste markup/margem.
`.trim();

export const COSTS_EXPENSES_HELP_TITLE = 'Custos × Despesas — qual a diferença?';

export const COSTS_EXPENSES_HELP_BODY = `
**Custos**
• Gastos ligados diretamente à produção, compra ou entrega do que você vende.
• Exemplos: matéria-prima, embalagem, mão de obra da produção, energia da fábrica, frete de insumo, impostos sobre a operação (DIFAL, ICMS na cadeia).
• Variam com o volume produzido ou vendido — quanto mais você produz, mais custo tende a aparecer.
• Nesta aba, cadastre o valor **mensal** e o sistema rateia entre os produtos do mesmo segmento (produto acabado, mercadoria ou serviço).

**Despesas**
• Gastos para manter a empresa funcionando, sem ligação direta com cada unidade vendida.
• Exemplos: aluguel, salários administrativos, contabilidade, marketing, telefone, software, manutenção do escritório.
• Em geral são fixas ou semi-fixas no mês — existem mesmo se a produção parar.
• Também são informadas em valor **mensal** e rateadas só dentro do segmento escolhido.

**Como usar nesta aba**
• Painel esquerdo: **Custos** — tudo que entra no custo operacional do produto/serviço.
• Painel direito: **Despesas** — estrutura e administração rateadas na precificação.
• Separe por segmento (produto acabado, mercadoria, serviço) para o rateio não misturar categorias diferentes.
• Custos + despesas entram na precificação; créditos tributários (aba Créditos) reduzem o custo efetivo depois.
`.trim();

export const STOCK_CATEGORY_HELP: Record<StockCategory, { title: string; body: string }> = {
  insumo: {
    title: `${STOCK_CATEGORY_LABELS.insumo} — como cadastrar`,
    body: `
**Valor e quantidade**
• **Valor (R$):** informe preço **unitário** (R$/un comprada) ou **total** pago na compra.
• **Qtd comprada (un):** número de embalagens/unidades adquiridas (ex.: 24 potes).

**Medida**
• Escolha a unidade (cm, m, L, ml, kg, g).
• **Unitária:** quantidade dentro de cada unidade comprada (ex.: 395 ml/un).
• **Total:** quantidade total de todas as unidades; o sistema calcula medida/un dividindo pelo número de unidades compradas.

**Resumo (cards abaixo dos campos)**
• **Medida/un** e **Quantidade total** (medida/un × qtd comprada).
• **Restante:** o que ainda não foi consumido nas composições (BOM) dos produtos acabados.
• **Valor restante (R$):** saldo em dinheiro após o uso na BOM.

**Uso na precificação**
• Insumos entram no custo dos **produtos acabados** quando vinculados na composição (receita).
`.trim(),
  },
  materia_prima: {
    title: `${STOCK_CATEGORY_LABELS.materia_prima} — como cadastrar`,
    body: `
**Valor e quantidade**
• **Valor (R$):** preço **unitário** ou **total** da compra.
• **Qtd comprada (un):** embalagens ou unidades adquiridas.

**Medida**
• Mesmas unidades do insumo (cm, m, L, ml, kg, g).
• **Unitária** ou **Total** — a quantidade total é sempre medida/un × qtd comprada.

**Resumo (cards)**
• Mostra medida/un, quantidade total, restante na BOM e valor restante em R$.
• Quando o item é usado em receitas, o **restante** diminui conforme as quantidades na composição.

**Uso na precificação**
• Matéria-prima alimenta o **custo material** dos produtos acabados via composição.
`.trim(),
  },
  produto_acabado: {
    title: `${STOCK_CATEGORY_LABELS.produto_acabado} — como cadastrar`,
    body: `
**Rendimento × vendas**
• **Rendimento (un./receita):** quantas unidades prontas a composição abaixo produz por lote (ex.: 7 pudins). Custo material/un. = total da receita ÷ 7.
• **Qtd/mês (vendas):** quantos você vende no mês (ex.: 200). O sistema consome insumos/MP do estoque em lotes de 7: 200 ÷ 7 ≈ 28,6 receitas × as quantidades da composição. Se faltar estoque, aparece o alerta vermelho.
• Se Qtd/mês ficar igual ao rendimento (ex.: 7 e 7), os custos gerais/un. ficam altos — use a estimativa real de vendas.

**Composição ou custo manual**
• **Composição:** vincule insumos/MP; custo material = soma da receita ÷ rendimento.
• **Custo manual:** informe R$/un. direto, sem BOM.
• **Embalagens:** cadastre **1 un. por produto final** na receita (ex.: 1 pote por pudim).

**Composição com quantidades altas**
• Deixe o multiplicador vazio, corrija cada linha da composição e salve — o sistema grava a receita ×1 automaticamente.

**Cards de custo (composição) — 3 cards**
• **Qtd. receita (rendimento):** quantas unidades a receita produz (ex.: 7 un.).
• **Custo material total (receita):** soma em R$ dos insumos/MP da composição para esse lote (fixo enquanto as linhas da receita não mudarem).
• **Custo material (1 un.):** total da receita ÷ rendimento (valor usado na precificação; só o rendimento altera este card, não o total).
`.trim(),
  },
  mercadoria: {
    title: `${STOCK_CATEGORY_LABELS.mercadoria} — como cadastrar`,
    body: `
**Compra para revenda**
• **Valor (R$):** preço **unitário** ou **total** pago.
• **Qtd comprada (un):** unidades em estoque para revenda.

**Resumo**
• **Qtd total (un)** e **Valor total (R$)** derivam de unitário × quantidade.
• O custo unitário na precificação usa esse valor por unidade vendida.

**Uso na precificação**
• Mercadorias entram no segmento **Mercadoria** (markup/margem e rateio próprios).
• Na tabela de precificação, o **valor de compra/un.** aparece em **Custos gerais (un.)** — é o custo original, antes do markup/margem.
`.trim(),
  },
};

export function stockCategoryHelpTitle(category: StockCategory): string {
  return STOCK_CATEGORY_HELP[category].title;
}

export function stockCategoryHelpBody(category: StockCategory): string {
  return STOCK_CATEGORY_HELP[category].body;
}

export const ROA_HELP_TITLE = 'ROA — rentabilidade por produto';

export const ROA_HELP_BODY = `
**O que é ROA nesta aba**
• ROA aqui mede quanto **lucro** cada produto gera em relação ao **custo total** da unidade.
• Fórmula: **ROA % = (Lucro por unidade ÷ Custo total) × 100**.
• Lucro por unidade = Preço de venda − Custo total (material + custos rateados + despesas rateadas − créditos).

**Como interpretar**
• ROA **15%** significa que, a cada R$ 100 de custo, o produto deixa R$ 15 de lucro por unidade vendida.
• Quanto **maior** o ROA, melhor a rentabilidade daquele item no mix.
• A tabela ordena do **menor para o maior** ROA — os primeiros são os que mais precisam de revisão (preço, custo ou volume).

**Destaques visuais**
• ROA abaixo de **15%** aparece em vermelho — margem apertada sobre o custo.
• O 1º da lista com ROA abaixo de **10%** ganha destaque — candidato prioritário a reajuste ou descontinuação.

**Diferença de margem e markup**
• **Margem** usa o preço como base: lucro ÷ preço.
• **ROA** usa o **custo** como base: lucro ÷ custo — útil para comparar qual produto “paga” melhor o capital imobilizado na operação.

**Como melhorar o ROA**
• Revisar preço na aba Precificação (markup/margem).
• Reduzir custo de material (BOM/estoque) ou rateio de custos/despesas do segmento.
• Aumentar volume mensal só melhora receita total; o ROA % muda quando preço ou custo unitário mudam.
`.trim();
