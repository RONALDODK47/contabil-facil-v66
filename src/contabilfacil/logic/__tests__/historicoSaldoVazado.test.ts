import { describe, it, expect } from 'vitest';
import type { VisionBalanceteRow } from '../../../extratoVision/types/accounting';
import { buildTxtPlusFromRazaoVision } from '../dominioTxtIO';

/**
 * Na leitura do extrato o saldo devedor do dia vazava para o fim do histórico
 * ("... RODRIGO RODRIGUES DA S -687,90") e ia parar assim no TXT+ Domínio.
 * Casos reais do Balancete_VIVER_SPORTS.txt.
 */
const CASOS: Array<[string, string]> = [
  ['PAGAMENTO PIX 01852649135 RODRIGO RODRIGUES DA S -687,90', 'PAGAMENTO PIX 01852649135 RODRIGO RODRIGUES DA S'],
  ['RECEBIMENTO PIX 01094069159 ALEXANDRE FAGUNDES D -549,90', 'RECEBIMENTO PIX 01094069159 ALEXANDRE FAGUNDES D'],
  ['PAGAMENTO PIX 01644375176 NATALIA MACEDO NUNES -961,80', 'PAGAMENTO PIX 01644375176 NATALIA MACEDO NUNES'],
  ['RECEBIMENTO PIX 00961135107 DIUCLEBER RIBEIRO DE -997,19', 'RECEBIMENTO PIX 00961135107 DIUCLEBER RIBEIRO DE'],
  ['RECEBIMENTO PIX 00935965106 MARCIO DA CUNHA PINH -251,34', 'RECEBIMENTO PIX 00935965106 MARCIO DA CUNHA PINH'],
  ['SAQUE DINHEIRO ATM -26,34', 'SAQUE DINHEIRO ATM'],
];

function linhaTxt(historico: string): string {
  const rows: VisionBalanceteRow[] = [
    {
      codigo: '1069', classificacao: '', nome: historico, data: '13/05/2026', ordem: 1,
      saldoInicial: 0, debito: 250, credito: 0, saldoFinal: 0, contaDeb: '1069', contaCred: '8',
    } as VisionBalanceteRow,
  ];
  return buildTxtPlusFromRazaoVision(rows).trim();
}

describe('histórico do TXT+ Domínio — saldo vazado do extrato', () => {
  it.each(CASOS)('limpa o saldo colado no fim: %s', (sujo, limpo) => {
    expect(linhaTxt(sujo).split(';')[5]).toBe(limpo);
  });

  it('preserva valor legítimo no fim do histórico (sem sinal)', () => {
    expect(linhaTxt('PAGAMENTO NF 1234 1.500,00').split(';')[5]).toBe('PAGAMENTO NF 1234 1.500,00');
  });

  it('não esvazia histórico que é só um saldo', () => {
    expect(linhaTxt('-687,90').split(';')[5]).toBe('-687,90');
  });

  it('limpa saldos encadeados', () => {
    expect(linhaTxt('SAQUE DINHEIRO ATM -26,34 -47,19').split(';')[5]).toBe('SAQUE DINHEIRO ATM');
  });
});
