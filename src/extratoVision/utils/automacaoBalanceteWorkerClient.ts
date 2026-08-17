import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import type { LinhaComparativoMensal, PeriodoMensal } from './balanceteComparativoMensal';
import type { ProgressoAutomatizacao, ResultadoAutomatizacaoCompleta } from './balanceteAutomatizacaoCompleta';
import type { AutomacaoContaConfig } from './automatizacaoContaConfig';
import type { ReceitaFederalRegrasStore } from './receitaFederalRegras';
import type { FiscalContaMap } from './fiscalContaMapping';
import type { AutomacaoWorkerMessage, AutomacaoWorkerRequest } from './automacaoBalancete.worker';

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./automacaoBalancete.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

export function workerAutomacaoDisponivel(): boolean {
  return typeof Worker !== 'undefined';
}

export function executarAutomatizacaoNoWorker(params: {
  linhasComparativo: LinhaComparativoMensal[];
  periodos: PeriodoMensal[];
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  folhaRows: VisionBalanceteRow[];
  fiscalRows: VisionBalanceteRow[];
  fiscalContaMap: FiscalContaMap;
  contaConfig: AutomacaoContaConfig;
  receitaFederalStore: ReceitaFederalRegrasStore;
  empresaNome?: string;
  onProgress?: (p: ProgressoAutomatizacao) => void;
  signal?: AbortSignal;
}): Promise<{ resultado: ResultadoAutomatizacaoCompleta; lancamentosNovos: VisionBalanceteRow[] }> {
  const id = ++seq;
  const w = getWorker();

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const handler = (ev: MessageEvent<AutomacaoWorkerMessage>) => {
      if (ev.data.id !== id) return;
      if (ev.data.type === 'progress') {
        params.onProgress?.({
          fase: ev.data.fase,
          atual: ev.data.atual,
          total: ev.data.total,
          mensagem: ev.data.mensagem,
        });
        return;
      }
      cleanup();
      if (ev.data.type === 'done') {
        resolve({ resultado: ev.data.resultado, lancamentosNovos: ev.data.lancamentosNovos });
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

    const req: AutomacaoWorkerRequest = {
      id,
      linhasComparativo: params.linhasComparativo,
      periodos: params.periodos,
      razaoRows: params.razaoRows,
      planoRows: params.planoRows,
      folhaRows: params.folhaRows,
      fiscalRows: params.fiscalRows,
      fiscalContaMap: params.fiscalContaMap,
      contaConfig: params.contaConfig,
      receitaFederalStore: params.receitaFederalStore,
      empresaNome: params.empresaNome,
    };
    w.postMessage(req);
  });
}
