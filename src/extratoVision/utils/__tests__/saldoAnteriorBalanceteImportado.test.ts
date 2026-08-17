import { describe, it, expect } from 'vitest';
import {
  filtrarRazaoPorPeriodo,
  montarBalanceteComPeriodo,
} from '../razaoContabil';
import type { VisionBalanceteRow, VisionPlanoRow } from '../../types/accounting';

/**
 * Balancete PDF do Domínio (relatório "Balancete") não traz coluna de
 * CLASSIFICAÇÃO — só CÓDIGO (reduzido), Descrição, Saldo Anterior, Débito,
 * Crédito e Saldo Atual. Por isso as linhas "SALDO ANTERIOR" importadas chegam
 * com `classificacao` = código reduzido (ex.: "1065"), enquanto as linhas do
 * razão já casaram com o plano e usam a classificação real
 * ("1.1.1.02.00003"). O saldo anterior só aparece se as duas grafias caírem na
 * mesma chave de conta.
 */
describe('saldo anterior de balancete importado (PDF Domínio sem coluna de classificação)', () => {
  const planoRows: VisionPlanoRow[] = [
    { codigo: '1.1.1.02.00003', nome: 'BANCO SICREDI- AG:3953 CC: 51673-2', codigoReduzido: '1065', tipo: 'A', nivel: 5 },
  ];

  // Valores reais do Balancete.pdf 06/2026 (SINDICATO NACIONAL ...).
  const linhaSaldoAnterior: VisionBalanceteRow = {
    id: 'dom-sa-1065',
    codigo: '1065',
    classificacao: '1065',
    nome: 'SALDO ANTERIOR',
    data: '01/06/2026',
    saldoInicial: 5077.49,
    naturezaSaldoInicial: 'D',
    debito: 0,
    credito: 0,
    saldoFinal: 0,
    tipo: 'A',
    nivel: 5,
  };

  const lancamentoDoRazao: VisionBalanceteRow = {
    id: 'raz-1',
    codigo: '1065',
    classificacao: '1.1.1.02.00003',
    nome: 'PIX RECEBIDO CLIENTE',
    data: '15/06/2026',
    saldoInicial: 0,
    debito: 947858.11,
    credito: 948187.06,
    saldoFinal: 0,
    tipo: 'A',
    nivel: 5,
  };

  it('leva o saldo anterior do PDF para a conta do razão', () => {
    const todas = [linhaSaldoAnterior, lancamentoDoRazao];
    const noPeriodo = filtrarRazaoPorPeriodo(todas, '01/06/2026', '30/06/2026');

    const balancete = montarBalanceteComPeriodo(
      todas,
      noPeriodo,
      planoRows,
      '01/06/2026',
      '30/06/2026',
    );

    const conta = balancete.find((r) => r.classificacao === '1.1.1.02.00003');
    expect(conta).toBeDefined();
    expect(conta!.saldoInicial).toBeCloseTo(5077.49, 2);
    expect(conta!.naturezaSaldoInicial).toBe('D');
  });

  it('mantém o saldo atual do PDF (anterior + D − C)', () => {
    const todas = [linhaSaldoAnterior, lancamentoDoRazao];
    const noPeriodo = filtrarRazaoPorPeriodo(todas, '01/06/2026', '30/06/2026');

    const balancete = montarBalanceteComPeriodo(
      todas,
      noPeriodo,
      planoRows,
      '01/06/2026',
      '30/06/2026',
    );

    const conta = balancete.find((r) => r.classificacao === '1.1.1.02.00003')!;
    const si = conta.naturezaSaldoInicial === 'C' ? -conta.saldoInicial : conta.saldoInicial;
    // Saldo Atual do PDF: 4.748,54 D
    expect(si + conta.debito - conta.credito).toBeCloseTo(4748.54, 2);
  });
});
