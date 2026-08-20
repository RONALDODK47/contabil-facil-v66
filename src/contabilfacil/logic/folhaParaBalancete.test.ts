import { describe, expect, it } from 'vitest';
import {
  buildFolhaPartidas,
  isFolhaPartidaRow,
  mergeFolhaPartidasComRazao,
} from './folhaToRazao';
import type { FolhaRegra } from './folhaContasAutomacaoStorage';
import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';

const REGRAS: FolhaRegra[] = [
  { id: 'r1', descricao: 'Salários e remuneração', contaDebito: '298', contaCredito: '187', destino: 'REMUNERACAO' },
  { id: 'r2', descricao: 'INSS retido', contaDebito: '187', contaCredito: '191', destino: 'INSS_RETIDO' },
];

const LINHAS = [
  { id: 'a', date: '31/01/2026', description: '8781 - SALARIO EMPREGADO 2', debito: 0, credito: 6484, tipo: 'PROVENTOS' as const },
  { id: 'b', date: '28/02/2026', description: '8781 - SALARIO EMPREGADO 2', debito: 0, credito: 6484, tipo: 'PROVENTOS' as const },
  { id: 'c', date: '28/02/2026', description: '998 - I.N.S.S.', debito: 1985.37, credito: 0, tipo: 'DESCONTOS' as const },
];

/** Linhas que já estavam no razão vindas da conciliação bancária. */
const RAZAO_CONCILIACAO: VisionBalanceteRow[] = [
  {
    codigo: '187',
    classificacao: '2.1.3.01.00001',
    nome: 'DEB PIX CHAVE FULANO',
    data: '10/02/2026',
    debito: 1500,
    credito: 0,
    saldoInicial: 0,
    saldoFinal: 0,
    tipo: 'A',
  },
  {
    codigo: '9',
    classificacao: '1.1.1.01.00001',
    nome: 'DEB PIX CHAVE FULANO',
    data: '10/02/2026',
    debito: 0,
    credito: 1500,
    saldoInicial: 0,
    saldoFinal: 0,
    tipo: 'A',
  },
];

describe('publicar a folha no balancete', () => {
  it('as partidas da folha se identificam sem depender da classificação contábil', () => {
    const partidas = buildFolhaPartidas(LINHAS, REGRAS, undefined, () => '2.1.3.01.00001');

    expect(partidas.every(isFolhaPartidaRow)).toBe(true);
    // A classificação é a contábil de verdade, então não serve de marcador
    expect(partidas.every((p) => p.classificacao === '2.1.3.01.00001')).toBe(true);
  });

  it('linha da conciliação não é confundida com lançamento da folha', () => {
    expect(RAZAO_CONCILIACAO.some(isFolhaPartidaRow)).toBe(false);
  });

  it('publica só o período escolhido', () => {
    const fevereiro = buildFolhaPartidas(LINHAS, REGRAS, { de: '01/02/2026', ate: '28/02/2026' });

    // 2 lançamentos de fevereiro × 2 pernas
    expect(fevereiro).toHaveLength(4);
    expect(fevereiro.every((p) => p.data === '28/02/2026')).toBe(true);
  });

  it('reenviar substitui os lançamentos da folha, sem duplicar', () => {
    const primeira = buildFolhaPartidas(LINHAS, REGRAS);
    const razao1 = mergeFolhaPartidasComRazao(RAZAO_CONCILIACAO, primeira);
    expect(razao1.filter(isFolhaPartidaRow)).toHaveLength(primeira.length);

    const segunda = buildFolhaPartidas(LINHAS, REGRAS);
    const razao2 = mergeFolhaPartidasComRazao(razao1, segunda);

    expect(razao2.filter(isFolhaPartidaRow)).toHaveLength(segunda.length);
    expect(razao2).toHaveLength(RAZAO_CONCILIACAO.length + segunda.length);
  });

  it('as linhas da conciliação sobrevivem à publicação', () => {
    const razao = mergeFolhaPartidasComRazao(
      RAZAO_CONCILIACAO,
      buildFolhaPartidas(LINHAS, REGRAS),
    );
    const conciliacao = razao.filter((r) => !isFolhaPartidaRow(r));

    expect(conciliacao).toEqual(RAZAO_CONCILIACAO);
  });

  it('publicar uma competência não apaga as outras da mesma remessa', () => {
    const tudo = buildFolhaPartidas(LINHAS, REGRAS);
    const datas = new Set(tudo.map((p) => p.data));

    expect(datas).toEqual(new Set(['31/01/2026', '28/02/2026']));
  });

  it('"IMPORTAR TUDO" (sem período) leva a folha inteira', () => {
    // É assim que o modal chama quando o usuário escolhe importar tudo: período vazio
    const tudo = buildFolhaPartidas(LINHAS, REGRAS, { de: '', ate: '' });
    const semFiltro = buildFolhaPartidas(LINHAS, REGRAS);

    expect(tudo).toEqual(semFiltro);
    expect(new Set(tudo.map((p) => p.data))).toEqual(new Set(['31/01/2026', '28/02/2026']));
  });

  it('o que vai para o balancete é o mesmo que a aba mostra', () => {
    // Mesma função que alimenta o "Totais por Conta" e o razão por conta
    const daTela = buildFolhaPartidas(LINHAS, REGRAS, { de: '01/02/2026', ate: '28/02/2026' });
    const publicado = buildFolhaPartidas(LINHAS, REGRAS, { de: '01/02/2026', ate: '28/02/2026' });

    expect(publicado).toEqual(daTela);
  });
});
