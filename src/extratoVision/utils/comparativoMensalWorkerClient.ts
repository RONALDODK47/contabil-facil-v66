import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import type { LinhaComparativoMensal, PeriodoMensal } from './balanceteComparativoMensal';
import type { ComparativoWorkerMessage, ComparativoWorkerRequest } from './comparativoMensal.worker';
import type { NaturezaManualEntry } from './naturezaManualConfig';

/** A partir deste volume, o comparativo roda em Web Worker (não trava a tela). */
const RAZAO_WORKER_MIN = 250;

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./comparativoMensal.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

export function deveUsarWorkerComparativo(razaoCount: number, mesCount = 0): boolean {
  return razaoCount >= RAZAO_WORKER_MIN || mesCount > 2;
}

export function montarComparativoNoWorker(params: {
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  periodos: PeriodoMensal[];
  dataDe?: string;
  dataAte?: string;
  somenteComMovimento: boolean;
  incluirPlanoCompleto: boolean;
  naturezaManualEntries?: NaturezaManualEntry[];
  onProgress?: (mes: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<{ periodos: PeriodoMensal[]; linhas: LinhaComparativoMensal[] }> {
  const id = ++seq;
  const w = getWorker();

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const handler = (ev: MessageEvent<ComparativoWorkerMessage>) => {
      if (ev.data.id !== id) return;
      if (ev.data.type === 'progress') {
        params.onProgress?.(ev.data.mes, ev.data.total);
        return;
      }
      cleanup();
      if (ev.data.type === 'done') {
        resolve({ periodos: ev.data.periodos, linhas: ev.data.linhas });
      } else {
        reject(new Error(ev.data.message));
      }
    };

    const cleanup = () => {
      w.removeEventListener('message', handler);
      params.signal?.removeEventListener('abort', onAbort);
    };

    w.addEventListener('message', handler);
    params.signal?.addEventListener('abort', onAbort, { once: true });

    const req: ComparativoWorkerRequest = {
      id,
      razaoRows: params.razaoRows,
      planoRows: params.planoRows,
      periodos: params.periodos,
      dataDe: params.dataDe,
      dataAte: params.dataAte,
      somenteComMovimento: params.somenteComMovimento,
      incluirPlanoCompleto: params.incluirPlanoCompleto,
      naturezaManualEntries: params.naturezaManualEntries,
      /** JSON reduz custo de structured clone com dezenas de milhares de lançamentos. */
      razaoRowsJson: JSON.stringify(params.razaoRows),
      planoRowsJson: JSON.stringify(params.planoRows),
    };
    w.postMessage(req);
  });
}
