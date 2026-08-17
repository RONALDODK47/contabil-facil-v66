import { montarComparativoMensalOtimizado, type PeriodoMensal } from './balanceteComparativoMensal';
import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import type { NaturezaManualEntry } from './naturezaManualConfig';

export type ComparativoWorkerRequest = {
  id: number;
  razaoRows?: VisionBalanceteRow[];
  planoRows?: VisionPlanoRow[];
  razaoRowsJson?: string;
  planoRowsJson?: string;
  periodos: PeriodoMensal[];
  dataDe?: string;
  dataAte?: string;
  somenteComMovimento: boolean;
  incluirPlanoCompleto: boolean;
  naturezaManualEntries?: NaturezaManualEntry[];
};

export type ComparativoWorkerMessage =
  | { id: number; type: 'progress'; mes: number; total: number }
  | { id: number; type: 'done'; periodos: PeriodoMensal[]; linhas: import('./balanceteComparativoMensal').LinhaComparativoMensal[] }
  | { id: number; type: 'error'; message: string };

self.onmessage = (ev: MessageEvent<ComparativoWorkerRequest>) => {
  const {
    id,
    periodos,
    dataDe,
    dataAte,
    somenteComMovimento,
    incluirPlanoCompleto,
    razaoRowsJson,
    planoRowsJson,
    naturezaManualEntries,
  } = ev.data;
  const razaoRows: VisionBalanceteRow[] = razaoRowsJson
    ? (JSON.parse(razaoRowsJson) as VisionBalanceteRow[])
    : (ev.data.razaoRows ?? []);
  const planoRows: VisionPlanoRow[] = planoRowsJson
    ? (JSON.parse(planoRowsJson) as VisionPlanoRow[])
    : (ev.data.planoRows ?? []);
  try {
    const result = montarComparativoMensalOtimizado({
      razaoRows,
      planoRows,
      periodos,
      dataDe,
      dataAte,
      somenteComMovimento,
      incluirPlanoCompleto,
      naturezaManualEntries,
      onProgress: (mes, total) => {
        const msg: ComparativoWorkerMessage = { id, type: 'progress', mes, total };
        self.postMessage(msg);
      },
    });
    const done: ComparativoWorkerMessage = {
      id,
      type: 'done',
      periodos: result.periodos,
      linhas: result.linhas,
    };
    self.postMessage(done);
  } catch (e) {
    const err: ComparativoWorkerMessage = {
      id,
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
    self.postMessage(err);
  }
};
