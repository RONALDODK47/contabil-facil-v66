/**
 * Memória persistente do processo de geração de regras (por empresa + banco).
 * Evita a IA “esquecer” regras já criadas entre fases.
 */
import { safeLocalStorageGetItem, safeLocalStorageSetItem, safeLocalStorageRemoveItem } from '../../lib/safeLocalStorage';
import { companyStorageSlug } from './companyWorkspace';

export type RegrasIaMemoriaFase = {
  fase: string;
  at: string;
  regrasCriadas: number;
  resumo: string;
};

export type RegrasIaProcessMemory = {
  updatedAt: string;
  company: string;
  banco: string;
  fases: RegrasIaMemoriaFase[];
  /** Últimas regras válidas geradas (descrição + natureza + contrapartida). */
  regrasSnapshot: Array<{
    descricao: string;
    nature: 'D' | 'C';
    contaContrapartida: string;
  }>;
};

const MAX_FASES = 24;
const MAX_SNAPSHOT = 400;

function storageKey(company: string, banco: string): string {
  const b = String(banco || '').replace(/\D/g, '') || '0';
  return `contabilfacil_${companyStorageSlug(company)}_regras_ia_memoria_v1_${b}`;
}

export function loadRegrasIaProcessMemory(
  company: string,
  banco: string,
): RegrasIaProcessMemory | null {
  try {
    const raw = safeLocalStorageGetItem(storageKey(company, banco));
    if (!raw?.trim()) return null;
    const parsed = JSON.parse(raw) as RegrasIaProcessMemory;
    if (!parsed || parsed.company !== company) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function appendRegrasIaProcessMemory(
  company: string,
  banco: string,
  input: {
    fase: string;
    regrasCriadas?: number;
    resumo?: string;
    regras?: Array<{ descricao: string; nature: string; contaContrapartida: string }>;
  },
): RegrasIaProcessMemory {
  const prev = loadRegrasIaProcessMemory(company, banco);
  const fase: RegrasIaMemoriaFase = {
    fase: input.fase,
    at: new Date().toISOString(),
    regrasCriadas: input.regrasCriadas ?? 0,
    resumo: String(input.resumo ?? '').slice(0, 500),
  };

  const snapshotFromRegras =
    input.regras?.map((r) => ({
      descricao: r.descricao,
      nature: r.nature === 'C' ? ('C' as const) : ('D' as const),
      contaContrapartida: r.contaContrapartida,
    })) ?? [];

  const mergedSnapshot = [
    ...(prev?.regrasSnapshot ?? []),
    ...snapshotFromRegras,
  ].slice(-MAX_SNAPSHOT);

  const next: RegrasIaProcessMemory = {
    updatedAt: new Date().toISOString(),
    company,
    banco,
    fases: [...(prev?.fases ?? []), fase].slice(-MAX_FASES),
    regrasSnapshot: mergedSnapshot,
  };

  try {
    // ⚠️ DISABLED: Salva SOMENTE no Docker
    // safeLocalStorageSetItem(storageKey(company, banco), JSON.stringify(next));
  } catch {
    /* quota — memória é auxiliar */
  }
  return next;
}

/** Texto injetado na IA — regras já decididas neste processo. */
export function buildMemoriaContextoParaIa(memoria: RegrasIaProcessMemory | null): string {
  if (!memoria || memoria.regrasSnapshot.length === 0) return '';
  const lines: string[] = [
    '=== MEMÓRIA DO PROCESSO (NÃO ALTERE SEM MOTIVO — já validadas) ===',
    `Empresa: ${memoria.company} · Banco: ${memoria.banco}`,
    `Atualizado: ${memoria.updatedAt}`,
    '',
    'Regras já criadas/confirmadas neste processo (mantenha consistência):',
  ];
  const seen = new Set<string>();
  for (const r of memoria.regrasSnapshot) {
    const key = `${r.nature}|${r.descricao}|${r.contaContrapartida}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`· [${r.nature}] "${r.descricao}" → reduzido ${r.contaContrapartida}`);
    if (lines.length > 120) break;
  }
  if (memoria.fases.length > 0) {
    lines.push('', 'Fases concluídas:');
    for (const f of memoria.fases.slice(-8)) {
      lines.push(`· ${f.fase} (+${f.regrasCriadas}) — ${f.resumo || 'ok'}`);
    }
  }
  return lines.join('\n').slice(0, 14_000);
}

export function clearRegrasIaProcessMemory(company: string, banco: string): void {
  try {
    safeLocalStorageRemoveItem(storageKey(company, banco));
  } catch {
    /* ignore */
  }
}
