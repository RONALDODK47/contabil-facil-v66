/**
 * Sistema de autosave para extratos.
 * Detecta mudanças e salva automaticamente no localStorage.
 */
import {
  saveExtratoNaPasta,
  type SaveExtratoPastaInput,
} from './extratoPastasStorage';
import { syncExtratoConciliacaoStatus } from './extratoConciliacaoBank';
import type { ExtratoBankRow } from './extratoConciliacaoBank';

export interface AutoSaveExtratoOptions {
  company: string;
  banco: string;
  bancoNome: string;
  lancamentos: ExtratoBankRow[];
  saldoAnterior: number;
  generatePdf?: boolean;
}

/**
 * Salva automaticamente um extrato completo no servidor.
 * Chamado quando o usuário faz mudanças significativas (edição de conciliação, etc).
 */
export async function autoSaveExtratoNaPasta(options: AutoSaveExtratoOptions): Promise<void> {
  const {
    company,
    banco,
    bancoNome,
    lancamentos,
    saldoAnterior,
    generatePdf = true,
  } = options;

  if (!banco.trim()) {
    console.warn('[autoSaveExtratoNaPasta] banco não definido, skipping autosave');
    return;
  }

  if (lancamentos.length === 0) {
    console.warn('[autoSaveExtratoNaPasta] nenhum lançamento, skipping autosave');
    return;
  }

  // O PDF nunca é persistido — só os dados que ele geraria (rows, saldo,
  // totais). `generatePdf` fica só por compatibilidade de assinatura.
  void generatePdf;

  // Data do primeiro e último lançamento
  const dates = lancamentos.map(r => r.date).filter(Boolean).sort();
  const first = dates[0] || '';
  const last = dates[dates.length - 1] || '';
  
  const fmt = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };

  let label = 'Extrato automático';
  if (first && last && first !== last) {
    label = `Extrato ${fmt(first)} a ${fmt(last)}`;
  } else if (first) {
    label = `Extrato ${fmt(first)}`;
  }

  try {
    saveExtratoNaPasta(company, {
      contaBanco: banco,
      bancoNome,
      label,
      saldoAnterior,
      rows: syncExtratoConciliacaoStatus(lancamentos).map((r) => ({
        id: r.id,
        date: r.date ?? '',
        description: r.description ?? '',
        value: r.value ?? 0,
        nature: (r.nature === 'C' ? 'C' : 'D') as 'D' | 'C',
        accountCode: r.accountCode,
        accountDebit: r.accountDebit,
        accountCredit: r.accountCredit,
        operationName: r.operationName,
        status: r.status,
      })),
    });

    console.log('[autoSaveExtratoNaPasta] extrato salvo automaticamente:', label);
  } catch (err) {
    console.error('[autoSaveExtratoNaPasta] erro:', err);
    // Não lança erro — autosave é silencioso
  }
}

/**
 * Cria um debounce para autosave.
 * Ideal para usar em useEffect com dependências.
 */
export function createAutoSaveDebounce(delayMs = 5000) {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastSaveTime = 0;

  return {
    /**
     * Agenda um autosave com debounce.
     */
    schedule: (fn: () => Promise<void>) => {
      if (timeoutId) clearTimeout(timeoutId);

      const now = Date.now();
      const timeSinceLastSave = now - lastSaveTime;

      if (timeSinceLastSave < delayMs) {
        // Agenda para depois
        timeoutId = setTimeout(() => {
          lastSaveTime = Date.now();
          void fn();
        }, delayMs - timeSinceLastSave);
      } else {
        // Executa imediatamente
        lastSaveTime = now;
        void fn();
      }
    },

    /**
     * Cancela o autosave pendente.
     */
    cancel: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
  };
}
