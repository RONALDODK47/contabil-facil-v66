import { format, lastDayOfMonth } from 'date-fns';
import type { SavedAplicacao } from './aplicacaoStorage';
import {
  coletarLancamentosAplicacao,
  cronogramaAplicacao,
  fromSavedAplicacaoLike,
  previewValoresPorLinhaAplicacao,
  type AplicacaoExportInput,
} from '../../lib/aplicacoesDominioExport';
import { parseCurrency } from '../../lib/simTabFields';

export type AplicacaoLancamentoTipo = 'APLICACAO' | 'JUROS' | 'IRRF' | 'IOF' | 'OUTRO';

export interface AplicacaoLancamentoDisplay {
  id: string;
  date: string;
  historico: string;
  tipo: AplicacaoLancamentoTipo;
  valor: number;
  debito?: string;
  credito?: string;
}

function mapHistoricoTipo(historico: string): AplicacaoLancamentoTipo {
  const h = historico.toUpperCase();
  if (h.includes('JUROS')) return 'JUROS';
  if (h.includes('IRRF')) return 'IRRF';
  if (h.includes('IOF')) return 'IOF';
  if (h.includes('APLICACAO')) return 'APLICACAO';
  return 'OUTRO';
}

export function enrichAplicacaoExportInput(app: SavedAplicacao): AplicacaoExportInput {
  const inp = fromSavedAplicacaoLike(app);

  if (!inp.temReceitaJuros && parseCurrency(app.valorReceitaJurosMensalStr ?? '0') > 0) {
    inp.temReceitaJuros = true;
  }
  if (!inp.temIRRF && parseCurrency(app.valorIRRFStr ?? '0') > 0) {
    inp.temIRRF = true;
  }
  if (!inp.temIOF && parseCurrency(app.valorIOFStr ?? '0') > 0) {
    inp.temIOF = true;
  }

  return inp;
}

function pushUnique(rows: AplicacaoLancamentoDisplay[], row: AplicacaoLancamentoDisplay) {
  const key = `${row.date}|${row.historico}|${row.valor}|${row.debito ?? ''}|${row.credito ?? ''}`;
  if (rows.some((r) => `${r.date}|${r.historico}|${r.valor}|${r.debito ?? ''}|${r.credito ?? ''}` === key)) {
    return;
  }
  rows.push(row);
}

export function buildAplicacaoLancamentosDisplay(app: SavedAplicacao): AplicacaoLancamentoDisplay[] {
  const inp = enrichAplicacaoExportInput(app);
  const cron = cronogramaAplicacao(inp, parseCurrency);
  const rows: AplicacaoLancamentoDisplay[] = [];

  for (const lanc of coletarLancamentosAplicacao(inp, parseCurrency, cron)) {
    pushUnique(rows, {
      id: `${app.id}-${rows.length}`,
      date: format(lanc.date, 'yyyy-MM-dd'),
      historico: lanc.historico,
      tipo: mapHistoricoTipo(lanc.historico),
      valor: lanc.value,
      debito: lanc.debContaStr || undefined,
      credito: lanc.credContaStr || undefined,
    });
  }

  if (cron.length > 0) {
    const previews = previewValoresPorLinhaAplicacao(inp, cron, parseCurrency);
    cron.forEach((linha, index) => {
      const preview = previews[index];
      const refDate = format(lastDayOfMonth(linha.date), 'yyyy-MM-dd');

      if (inp.temReceitaJuros && preview.juros > 0 && !rows.some((r) => r.tipo === 'JUROS' && r.date === refDate && r.valor === preview.juros)) {
        pushUnique(rows, {
          id: `${app.id}-juros-${index}`,
          date: refDate,
          historico: 'RECEITA DE JUROS APLICACAO',
          tipo: 'JUROS',
          valor: preview.juros,
          debito: inp.accReceitaJurosDebit,
          credito: inp.accReceitaJurosCredit,
        });
      }

      if (inp.temIOF && preview.iof > 0 && !rows.some((r) => r.tipo === 'IOF' && r.valor === preview.iof)) {
        pushUnique(rows, {
          id: `${app.id}-iof-${index}`,
          date: format(linha.date, 'yyyy-MM-dd'),
          historico: 'IOF APLICACAO',
          tipo: 'IOF',
          valor: preview.iof,
          debito: inp.accIOFDebit,
          credito: inp.accIOFCredit,
        });
      }

      if (inp.temIRRF && preview.irrf > 0 && !rows.some((r) => r.tipo === 'IRRF' && r.valor === preview.irrf)) {
        pushUnique(rows, {
          id: `${app.id}-irrf-${index}`,
          date: format(linha.date, 'yyyy-MM-dd'),
          historico: 'IRRF APLICACAO',
          tipo: 'IRRF',
          valor: preview.irrf,
          debito: inp.accIRRFDebit,
          credito: inp.accIRRFCredit,
        });
      }
    });
  }

  if (rows.length === 0 && parseCurrency(app.valorParcelaStr) > 0) {
    rows.push({
      id: `${app.id}-principal`,
      date: app.dataInicioPrimeiraParcelaStr,
      historico: 'APLICACAO FINANCEIRA',
      tipo: 'APLICACAO',
      valor: parseCurrency(app.valorParcelaStr),
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.historico.localeCompare(b.historico));
}

export function summarizeAplicacaoLancamentos(rows: AplicacaoLancamentoDisplay[]) {
  const sumByTipo = (tipo: AplicacaoLancamentoTipo) =>
    rows.filter((r) => r.tipo === tipo).reduce((acc, r) => acc + r.valor, 0);

  return {
    juros: sumByTipo('JUROS'),
    irrf: sumByTipo('IRRF'),
    iof: sumByTipo('IOF'),
    aplicacao: sumByTipo('APLICACAO'),
    total: rows.reduce((acc, r) => acc + r.valor, 0),
  };
}
