/** Configuração de IA (Gemini) para o motor "OCR IA" do leitor-recortador. */

export type AIVisionSettings = {
  apiKey: string;
  modelId: string;
  /** true somente depois de uma sincronização de modelos bem-sucedida com essa chave — o
   * motor "OCR IA" nunca roda (nem mostra "carregando") enquanto isto não for true. */
  validated?: boolean;
};

export type AIVisionModelOption = {
  id: string;
  label: string;
  description: string;
  tier: 'free' | 'paid';
};

/** Linha crua devolvida pela IA — chaves = ids das colunas do dataType atual. */
export type AIVisionRawRow = Record<string, string | number | undefined>;
