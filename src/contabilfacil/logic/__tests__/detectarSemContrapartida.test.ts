import { describe, expect, it } from 'vitest';
import { detectarLancamentosSemContrapartida } from '../dominioTxtIO';
import { parseDominioLancamentosTxt } from '../../../extratoVision/utils/dominioLancamentosTxt';
import type { VisionBalanceteRow } from '../../../extratoVision/types/accounting';

describe('detectarLancamentosSemContrapartida — mesma conta nos dois lados', () => {
  it('acusa como sem contrapartida um lançamento com contaDeb === contaCred (mesma ordem)', () => {
    const rows: VisionBalanceteRow[] = [
      {
        codigo: '0001096',
        contaDeb: '0001096',
        contaCred: '0001096',
        nome: 'Pix Enviado',
        data: '26/01/2026',
        ordem: 86,
        saldoInicial: 0,
        debito: 500,
        credito: 500,
        saldoFinal: 0,
      },
    ];
    const semPar = detectarLancamentosSemContrapartida(rows);
    expect(semPar.length).toBe(1);
  });

  it('não acusa quando as contas realmente diferem', () => {
    const rows: VisionBalanceteRow[] = [
      {
        codigo: '0001096',
        contaDeb: '0001096',
        contaCred: '0000180',
        nome: 'Pagamento fornecedor',
        data: '26/01/2026',
        ordem: 90,
        saldoInicial: 0,
        debito: 500,
        credito: 0,
        saldoFinal: 0,
      },
      {
        codigo: '0000180',
        contaDeb: '0001096',
        contaCred: '0000180',
        nome: 'Pagamento fornecedor',
        data: '26/01/2026',
        ordem: 90,
        saldoInicial: 0,
        debito: 0,
        credito: 500,
        saldoFinal: 0,
      },
    ];
    const semPar = detectarLancamentosSemContrapartida(rows);
    expect(semPar.length).toBe(0);
  });
});

describe('parseDominioLancamentosTxt — layout Domínio 01/02/03 com colunas de conta iguais', () => {
  it('não gera contaDeb === contaCred quando o TXT traz o mesmo código nas duas colunas', () => {
    // Linha "03" fictícia: posições 9-16 (contaDeb) e 16-23 (contaCred) ambas "0001096".
    // Layout mínimo: '03' + seq(7) + contaDeb(7) + contaCred(7) + resto até >=45 chars.
    const seq = '0000086';
    const contaDebCol = '0001096';
    const contaCredCol = '0001096';
    const resto = 'X'.repeat(45 - (2 + 7 + 7 + 7));
    const linha03 = `03${seq}${contaDebCol}${contaCredCol}${resto}`;
    const linha02 = `0226012026`;
    const txt = `${linha02}\n${linha03}\n`;

    const rows = parseDominioLancamentosTxt(txt);
    const comAmbasContas = rows.filter((r) => r.contaDeb && r.contaCred);
    expect(comAmbasContas.every((r) => r.contaDeb !== r.contaCred)).toBe(true);
  });
});
