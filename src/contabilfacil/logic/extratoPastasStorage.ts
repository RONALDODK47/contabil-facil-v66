/**
 * Pastas de extratos conciliados — cada item ligado à conta banco.
 * Com STORAGE Postgres: metadata no PG + PDF no MinIO.
 * Sem servidor: fallback localStorage (comportamento offline).
 */
import { writePersistedLocalStorageJson, readPersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import { companyStorageSlug } from './companyWorkspace';
import { flushPersistenceAfterCriticalWrite } from './eyeVisionPersistenceFlush';
import { normContaBancoCode } from './extratoRegrasContasStorage';
import { readStoredCompanyAccessToken } from './eyeVisionAdmin';
import {
  apiListExtratoPastas,
  apiRemoveExtratoPasta,
  apiSaveExtratoPasta,
  isPostgresStorageClientEnabled,
  probeWorkspaceStorageHealth,
  type ExtratoPastaApiItem,
} from '../../gestaoContabil/dbClientPostgres';

export type ExtratoPastaRow = {
  id: string;
  date: string;
  description: string;
  value: number;
  nature: 'D' | 'C';
  accountCode?: string;
  accountDebit?: string;
  accountCredit?: string;
  operationName?: string;
  status?: 'CONCILIADO' | 'PENDENTE';
};

export type ExtratoPastaItem = {
  id: string;
  /** Código reduzido da conta banco a que o extrato pertence. */
  contaBanco: string;
  bancoNome: string;
  /** Rótulo exibido (ex.: Extrato Jun/2026). */
  label: string;
  createdAt: string;
  saldoAnterior: number;
  total: number;
  conciliadas: number;
  pendentes: number;
  rows: ExtratoPastaRow[];
  /** PDF conciliado em base64 (sem data: prefix). */
  pdfBase64?: string;
  pdfFilename?: string;
};

function metaKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_extrato_pastas_v1`;
}

function normalizeItem(x: ExtratoPastaItem): ExtratoPastaItem {
  const rows = Array.isArray(x.rows) ? x.rows : [];
  return {
    ...x,
    id: x.id || crypto.randomUUID(),
    contaBanco: String(x.contaBanco).trim(),
    bancoNome: String(x.bancoNome || '').trim(),
    label: String(x.label || 'Extrato').trim() || 'Extrato',
    createdAt: x.createdAt || new Date().toISOString(),
    saldoAnterior: Number(x.saldoAnterior) || 0,
    total: Number(x.total) || rows.length,
    conciliadas: Number(x.conciliadas) || 0,
    pendentes: Number(x.pendentes) || 0,
    rows,
    pdfBase64: x.pdfBase64,
    pdfFilename: x.pdfFilename,
  };
}

function loadAllLocal(company: string): ExtratoPastaItem[] {
  const raw = readPersistedLocalStorageJson<ExtratoPastaItem[]>(metaKey(company), []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === 'object' && Array.isArray(x.rows) && String(x.contaBanco || '').trim())
    .map(normalizeItem);
}

function saveAllLocal(company: string, items: ExtratoPastaItem[]): ExtratoPastaItem[] {
  try {
    writePersistedLocalStorageJson(metaKey(company), items);
    
    // Verificar que salvou corretamente
    const verify = readPersistedLocalStorageJson<ExtratoPastaItem[]>(metaKey(company), []);
    if (!Array.isArray(verify) || verify.length !== items.length) {
      console.error('[extratoPastasStorage] ⚠️  Falha ao salvar - verificação falhou');
      throw new Error('Falha ao salvar dados no localStorage');
    }
    
    console.log('[extratoPastasStorage] ✅ Dados salvos com sucesso:', items.length, 'itens');
    return items;
  } catch (err) {
    console.error('[extratoPastasStorage] ❌ Erro ao salvar:', err instanceof Error ? err.message : err);
    throw err;
  }
}

export function listExtratoPastas(company: string): ExtratoPastaItem[] {
  return loadAllLocal(company).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function apiItemToLocal(item: ExtratoPastaApiItem): ExtratoPastaItem {
  return {
    id: item.id,
    contaBanco: item.contaBanco,
    bancoNome: item.bancoNome,
    label: item.label,
    createdAt: item.createdAt,
    saldoAnterior: item.saldoAnterior,
    total: item.total,
    conciliadas: item.conciliadas,
    pendentes: item.pendentes,
    rows: item.rows as ExtratoPastaRow[],
    pdfBase64: item.pdfBase64,
    pdfFilename: item.pdfFilename,
  };
}

export async function syncExtratoPastasFromServer(company: string): Promise<ExtratoPastaItem[]> {
  try {
    // Tentar sincronizar com servidor via API
    const companyToken = readStoredCompanyAccessToken();
    if (!companyToken || !isPostgresStorageClientEnabled()) {
      console.log('[extratoPastasStorage] Servidor não disponível, usando dados locais');
      return listExtratoPastas(company);
    }

    const healthy = await probeWorkspaceStorageHealth();
    if (!healthy) {
      console.log('[extratoPastasStorage] ⚠️  Servidor não está saudável, usando dados locais');
      return listExtratoPastas(company);
    }

    // Buscar do servidor
    const serverItems = await apiListExtratoPastas(companyToken, companyStorageSlug(company));
    if (serverItems && Array.isArray(serverItems)) {
      console.log('[extratoPastasStorage] ✅ Sincronizado do servidor:', serverItems.length, 'itens');
      const localItems = serverItems.map(apiItemToLocal);
      // Salvar localmente também
      saveAllLocal(company, localItems);
      return localItems;
    }

    return listExtratoPastas(company);
  } catch (err) {
    console.warn('[extratoPastasStorage] Erro ao sincronizar do servidor:', err instanceof Error ? err.message : err);
    return listExtratoPastas(company);
  }
}

export function listExtratoPastasPorBanco(
  company: string,
  contaBanco: string,
): ExtratoPastaItem[] {
  const norm = normContaBancoCode(contaBanco);
  if (!norm) return listExtratoPastas(company);
  return listExtratoPastas(company).filter(
    (i) => normContaBancoCode(i.contaBanco) === norm,
  );
}

export function countExtratoPastas(company: string): number {
  return loadAllLocal(company).length;
}

export function clearExtratoPastasCache(company: string): void {
  writePersistedLocalStorageJson(metaKey(company), []);
}

export async function forceReloadExtratoPastas(company: string): Promise<ExtratoPastaItem[]> {
  return listExtratoPastas(company);
}

export function getExtratoPastaById(
  company: string,
  id: string,
): ExtratoPastaItem | null {
  return loadAllLocal(company).find((i) => i.id === id) ?? null;
}

function pastaAtivaKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_extrato_pasta_ativa_v1`;
}

/**
 * ID da pasta (extrato salvo) que o usuário abriu/salvou por último.
 * Usado para restaurar EXATAMENTE o mesmo extrato ao recarregar a página —
 * sem isso, o card de saldos podia mostrar dados acumulados/obsoletos da
 * chave bruta 'extrato' que não correspondiam a nenhum extrato salvo.
 */
export function getExtratoPastaAtivaId(company: string): string {
  return readPersistedLocalStorageJson<string>(pastaAtivaKey(company), '');
}

export function setExtratoPastaAtivaId(company: string, id: string): void {
  writePersistedLocalStorageJson(pastaAtivaKey(company), id);
}

export function clearExtratoPastaAtivaId(company: string): void {
  writePersistedLocalStorageJson(pastaAtivaKey(company), '');
}

export type SaveExtratoPastaInput = {
  contaBanco: string;
  bancoNome?: string;
  label?: string;
  saldoAnterior?: number;
  rows: ExtratoPastaRow[];
  pdfBase64?: string;
  pdfFilename?: string;
};

function defaultLabel(rows: ExtratoPastaRow[], createdAt: string): string {
  const dates = rows
    .map((r) => r.date)
    .filter(Boolean)
    .sort();
  const first = dates[0] || '';
  const last = dates[dates.length - 1] || '';
  const fmt = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };
  if (first && last && first !== last) return `Extrato ${fmt(first)} a ${fmt(last)}`;
  if (first) return `Extrato ${fmt(first)}`;
  const d = new Date(createdAt);
  return `Extrato ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export function saveExtratoNaPasta(
  company: string,
  input: SaveExtratoPastaInput,
): ExtratoPastaItem {
  const contaBanco = String(input.contaBanco || '').trim();
  if (!contaBanco) {
    throw new Error('Defina a conta banco do extrato antes de salvar na pasta.');
  }
  if (!input.rows.length) {
    throw new Error('Nenhum lançamento para salvar.');
  }

  const all = loadAllLocal(company);

  // Reutiliza o UUID existente quando o label+banco já existe — evita duplicatas.
  const label = (input.label || '').trim() || defaultLabel(input.rows, new Date().toISOString());
  const existing = all.find((e) => e.label === label && e.contaBanco === contaBanco);

  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const conciliadas = input.rows.filter(
    (r) => Boolean(r.accountDebit?.trim()) && Boolean(r.accountCredit?.trim()),
  ).length;

  const item: ExtratoPastaItem = {
    id: existing?.id ?? crypto.randomUUID(),
    contaBanco,
    bancoNome: (input.bancoNome || '').trim() || `Banco ${contaBanco}`,
    label,
    createdAt,
    saldoAnterior: Number(input.saldoAnterior) || 0,
    total: input.rows.length,
    conciliadas,
    pendentes: input.rows.length - conciliadas,
    rows: input.rows.map((r) => ({ ...r })),
    pdfBase64: input.pdfBase64,
    pdfFilename: input.pdfFilename,
  };

  if (existing) {
    const filtered = all.filter((e) => e.id !== existing.id);
    filtered.unshift(item);
    saveAllLocal(company, filtered.slice(0, 1000));
  } else {
    all.unshift(item);
    saveAllLocal(company, all.slice(0, 1000));
  }

  console.log(`[extratoPastas] Salvo "${item.label}" (${item.total} lanç., id=${item.id})`);
  return item;
}

export async function removeExtratoDaPasta(company: string, id: string): Promise<ExtratoPastaItem[]> {
  const next = loadAllLocal(company).filter((i) => i.id !== id);
  return saveAllLocal(company, next);
}

/**
 * Remove TODOS os extratos salvos de uma conta banco específica de uma vez —
 * útil para limpar registros com rótulo/conteúdo dessincronizados (salvos
 * antes da correção de "banco ativo" trocando sozinho entre contas).
 */
export async function removeExtratoPastasPorBanco(
  company: string,
  contaBanco: string,
): Promise<ExtratoPastaItem[]> {
  const norm = normContaBancoCode(contaBanco);
  const next = loadAllLocal(company).filter((i) => normContaBancoCode(i.contaBanco) !== norm);
  return saveAllLocal(company, next);
}

export function updateExtratoPastaLabel(
  company: string,
  id: string,
  newLabel: string,
): ExtratoPastaItem[] {
  const all = loadAllLocal(company);
  const item = all.find((i) => i.id === id);
  if (!item) return all;
  item.label = newLabel.trim();
  return saveAllLocal(company, all);
}

/**
 * Grava o saldo anterior digitado pelo usuário direto na pasta (extrato
 * salvo), não só na chave genérica "último valor da empresa" — sem isso, ao
 * trocar de extrato e voltar, o valor digitado se perdia e a pasta voltava a
 * mostrar o saldo anterior original (0 ou o sugerido na importação).
 */
export function updateExtratoPastaSaldoAnterior(
  company: string,
  id: string,
  saldoAnterior: number,
): ExtratoPastaItem[] {
  const all = loadAllLocal(company);
  const item = all.find((i) => i.id === id);
  if (!item) return all;
  item.saldoAnterior = Number(saldoAnterior) || 0;
  return saveAllLocal(company, all);
}

/**
 * Atualiza total/conciliadas/pendentes da pasta ativa em tempo real, à
 * medida que o usuário concilia lançamentos (define débito/crédito) — sem
 * isso, o card de "X não conciliados" ficava congelado no snapshot do
 * momento em que o extrato foi salvo pela última vez, mesmo depois do
 * usuário já ter conciliado tudo.
 */
export function updateExtratoPastaConciliacaoCounts(
  company: string,
  id: string,
  counts: { total: number; conciliadas: number; pendentes: number },
): ExtratoPastaItem[] {
  const all = loadAllLocal(company);
  const item = all.find((i) => i.id === id);
  if (!item) return all;
  item.total = counts.total;
  item.conciliadas = counts.conciliadas;
  item.pendentes = counts.pendentes;
  return saveAllLocal(company, all);
}

export function downloadExtratoPastaPdf(item: ExtratoPastaItem): void {
  if (!item.pdfBase64) {
    throw new Error('Este extrato não tem PDF salvo. Selecione-o e exporte o PDF de novo.');
  }
  const filename = item.pdfFilename || `extrato_${item.contaBanco}_${item.id.slice(0, 8)}.pdf`;
  const bin = atob(item.pdfBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Agrupa pastas por conta banco para a UI. */
export function groupExtratoPastasPorBanco(
  items: ExtratoPastaItem[],
): Array<{ contaBanco: string; bancoNome: string; items: ExtratoPastaItem[] }> {
  const map = new Map<string, { contaBanco: string; bancoNome: string; items: ExtratoPastaItem[] }>();
  for (const it of items) {
    const key = normContaBancoCode(it.contaBanco) || it.contaBanco;
    const cur = map.get(key);
    if (cur) {
      cur.items.push(it);
      if (!cur.bancoNome && it.bancoNome) cur.bancoNome = it.bancoNome;
    } else {
      map.set(key, {
        contaBanco: it.contaBanco,
        bancoNome: it.bancoNome,
        items: [it],
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.bancoNome.localeCompare(b.bancoNome, 'pt-BR') ||
    a.contaBanco.localeCompare(b.contaBanco),
  );
}
