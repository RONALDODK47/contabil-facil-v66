const STORAGE_KEY = 'extratoVision_conciliacoes_v1';

/** Lançamento extraído + contas e texto de histórico (nome da operação p/ ERP/TXT Domínio) na conciliação linha a linha. */
export type SavedVisionConciliationLinha = {
  id: string;
  data: string;
  historico: string;
  valor: number;
  cd: string;
  contaDebito: string;
  contaCredito: string;
  /** Nome/descrição do lançamento contábil (ex.: «VALOR DE EMPRESTIMO») — vai no campo de histórico do TXT Domínio. */
  historicoOperacao: string;
};

export type SavedVisionConciliation = {
  id: string;
  savedAt: string;
  empresa: string;
  extratoDebits: number;
  extratoCredits: number;
  razaoDebitoTotal: number;
  razaoCreditoTotal: number;
  deltaDeb: number;
  deltaCred: number;
  movExtratoCount: number;
  linhasImportadasCount: number;
  arquivoExtratoNome?: string;
  /** Opcional: cópia das linhas do extrato com D/C e histórico de operação em texto preenchidos pelo utilizador. */
  detalhesPorLinha?: SavedVisionConciliationLinha[];
};

export type SavedVisionConciliationInput = Omit<SavedVisionConciliation, 'id' | 'savedAt'>;

function readAll(): SavedVisionConciliation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedVisionConciliation[]) : [];
  } catch {
    return [];
  }
}

export function appendVisionConciliation(input: SavedVisionConciliationInput): SavedVisionConciliation {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const row: SavedVisionConciliation = { ...input, id, savedAt: new Date().toISOString() };
  try {
    const next = [...readAll(), row];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn('extratoVision: falha ao salvar conciliação', e);
    throw e;
  }
  return row;
}
