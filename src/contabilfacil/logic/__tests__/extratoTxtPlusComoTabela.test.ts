/**
 * O TXT+ Domínio do extrato tem que sair EXATAMENTE como a conciliação está na
 * tabela: mesmas contas, mesma quantidade de linhas, sem nada decidindo o que
 * entra ou sai.
 *
 * Regressão: ao exportar vários extratos juntos, linhas conciliadas com um par
 * diferente do banco ativo saíam com a conta trocada ou sumiam do arquivo.
 */
import { describe, it, expect } from 'vitest';
import { buildTxtPlusFromExtratoRows, type ExtratoExportRow } from '../dominioTxtIO';
import { resolveExtratoRowContas } from '../extratoConciliacaoBank';

const BANCO_ATIVO = '1106';

/** Contas de cada linha do TXT: `data;deb;cred;valor;...` */
function contasDoTxt(txt: string): Array<{ deb: string; cred: string }> {
  return txt
    .split('\r\n')
    .filter(Boolean)
    .map((linha) => {
      const [, deb, cred] = linha.split(';');
      return { deb, cred };
    });
}

/** O que a tabela mostra nas colunas "Conta débito" / "Conta crédito". */
function contasDaTabela(rows: ExtratoExportRow[]): Array<{ deb: string; cred: string }> {
  return rows.map((r) => {
    const c = resolveExtratoRowContas({ ...r, id: '' });
    return { deb: c.accountDebit, cred: c.accountCredit };
  });
}

describe('buildTxtPlusFromExtratoRows — espelha a tabela de conciliação', () => {
  it('preserva as contas conciliadas mesmo quando nenhuma perna é o banco ativo', () => {
    // Linha conciliada entre duas contas que não são o banco ativo — típica de
    // um extrato salvo em pasta e exportado junto com outro.
    const rows: ExtratoExportRow[] = [
      {
        date: '05/05/2026',
        description: 'TRANSFERENCIA ENTRE CONTAS',
        value: -500,
        nature: 'D',
        accountDebit: '2201',
        accountCredit: '3302',
      },
    ];

    const contas = contasDoTxt(buildTxtPlusFromExtratoRows(rows, BANCO_ATIVO));

    expect(contas).toEqual([{ deb: '2201', cred: '3302' }]);
    expect(contas).toEqual(contasDaTabela(rows));
  });

  it('não descarta a linha quando a contrapartida é a própria conta banco', () => {
    // Antes esta linha voltava `null` e sumia do arquivo sem aviso.
    const rows: ExtratoExportRow[] = [
      {
        date: '06/05/2026',
        description: 'APLICACAO AUTOMATICA',
        value: 1000,
        nature: 'C',
        accountDebit: BANCO_ATIVO,
        accountCredit: BANCO_ATIVO,
      },
    ];

    const txt = buildTxtPlusFromExtratoRows(rows, BANCO_ATIVO);

    expect(txt.split('\r\n').filter(Boolean)).toHaveLength(1);
    expect(contasDoTxt(txt)).toEqual([{ deb: BANCO_ATIVO, cred: BANCO_ATIVO }]);
  });

  it('exporta uma linha por lançamento da tabela, sem perder nenhuma', () => {
    const rows: ExtratoExportRow[] = [
      { date: '01/05/2026', description: 'A', value: 100, nature: 'C', accountDebit: '1106', accountCredit: '4001' },
      { date: '02/05/2026', description: 'B', value: -200, nature: 'D', accountDebit: '5002', accountCredit: '1106' },
      { date: '03/06/2026', description: 'C', value: -300, nature: 'D', accountDebit: '2201', accountCredit: '3302' },
      { date: '04/07/2026', description: 'D', value: 400, nature: 'C', accountDebit: '9999', accountCredit: '8888' },
    ];

    const contas = contasDoTxt(buildTxtPlusFromExtratoRows(rows, BANCO_ATIVO));

    expect(contas).toHaveLength(rows.length);
    expect(contas).toEqual(contasDaTabela(rows));
  });

  it('completa apenas a perna vazia com o banco, sem sobrescrever a preenchida', () => {
    const rows: ExtratoExportRow[] = [
      // Entrada sem débito → banco entra no débito.
      { date: '07/05/2026', description: 'RECEBIMENTO', value: 50, nature: 'C', accountCredit: '4001' },
      // Saída sem crédito → banco entra no crédito.
      { date: '08/05/2026', description: 'PAGAMENTO', value: -60, nature: 'D', accountDebit: '5002' },
    ];

    expect(contasDoTxt(buildTxtPlusFromExtratoRows(rows, BANCO_ATIVO))).toEqual([
      { deb: BANCO_ATIVO, cred: '4001' },
      { deb: '5002', cred: BANCO_ATIVO },
    ]);
  });

  it('mantém os dois lançamentos quando são idênticos no mesmo dia', () => {
    const rows: ExtratoExportRow[] = [
      { date: '09/05/2026', description: 'TARIFA', value: -30, nature: 'D', accountDebit: '5002', accountCredit: '1106' },
      { date: '09/05/2026', description: 'TARIFA', value: -30, nature: 'D', accountDebit: '5002', accountCredit: '1106' },
    ];

    expect(buildTxtPlusFromExtratoRows(rows, BANCO_ATIVO).split('\r\n').filter(Boolean)).toHaveLength(2);
  });

  it('exporta saídas (valor negativo) com o valor absoluto', () => {
    const rows: ExtratoExportRow[] = [
      { date: '10/05/2026', description: 'PAGAMENTO', value: -1234.56, nature: 'D', accountDebit: '5002', accountCredit: '1106' },
    ];

    const [linha] = buildTxtPlusFromExtratoRows(rows, BANCO_ATIVO).split('\r\n');
    expect(linha.split(';')[3]).toBe('1234,56');
  });
});
