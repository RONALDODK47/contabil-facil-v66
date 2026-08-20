import { describe, it, expect } from 'vitest';
import { celulaFromRowFast, celulaMensalInvertida } from '../balanceteComparativoMensal';
import { formatNaturezaConta, isContaRedutoraPL } from '../naturezaContabil';
import type { VisionBalanceteRow } from '../../types/accounting';

function row(codigo: string, cls: string, nome: string, deb: number, cred: number): VisionBalanceteRow {
  return {
    codigo,
    classificacao: cls,
    nome,
    saldoInicial: 0,
    debito: deb,
    credito: cred,
    saldoFinal: deb - cred,
  } as VisionBalanceteRow;
}

function linhaDe(r: VisionBalanceteRow, tipo: 'S' | 'A') {
  return {
    codigo: r.codigo,
    classificacao: r.classificacao ?? '',
    nome: r.nome,
    tipo,
    naturezaCodigo: formatNaturezaConta(r, [r]).codigo,
  };
}

describe('celulaMensalInvertida — vermelho do Balancete', () => {
  it('receita com mês devedor NÃO é inversão (devolução/estorno)', () => {
    const r = row('10', '3.1.1.01.0001', 'RECEITA DE VENDAS', 5000, 0);
    const cel = celulaFromRowFast(r, [r]);
    expect(cel.natureza).toBe('D');
    expect(celulaMensalInvertida(cel, linhaDe(r, 'A'))).toBe(false);
  });

  it('conta de natureza ambígua com saldo devedor NÃO é inversão', () => {
    const r = row('90', '2.3.4.01.0001', 'LUCROS OU PREJUIZOS ACUMULADOS', 8000, 0);
    const cel = celulaFromRowFast(r, [r]);
    expect(cel.natureza).toBe('D');
    expect(celulaMensalInvertida(cel, linhaDe(r, 'A'))).toBe(false);
  });

  it('caixa (Ativo) com saldo credor continua sendo inversão', () => {
    const r = row('5', '1.1.1.01.0001', 'CAIXA GERAL', 0, 1500);
    const cel = celulaFromRowFast(r, [r]);
    expect(celulaMensalInvertida(cel, linhaDe(r, 'A'))).toBe(true);
  });

  it('sintética patrimonial com saldo do lado errado continua vermelha', () => {
    const r = { ...row('1', '1.1', 'ATIVO CIRCULANTE', 0, 2000), tipo: 'S' as const };
    const cel = celulaFromRowFast(r, [r]);
    const linha = { ...linhaDe(r, 'S'), naturezaCodigo: 'D' as const };
    // O motor não avalia sintética — quem sustenta o destaque é o fallback.
    expect(cel.invertido).toBe(false);
    expect(celulaMensalInvertida(cel, linha)).toBe(true);
  });

  it('sintética de resultado com mês do lado oposto NÃO é vermelha', () => {
    const r = { ...row('3', '3.1', 'RECEITA OPERACIONAL', 2000, 0), tipo: 'S' as const };
    const cel = celulaFromRowFast(r, [r]);
    const linha = { ...linhaDe(r, 'S'), naturezaCodigo: 'C' as const };
    expect(celulaMensalInvertida(cel, linha)).toBe(false);
  });

  it('célula irrelevante (valor < 0,01) nunca é vermelha', () => {
    expect(celulaMensalInvertida({ valor: 0, natureza: 'C', texto: '—' }, { codigo: '5', classificacao: '1.1.1', nome: 'CAIXA', tipo: 'A', naturezaCodigo: 'D' })).toBe(false);
  });
});

describe('sinal "(-)" manda na natureza da conta', () => {
  it('"(-) DÉFICITS DO EXERCÍCIO" (PL) é retificadora: natureza devedora', () => {
    const r = row('523', '2.3.3.01.00005', '(-) DEFICITS DO EXERCICIO', 0, 51387.9);
    expect(isContaRedutoraPL(r, [r])).toBe(true);
    expect(formatNaturezaConta(r, [r]).codigo).toBe('D');
    // Retificadora com saldo do lado oposto ao seu (credor) É inversão: a natureza
    // esperada dela já vem invertida, então não há motivo para isentá-la.
    const cel = celulaFromRowFast(r, [r]);
    expect(cel.natureza).toBe('C');
    expect(celulaMensalInvertida(cel, linhaDe(r, 'A'))).toBe(true);
  });

  it('redutora do PL com saldo do SEU lado (devedor) não é acusada', () => {
    const r = row('525', '2.3.2.04.00001', 'ADIANTAMENTO DE LUCROS', 12000, 0);
    expect(isContaRedutoraPL(r, [r])).toBe(true);
    expect(formatNaturezaConta(r, [r]).codigo).toBe('D');
    expect(celulaMensalInvertida(celulaFromRowFast(r, [r]), linhaDe(r, 'A'))).toBe(false);
  });

  it('conta do PL SEM "(-)" e sem ambiguidade continua acusada quando inverte', () => {
    const r = row('520', '2.3.1.01.00001', 'CAPITAL SOCIAL SUBSCRITO', 90000, 0);
    expect(isContaRedutoraPL(r, [r])).toBe(false);
    expect(formatNaturezaConta(r, [r]).codigo).toBe('C');
    const cel = celulaFromRowFast(r, [r]);
    expect(cel.natureza).toBe('D');
    expect(celulaMensalInvertida(cel, linhaDe(r, 'A'))).toBe(true);
  });

  it('"SUPERÁVITS DO EXERCÍCIO" tem lado definido (credor): saldo devedor é inversão', () => {
    const sup = row('522', '2.3.3.01.00004', 'SUPERAVITS DO EXERCICIO', 110130.94, 0);
    expect(formatNaturezaConta(sup, [sup]).codigo).toBe('C');
    expect(celulaMensalInvertida(celulaFromRowFast(sup, [sup]), linhaDe(sup, 'A'))).toBe(true);
  });

  it('conta única "SUPERÁVIT/DÉFICIT DO EXERCÍCIO" continua ambígua', () => {
    const r = row('530', '2.3.3.01.00009', 'SUPERAVIT/DEFICIT DO EXERCICIO', 4000, 0);
    expect(celulaMensalInvertida(celulaFromRowFast(r, [r]), linhaDe(r, 'A'))).toBe(false);
  });

  it('"(-)" com traço unicode e no fim do nome também vale', () => {
    const r = row('524', '2.3.3.01.00006', 'REDUCAO DE CAPITAL (–)', 4000, 0);
    expect(isContaRedutoraPL(r, [r])).toBe(true);
    expect(formatNaturezaConta(r, [r]).codigo).toBe('D');
  });
});
