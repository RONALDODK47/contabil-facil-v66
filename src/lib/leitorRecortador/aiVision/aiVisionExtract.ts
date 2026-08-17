import type { LeitorColumnDef } from '../types';
import type { AIVisionRawRow, AIVisionSettings } from './types';

const EXTRATO_RULES = `
REGRAS PARA IDENTIFICAR CRÉDITO x DÉBITO — nem todo extrato marca isso do mesmo jeito, use a que
se aplicar, na ordem de confiança:
1. Se a linha tem letra "C" ou "D" explícita numa coluna de indicador → use ela.
2. Se o valor tem sinal "-" na frente, ou está entre parênteses "(1.234,56)", ou está em
   vermelho → é DÉBITO (valor negativo). Sem sinal (ou com "+") → CRÉDITO (valor positivo).
3. Se não houver nem sinal nem indicador, mas HOUVER coluna de Saldo: compare o saldo desta linha
   com o saldo da linha anterior — se o saldo AUMENTOU, é crédito; se DIMINUIU, é débito.
Coloque o resultado já no campo de valor, como número no formato brasileiro (ex: "1234,56" para
crédito, "-1234,56" para débito).

REGRAS PARA A DATA:
- Formato de saída sempre DD/MM/AAAA.
- Se uma linha não repetir a data (extratos costumam só imprimir a data na primeira transação do
  dia e deixar em branco nas linhas seguintes do mesmo dia), REPITA a última data válida lida até
  aqui na página — nunca deixe a data vazia nem invente uma data diferente.

REGRAS PARA O HISTÓRICO:
- Use a descrição impressa da linha, na íntegra (não resuma, não traduza abreviações do banco).
- Se existir uma ANOTAÇÃO ESCRITA À MÃO perto dessa linha, leia com atenção e junte ao final do
  histórico impresso separado por " - ". Nunca ignore uma anotação manuscrita só porque é difícil
  de ler: faça sua MELHOR leitura possível em vez de omitir.
`;

function buildPrompt(columnDefs: LeitorColumnDef[], isExtrato: boolean, previousContext?: string): string {
  const colunas = columnDefs.map((c) => `- "${c.id}": ${c.name}`).join('\n');
  let prompt = `Você está lendo UMA PÁGINA de um documento contábil digitalizado como imagem (pode
ser um PDF escaneado, sem texto selecionável — então você precisa "olhar" e ler tudo).

Extraia cada linha de lançamento/registro real da tabela impressa nesta página. Ignore cabeçalhos,
rodapés, totais/subtotais (a menos que sejam a única forma de saber um valor) e textos que não
sejam linhas de dados.

Devolva um objeto JSON com uma chave "linhas": um array onde cada item é um objeto com
exatamente estas colunas (todas como texto):
${colunas}

Se a página não tiver nenhuma linha de dados, devolva {"linhas": []}.`;

  if (isExtrato) prompt += `\n${EXTRATO_RULES}`;
  if (previousContext) {
    prompt += `\n\nCONTEXTO DA PÁGINA ANTERIOR: ${previousContext}`;
  }
  return prompt;
}

/**
 * Schema envolvido em objeto (`{ linhas: [...] }`) em vez de array na raiz —
 * saída estruturada costuma rejeitar ou ignorar silenciosamente um schema
 * cujo tipo raiz é "array" (comportamento observado: interação retorna texto
 * vazio ou uma lista vazia mesmo com dados válidos na imagem).
 */
function buildSchema(columnDefs: LeitorColumnDef[]) {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const c of columnDefs) {
    properties[c.id] = { type: 'string', description: c.name };
  }
  return {
    type: 'object',
    properties: {
      linhas: {
        type: 'array',
        items: {
          type: 'object',
          properties,
          required: columnDefs.map((c) => c.id),
        },
      },
    },
    required: ['linhas'],
  };
}

/**
 * Envia a imagem de UMA página (dataURL "data:image/png;base64,...") para o Gemini configurado,
 * pedindo as linhas da tabela já prontas nas colunas do `dataType` atual.
 */
export async function extractRowsFromPageImage(
  pageImageDataUrl: string,
  settings: AIVisionSettings,
  columnDefs: LeitorColumnDef[],
  pageNum: number,
  options?: { isExtrato?: boolean; previousContext?: string },
): Promise<AIVisionRawRow[]> {
  const apiKey = (settings.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('Nenhuma chave de API configurada. Abra a aba "Configuração IA" e cole sua chave do Gemini.');
  }
  if (!settings.modelId) {
    throw new Error('Nenhum modelo de IA selecionado. Abra a aba "Configuração IA".');
  }

  const base64 = pageImageDataUrl.split(',')[1] || pageImageDataUrl;
  const prompt = buildPrompt(columnDefs, !!options?.isExtrato, options?.previousContext);
  const schema = buildSchema(columnDefs);

  // Import dinâmico: @google/genai só deve entrar no bundle quando o motor OCR IA é usado.
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const interaction = await ai.interactions.create({
    model: settings.modelId,
    input: [
      { type: 'text', text: prompt },
      { type: 'image', data: base64, mime_type: 'image/png' },
    ],
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema,
    },
  });

  if (interaction.status === 'failed' || interaction.status === 'cancelled') {
    throw new Error(`A IA retornou "${interaction.status}" na página ${pageNum}.`);
  }

  const text = (interaction.output_text || '').trim();
  if (!text) {
    throw new Error(`A IA não retornou nenhum texto para a página ${pageNum} (status: ${interaction.status}).`);
  }

  try {
    const cleaned = text.replace(/^```json\s*|^```\s*|```$/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.linhas)) return parsed.linhas;
    return [];
  } catch (e) {
    throw new Error(`Não foi possível interpretar a resposta da IA para a página ${pageNum}: ${(e as Error).message}`);
  }
}
