import { writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import { safeLocalStorageGetItem } from '../../lib/safeLocalStorage';
import { companyStorageSlug } from './companyWorkspace';
import { generateUUID } from '../../lib/uuid';

/**
 * "Pasta de layouts de aplicações aprendidos" — versão client-side (sem depender do
 * servidor FastAPI local usado em OcrSearchablePdfModal). Guarda, por empresa, uma
 * impressão digital (fingerprint) do cabeçalho/estrutura do PDF de aplicação já
 * importado, associada ao nome da conta/produto — para reconhecer automaticamente
 * o mesmo layout em uma próxima importação, sem precisar de backend.
 *
 * Os 3 PDFs de amostra do Sicredi (Invest Exclusivo, Poupança Integrada,
 * Sicredinvest Automático) servem como exemplo: basta importar cada um uma vez
 * usando o parser; o layout fica salvo aqui e passa a ser reconhecido nas próximas
 * importações do mesmo produto.
 */

export type AplicacaoLayoutAprendido = {
  id: string;
  nome: string;
  /** Fingerprint simples do texto (produto + primeiras palavras do cabeçalho, normalizado). */
  fingerprint: string;
  layout: 'movimento' | 'deposito_prazo' | 'desconhecido';
  contaAplicacao: string;
  criadoEm: string;
  atualizadoEm: string;
};

function storageKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_aplicacao_layouts_aprendidos_v1`;
}

/** Gera um fingerprint estável a partir do texto extraído (cabeçalho + palavras-chave do produto). */
export function fingerprintAplicacaoTexto(text: string): string {
  const norm = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Usa o produto + as primeiras ~200 chars normalizadas do topo do documento como
  // assinatura — suficiente para diferenciar os 3 layouts Sicredi sem exigir hash
  // criptográfico (não há necessidade de robustez adversarial aqui).
  const produtoMatch = norm.match(/PRODUTO[:\s]+([A-Z0-9 ]+)/);
  const produto = produtoMatch ? produtoMatch[1].trim().slice(0, 40) : '';
  const cabecalho = norm.slice(0, 200);
  return `${produto}::${cabecalho}`.slice(0, 260);
}

export function loadAplicacaoLayoutsAprendidos(company: string): AplicacaoLayoutAprendido[] {
  try {
    const raw = safeLocalStorageGetItem(storageKey(company));
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AplicacaoLayoutAprendido[]) : [];
  } catch {
    return [];
  }
}

function saveAll(company: string, layouts: AplicacaoLayoutAprendido[]): AplicacaoLayoutAprendido[] {
  writePersistedLocalStorageJson(storageKey(company), layouts);
  return layouts;
}

/** Procura um layout já aprendido cujo fingerprint bate com o texto informado. */
export function findAplicacaoLayoutAprendido(
  company: string,
  text: string,
): AplicacaoLayoutAprendido | null {
  const fp = fingerprintAplicacaoTexto(text);
  const all = loadAplicacaoLayoutsAprendidos(company);
  // Match exato primeiro; senão, match pelo prefixo "produto" (antes de "::").
  const exact = all.find((l) => l.fingerprint === fp);
  if (exact) return exact;
  const produto = fp.split('::')[0];
  if (!produto) return null;
  return all.find((l) => l.fingerprint.startsWith(`${produto}::`)) ?? null;
}

/** Salva/atualiza (ensina) um layout a partir de uma importação bem-sucedida. */
export function ensinarAplicacaoLayout(
  company: string,
  params: { nome: string; text: string; layout: AplicacaoLayoutAprendido['layout']; contaAplicacao: string },
): AplicacaoLayoutAprendido[] {
  const fingerprint = fingerprintAplicacaoTexto(params.text);
  const all = loadAplicacaoLayoutsAprendidos(company);
  const now = new Date().toISOString();
  const idx = all.findIndex((l) => l.fingerprint === fingerprint);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...params, fingerprint, atualizadoEm: now };
  } else {
    all.push({
      id: generateUUID(),
      nome: params.nome,
      fingerprint,
      layout: params.layout,
      contaAplicacao: params.contaAplicacao,
      criadoEm: now,
      atualizadoEm: now,
    });
  }
  return saveAll(company, all);
}

export function removerAplicacaoLayout(company: string, id: string): AplicacaoLayoutAprendido[] {
  const all = loadAplicacaoLayoutsAprendidos(company).filter((l) => l.id !== id);
  return saveAll(company, all);
}
