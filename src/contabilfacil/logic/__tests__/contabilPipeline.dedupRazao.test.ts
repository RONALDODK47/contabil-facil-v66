import { describe, it, expect } from 'vitest';
import { removerDuplicatasCodigoInconsistente } from '../contabilPipeline';
import type { VisionBalanceteRow } from '../../../extratoVision/types/accounting';

function row(over: Partial<VisionBalanceteRow>): VisionBalanceteRow {
  return {
    codigo: '8',
    nome: 'LANCAMENTO',
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
    ...over,
  };
}

describe('removerDuplicatasCodigoInconsistente (8 vs 0000008)', () => {
  it('remove a duplicata quando o mesmo lançamento aparece com "8" e "0000008"', () => {
    const rows: VisionBalanceteRow[] = [
      row({ codigo: '0000008', data: '13/03/2026', credito: 243.07, nome: 'DEB.CONV.SANEAMENTO BND' }),
      row({ codigo: '8', data: '13/03/2026', credito: 243.07, nome: 'DÉB.CONV.SANEAMENTO DOC.: EMBASA BND' }),
    ];
    const out = removerDuplicatasCodigoInconsistente(rows);
    expect(out.length).toBe(1);
    expect(out[0]!.codigo).toBe('0000008');
  });

  it('mantém as duas linhas quando os valores são diferentes (não é duplicata)', () => {
    const rows: VisionBalanceteRow[] = [
      row({ codigo: '0000008', data: '02/01/2026', credito: 11.36, nome: 'DEB.IOF' }),
      row({ codigo: '0000008', data: '02/01/2026', credito: 1.24, nome: 'DEB.IOF' }),
    ];
    const out = removerDuplicatasCodigoInconsistente(rows);
    expect(out.length).toBe(2);
  });

  it('mantém as duas linhas quando o código está no MESMO formato nas duas (repetição real, não duplicata de import)', () => {
    const rows: VisionBalanceteRow[] = [
      row({ codigo: '8', data: '10/03/2026', credito: 50, nome: 'TARIFA A' }),
      row({ codigo: '8', data: '10/03/2026', credito: 50, nome: 'TARIFA B' }),
    ];
    const out = removerDuplicatasCodigoInconsistente(rows);
    expect(out.length).toBe(2);
  });

  it('remove duplicata de linha de débito também (não só crédito)', () => {
    const rows: VisionBalanceteRow[] = [
      row({ codigo: '0000008', data: '19/03/2026', debito: 3480, nome: 'PIX RECEB | INSTITUTO' }),
      row({ codigo: '8', data: '19/03/2026', debito: 3480, nome: 'PIX RECEB INSTITUTO DOC.: PIX' }),
    ];
    const out = removerDuplicatasCodigoInconsistente(rows);
    expect(out.length).toBe(1);
    expect(out[0]!.codigo).toBe('0000008');
  });

  it('não mexe em contas diferentes mesmo com mesmo valor/data', () => {
    const rows: VisionBalanceteRow[] = [
      row({ codigo: '0000008', data: '05/03/2026', debito: 100, nome: 'A' }),
      row({ codigo: '0000006', data: '05/03/2026', debito: 100, nome: 'B' }),
    ];
    const out = removerDuplicatasCodigoInconsistente(rows);
    expect(out.length).toBe(2);
  });
});
