import { GoogleGenAI } from '@google/genai';
import { AIVisionSettings, Transaction } from '../types';
import { buildLearnedCorrectionsPromptBlock } from './aiVisionLearning';

const BASE_PROMPT = `Você está lendo UMA PÁGINA de um extrato bancário, digitalizada como imagem (o PDF
original não tem texto selecionável — é 100% imagem, então você precisa "olhar" e ler tudo).

O extrato pode ser de QUALQUER banco/cooperativa (Sicredi, Banco do Brasil, Bradesco, Itaú,
Santander, Nubank, Caixa, Sicoob etc) e o layout de colunas varia — normalmente é algo como
Data | Descrição/Histórico | Documento | Valor (R$) | Saldo (R$), mas pode ter menos ou mais
colunas, ou ordem diferente. Identifique a tabela pelo que ela representa, não por um layout fixo.

COMPLETUDE (REGRA MAIS IMPORTANTE DE TODAS):
- Percorra a tabela LINHA POR LINHA, do topo até o FIM da página — NÃO pule, NÃO resuma e
  NÃO agrupe linhas. Cada linha de lançamento vira exatamente UM objeto na resposta.
- Uma página pode ter MUITOS lançamentos (30, 50 ou mais) — continue até a ÚLTIMA linha da
  tabela, inclusive as linhas coladas no rodapé da página.
- Lançamentos repetidos (mesma data, mesmo valor, mesma descrição) SÃO lançamentos distintos
  — devolva todos, nunca deduplicar.
- Valores pequenos (tarifas, IOF, rendimentos de centavos) também contam — não ignore.
- Antes de responder, RECONFIRA visualmente: o número de objetos devolvidos deve ser IGUAL ao
  número de linhas de lançamento visíveis na tabela. Se sobrou linha sem objeto, adicione.

REGRAS PARA IDENTIFICAR CRÉDITO x DÉBITO (cd) — nem todo extrato marca isso do mesmo jeito, use
a que se aplicar, na ordem de confiança:
1. Se a linha tem letra "C" ou "D" explícita numa coluna de indicador → use ela.
2. Se o valor tem sinal "-" na frente, ou está entre parênteses "(1.234,56)", ou está em
   vermelho → é DÉBITO. Sem sinal (ou com "+") → CRÉDITO.
3. Se não houver nem sinal nem indicador, mas HOUVER coluna de Saldo: compare o saldo desta
   linha com o saldo da linha anterior — se o saldo AUMENTOU, é crédito; se DIMINUIU, é débito.
4. Se ainda assim ficar ambíguo, use a descrição como última pista: palavras como "recebido",
   "recebida", "crédito", "depósito", "entrada" → crédito; "enviado", "enviada", "débito",
   "pagamento", "saída", "tarifa", "compra" → débito.

REGRAS PARA A DATA:
- Formato de saída sempre DD/MM/AAAA.
- Se uma linha não repetir a data (extratos costumam só imprimir a data na primeira transação
  do dia e deixar em branco nas linhas seguintes do mesmo dia), REPITA a última data válida lida
  até aqui na página — nunca invente uma data diferente.
- Se a página começar no MEIO de um dia (as primeiras linhas não trazem data e NENHUMA data
  apareceu ainda nesta página), devolva "data" como string vazia "" nessas linhas iniciais — o
  sistema preenche automaticamente com a última data da página anterior. NUNCA invente uma data.
- Se o ano não aparecer na página, mas aparecer em outro lugar da página (cabeçalho/período do
  extrato), use esse ano.

REGRAS PARA O HISTÓRICO (MUITO IMPORTANTE):
- Use a descrição impressa da linha, na íntegra (não resuma, não traduza abreviações do banco).
- Se existir uma ANOTAÇÃO ESCRITA À MÃO (caneta, lápis, marca-texto, qualquer cor) perto dessa
  linha — geralmente uma categoria/observação curta (ex: "Aluguel", "Advogado", "Zelador",
  "Repasse", "combustível") — LEIA essa anotação com a maior atenção possível, mesmo que a letra
  seja cursiva/difícil, e junte ao final do histórico impresso separado por " - ".
  Nunca ignore uma anotação manuscrita só porque é difícil de ler: faça sua MELHOR leitura
  possível em vez de omitir.
- Cada anotação manuscrita pertence à linha mais próxima dela verticalmente — preste atenção
  para não colar a anotação de uma linha na linha vizinha errada.
- Se não houver anotação manuscrita nessa linha, use só a descrição impressa.

REGRAS PARA O VALOR (PRECISÃO DE DÍGITOS):
- Leia o valor dígito a dígito — não "arredonde" nem complete de memória. 1.234,56 ≠ 1.234,58.
- Não confunda o VALOR do lançamento com o SALDO da linha: quando houver dois números na
  linha, o saldo costuma ser o da coluna mais à direita — o lançamento é o outro.
- Se um dígito estiver ilegível, use o contexto do saldo (saldo anterior ± valor = saldo da
  linha) para confirmar o número antes de responder.

O QUE IGNORAR (não são lançamentos): cabeçalho da página, nome/dados da conta, "SALDO ANTERIOR"
sem valor de movimento, "SALDO DO DIA"/subtotal/total de entradas ou saídas (a menos que sejam a
ÚNICA forma de saber o valor movimentado naquele grupo), rodapés, textos de atendimento/SAC/
ouvidoria, numeração de página.

Para CADA linha de lançamento real, devolva um objeto com:
- "data": DD/MM/AAAA
- "historico": descrição impressa + anotação manuscrita (se houver), como descrito acima
- "valor": número decimal POSITIVO (sem sinal, sem "R$", ponto como separador decimal)
- "cd": "C" (crédito/entrada) ou "D" (débito/saída)
- "documento": texto da coluna de documento/número, se existir nessa linha (senão omita o campo)

Se a página não tiver nenhum lançamento (só cabeçalho/rodapé), devolva um array vazio.`;

const AI_ROW_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      data: { type: 'string', description: 'Data no formato DD/MM/AAAA, ou "" se nenhuma data apareceu ainda na página' },
      historico: { type: 'string', description: 'Descrição impressa + anotação manuscrita, se houver' },
      valor: { type: 'number', description: 'Valor absoluto (positivo) do lançamento' },
      cd: { type: 'string', enum: ['C', 'D'], description: 'C para crédito/entrada, D para débito/saída' },
      documento: { type: 'string', description: 'Número/código do documento, se existir' },
    },
    required: ['data', 'historico', 'valor', 'cd'],
  },
};

interface AIRow {
  data?: string;
  historico?: string;
  valor?: number | string;
  cd?: string;
  documento?: string;
}

const parseAIValue = (v: number | string | undefined): number => {
  if (typeof v === 'number') return Math.abs(v);
  if (!v) return 0;
  const cleaned = String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.abs(n);
};

/**
 * Envia a imagem de UMA página (dataURL "data:image/png;base64,...") para o modelo de IA com
 * visão configurado, pedindo para ler a tabela impressa + as anotações escritas à mão, e
 * devolve os lançamentos já prontos (Transaction[]).
 *
 * `previousPageLastDate` dá continuidade entre páginas: em vários bancos a data só é reimpressa
 * na primeira transação do dia, então se a página começar sem repetir a data, a IA sabe qual foi
 * a última válida da página anterior.
 *
 * `dateRange` é o período informado pelo usuário (DD/MM/AAAA) — instrui a IA a extrair TODOS os
 * lançamentos dentro do intervalo, sem "escolher" só um dos meses quando o PDF cobre vários.
 */
export const extractTransactionsFromPageImage = async (
  pageImageDataUrl: string,
  settings: AIVisionSettings,
  pageNum: number,
  previousPageLastDate?: string,
  dateRange?: { from?: string; to?: string },
): Promise<Transaction[]> => {
  const apiKey = (settings.apiKeys[settings.provider] || '').trim();
  if (!apiKey) {
    throw new Error(`Nenhuma chave de API configurada para o provedor "${settings.provider}". Configure em "Usar IA para converter".`);
  }

  if (settings.provider !== 'gemini') {
    throw new Error(`Provedor de IA "${settings.provider}" ainda não suportado.`);
  }

  const base64 = pageImageDataUrl.split(',')[1] || pageImageDataUrl;
  // O mime real vem do próprio dataURL (as páginas de PDF são geradas como JPEG) — declarar o
  // tipo errado força o modelo a re-detectar o formato e pode degradar a decodificação.
  const mimeType = /^data:(image\/[a-z0-9+.-]+);base64,/i.exec(pageImageDataUrl)?.[1] || 'image/jpeg';

  let prompt = BASE_PROMPT;
  if (previousPageLastDate) {
    prompt += `\n\nCONTEXTO DA PÁGINA ANTERIOR: a última data válida lida na página anterior foi ${previousPageLastDate}. Se a primeira linha desta página não repetir a data, use essa como ponto de partida.`;
  }
  if (dateRange && (dateRange.from || dateRange.to)) {
    const de = dateRange.from || 'o início do extrato';
    const ate = dateRange.to || 'o fim do extrato';
    prompt += `\n\nPERÍODO SOLICITADO PELO USUÁRIO: extraia TODOS os lançamentos de ${de} até ${ate} (inclusive). O extrato pode cobrir mais de um mês — NÃO escolha apenas um mês: leia a página inteira e devolva TODA transação cuja data esteja dentro desse período. Lançamentos claramente FORA do período podem ser omitidos.`;
  }
  prompt += buildLearnedCorrectionsPromptBlock();

  // Usa a Interactions API (client.interactions.create) — a antiga models.generateContent()
  // está depreciada e alguns modelos antigos (gemini-2.x) não são mais atendidos direito por
  // ela, o que fazia a IA falhar de forma confusa mesmo com uma chave de API válida.
  const ai = new GoogleGenAI({ apiKey });
  const callModel = () => ai.interactions.create({
    model: settings.modelId,
    input: [
      { type: 'text', text: prompt },
      { type: 'image', data: base64, mime_type: mimeType },
    ],
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: AI_ROW_SCHEMA,
    },
  });

  // Retry único com espera curta: com páginas sendo lidas em paralelo, um erro transitório de
  // cota/rede (ex: 429) numa página é comum e não deve derrubar a extração dela.
  let interaction: Awaited<ReturnType<typeof callModel>>;
  try {
    interaction = await callModel();
  } catch {
    await new Promise(r => setTimeout(r, 2500));
    interaction = await callModel();
  }

  if (interaction.status === 'failed' || interaction.status === 'cancelled') {
    throw new Error(`A IA retornou "${interaction.status}" na página ${pageNum}.`);
  }

  const text = (interaction.output_text || '').trim();
  if (!text) {
    throw new Error(`A IA não retornou nenhum texto para a página ${pageNum} (status: ${interaction.status}).`);
  }

  let rows: AIRow[] = [];
  try {
    const cleaned = text.replace(/^```json\s*|^```\s*|```$/g, '').trim();
    const parsed = JSON.parse(cleaned);
    rows = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    throw new Error(`Não foi possível interpretar a resposta da IA para a página ${pageNum}: ${(e as Error).message}`);
  }

  return rows
    // "data" pode vir vazia de propósito (página que começa no meio de um dia) — quem preenche
    // é a propagação entre páginas no chamador. Só descartamos linha sem histórico.
    .filter(r => r && r.historico)
    .map((r, idx): Transaction => {
      const cd: 'C' | 'D' = (r.cd || '').toUpperCase().startsWith('D') ? 'D' : 'C';
      return {
        id: `ai-p${pageNum}-${idx}`,
        data: (r.data || '').trim(),
        historico: (r.historico || '').trim(),
        valor: parseAIValue(r.valor),
        cd,
        documento: r.documento ? String(r.documento).trim() : undefined,
      };
    });
};
