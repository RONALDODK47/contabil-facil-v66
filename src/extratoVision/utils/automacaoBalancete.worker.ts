import { executarAutomatizacaoCompleta } from './balanceteAutomatizacaoCompleta';
import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import type { LinhaComparativoMensal, PeriodoMensal } from './balanceteComparativoMensal';
import type { AutomacaoContaConfig } from './automatizacaoContaConfig';
import type { ReceitaFederalRegrasStore } from './receitaFederalRegras';
import type { FiscalContaMap } from './fiscalContaMapping';
import type { ResultadoAutomatizacaoCompleta } from './balanceteAutomatizacaoCompleta';

export type AutomacaoWorkerRequest = {
  id: number;
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
};

export type AutomacaoWorkerMessage =
  | { id: number; type: 'progress'; fase: 'folha_fiscal' | 'banco' | 'final'; atual: number; total: number; mensagem: string }
  | {
      id: number;
      type: 'done';
      resultado: ResultadoAutomatizacaoCompleta;
      /** Só os lançamentos novos — o razão completo é montado na thread principal. */
      lancamentosNovos: VisionBalanceteRow[];
    }
  | { id: number; type: 'error'; message: string };

self.onmessage = (ev: MessageEvent<AutomacaoWorkerRequest>) => {
  const {
    id,
    linhasComparativo,
    periodos,
    razaoRows,
    planoRows,
    folhaRows,
    fiscalRows,
    fiscalContaMap,
    contaConfig,
    receitaFederalStore,
    empresaNome,
  } = ev.data;
  try {
    const resultado = executarAutomatizacaoCompleta({
      linhasComparativo,
      periodos,
      razaoRows,
      planoRows,
      folhaRows,
      fiscalRows,
      fiscalContaMap,
      contaConfig,
      receitaFederalStore,
      empresaNome,
      onProgress: (p) => {
        const msg: AutomacaoWorkerMessage = {
          id,
          type: 'progress',
          fase: p.fase,
          atual: p.atual,
          total: p.total,
          mensagem: p.mensagem,
        };
        self.postMessage(msg);
      },
    });
    const done: AutomacaoWorkerMessage = {
      id,
      type: 'done',
      resultado,
      lancamentosNovos: resultado.lancamentosGerados,
    };
    self.postMessage(done);
  } catch (e) {
    const err: AutomacaoWorkerMessage = {
      id,
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
    self.postMessage(err);
  }
};
