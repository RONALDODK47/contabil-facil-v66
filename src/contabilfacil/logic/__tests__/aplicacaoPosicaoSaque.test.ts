import { describe, expect, it } from 'vitest';
import { parseAplicacaoExtratoText, parsePosicaoSaque } from '../aplicacaoExtratoParser';

/**
 * Texto real do PDF "SICREDINVEST AUTOMATICO" (Depósito a Prazo - Detalhado,
 * competência 07/2026). O bloco usado para contabilizar é o "Posição para
 * Saque": a data da posição e os valores.
 */
const TEXTO_SICREDINVEST = `2026-08-14 02:09:47 Impresso em 057843 Conta Corrente: 3953Cooperativa: 
Associado: 
SINDICATO NACIONAL DOS SERVIDORES FEDERAIS DA EDUCACAO BASICA E
PROFISSIONAL
Incide IRRF e IOFTributação:
CDIIndexador:
SICREDINVEST AUTOMATICOProduto:
07/2026a07/2026Período de Consulta:
Extrato de Aplicação - Depósito a Prazo - Detalhado -
Consolidado
285,86   30/06/2026Rendimentos Provisionados:
383.078,39   30/06/2026Saldo Anterior:
Movimentações Tributação Rendimentos
Provisionados
Mês/Ano Aplicações Resgates Rendimentos
Pagos IRRF IOF No
Mês Acumulado Saldo
Atual
07/2026 470.164,64 446.078,12 483,73 104,26 19,98 576,96 379,09 407.524,40
Totais: 470.164,64 446.078,12 483,73 104,26 19,98
407.903,49Saldo Bruto - Base Taxa Máxima:
Posição para Saque
Posição em 31/07/2026 Valor (R$)
Saldo Atual 407.524,40
Rendimentos Provisionados 379,09
Sicredi Fone 3003 4770 (Capitais e Regiões Metropolitanas)
0800 724 4770 (Demais Regiões)
SAC 0800 724 7220
Ouvidoria 0800 646 2519
Saldo Bruto 407.903,49
Provisão IRRF 67,25
Provisão IOF 79,88
Líquido para Saque 407.756,36`;

describe('posição para saque (Sicredinvest / Depósito a Prazo)', () => {
  it('extrai a data e os valores do bloco Posição para Saque', () => {
    const posicao = parsePosicaoSaque(TEXTO_SICREDINVEST);
    expect(posicao).not.toBeNull();
    expect(posicao?.data).toBe('31/07/2026');
    expect(posicao).not.toHaveProperty('saldoAtual');
    expect(posicao?.rendimentosProvisionados).toBeCloseTo(379.09, 2);
    expect(posicao?.provisaoIRRF).toBeCloseTo(67.25, 2);
    expect(posicao?.provisaoIOF).toBeCloseTo(79.88, 2);
  });

  it('gera os lançamentos do período datados pela posição', () => {
    const result = parseAplicacaoExtratoText(TEXTO_SICREDINVEST);
    expect(result.layout).toBe('deposito_prazo');
    expect(result.posicaoSaque?.data).toBe('31/07/2026');
    // Este layout não entrega saldo: anterior e final são sempre digitados.
    expect(result.saldoAnterior).toBeNull();
    expect(result.saldoFinal).toBeNull();
    for (const row of result.rows) expect(row.saldo).toBeNull();

    const byHistorico = Object.fromEntries(result.rows.map((r) => [r.historico, r]));
    // Os totalizadores do mês não viram lançamento — cada aplicação e cada
    // resgate já entram pelo extrato da conta corrente, e lançá-los aqui
    // duplicaria a movimentação. Os valores continuam nos totais do resultado.
    expect(byHistorico['APLICAÇÕES NO PERÍODO']).toBeUndefined();
    expect(byHistorico['RESGATES NO PERÍODO']).toBeUndefined();
    expect(result.totalEntradas).toBeCloseTo(470164.64, 2);
    expect(result.totalSaidas).toBeCloseTo(446078.12, 2);
    expect(byHistorico['RENDIMENTOS PROVISIONADOS'].entrada).toBeCloseTo(379.09, 2);
    expect(byHistorico['PROVISÃO IRRF'].saida).toBeCloseTo(67.25, 2);
    expect(byHistorico['PROVISÃO IOF'].saida).toBeCloseTo(79.88, 2);
    for (const row of result.rows) expect(row.data).toBe('31/07/2026');
  });
});
