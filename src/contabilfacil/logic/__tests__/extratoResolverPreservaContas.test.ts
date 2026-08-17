/**
 * O resolver de contas do extrato NÃO pode re-adivinhar linha já conciliada.
 *
 * Regressão: abrir um extrato salvo (ou a reaplicação automática em background)
 * passava todas as linhas pelo resolver. Quando uma regra casava com o
 * histórico, ele impunha as contas da regra por cima da conciliação gravada; e
 * quando o par gravado estava incompleto, descartava os dois lados e deixava só
 * a perna do banco. O extrato reaberto — e o TXT+ gerado dele — não batia mais
 * com o que tinha sido conciliado.
 */
import { describe, it, expect } from 'vitest';
import {
  applyExtratoContaResolver,
  type ExtratoContaPlanoLike,
  type ExtratoRowComContas,
} from '../extratoContaResolver';
import type { ExtratoRegraConta } from '../extratoRegrasContasStorage';

const BANCO = '1106';

const plano: ExtratoContaPlanoLike[] = [
  { code: '1106', name: 'BANCO CAIXA', codigoReduzido: '1106', tipo: 'A' },
  { code: '4001', name: 'RECEITA DE SERVICOS', codigoReduzido: '4001', tipo: 'A' },
  { code: '5002', name: 'DESPESA GERAL', codigoReduzido: '5002', tipo: 'A' },
  { code: '2201', name: 'FORNECEDORES', codigoReduzido: '2201', tipo: 'A' },
  { code: '3302', name: 'OUTRAS CONTAS', codigoReduzido: '3302', tipo: 'A' },
];

// Regra que casa com o histórico das linhas abaixo e aponta para OUTRA conta —
// é ela que sequestrava a conciliação salva.
const regras: ExtratoRegraConta[] = [
  {
    id: 'r1',
    nome: 'PIX RECEBIDO',
    descricao: 'PIX RECEBIDO',
    nature: 'C',
    contaBanco: BANCO,
    contaContrapartida: '4001',
  },
];

const opcoes = {
  contaBancoPreferida: BANCO,
  regrasContas: regras,
  preservarContasExistentes: true,
};

const rodar = (rows: ExtratoRowComContas[], preservar = true) =>
  applyExtratoContaResolver(
    rows,
    plano,
    {},
    preservar ? opcoes : { contaBancoPreferida: BANCO, regrasContas: regras },
  ).rows;

describe('applyExtratoContaResolver — preservarContasExistentes', () => {
  it('não mexe na linha já conciliada, mesmo com regra casando o histórico', () => {
    const rows: ExtratoRowComContas[] = [
      {
        id: '1',
        description: 'PIX RECEBIDO',
        nature: 'C',
        accountDebit: BANCO,
        accountCredit: '3302', // conciliado à mão, diferente da regra (4001)
      },
    ];

    const [out] = rodar(rows);

    expect(out.accountDebit).toBe(BANCO);
    expect(out.accountCredit).toBe('3302');
  });

  it('preserva o par conciliado quando nenhuma perna é a conta banco', () => {
    const rows: ExtratoRowComContas[] = [
      { id: '2', description: 'TRANSFERENCIA', nature: 'D', accountDebit: '2201', accountCredit: '3302' },
    ];

    const [out] = rodar(rows);

    expect(out.accountDebit).toBe('2201');
    expect(out.accountCredit).toBe('3302');
  });

  it('NÃO fabrica conciliação a partir de linha incompleta', () => {
    // Resto de palpite antigo: só um lado gravado, sem regra que case.
    // A preservação não pode "completar" isso com a conta banco e fazer a linha
    // passar por conciliada — foi o que sujou a tabela com contas que o usuário
    // nunca escolheu.
    const rows: ExtratoRowComContas[] = [
      { id: '3', description: 'PAGAMENTO AVULSO', nature: 'D', accountDebit: '', accountCredit: '12' },
    ];

    const [out] = rodar(rows);

    const fechada = Boolean((out.accountDebit || '').trim() && (out.accountCredit || '').trim());
    expect(fechada).toBe(false);
    // E a conta que ninguém escolheu não sobrevive à resolução.
    expect(out.accountCredit).not.toBe('12');
  });

  it('ainda preenche a linha totalmente em branco', () => {
    const rows: ExtratoRowComContas[] = [
      { id: '4', description: 'PIX RECEBIDO', nature: 'C', accountDebit: '', accountCredit: '' },
    ];

    const [out] = rodar(rows);

    // Regra aplicada normalmente: banco no débito (entrada), contrapartida da regra.
    expect(out.accountDebit).toBe(BANCO);
    expect(out.accountCredit).toBe('4001');
  });

  it('sem a flag (ação explícita "Reaplicar contas") a regra volta a mandar', () => {
    const rows: ExtratoRowComContas[] = [
      { id: '5', description: 'PIX RECEBIDO', nature: 'C', accountDebit: BANCO, accountCredit: '3302' },
    ];

    const [out] = rodar(rows, false);

    // Aqui re-adivinhar é o comportamento desejado — o usuário pediu.
    expect(out.accountCredit).toBe('4001');
  });
});
