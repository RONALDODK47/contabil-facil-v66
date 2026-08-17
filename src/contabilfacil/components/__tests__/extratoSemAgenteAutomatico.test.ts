/**
 * Trava estrutural: nenhum agente automático pode reconciliar o extrato.
 *
 * Ver docs/CONCILIACAO-EXTRATO-REGRAS.md. Estes testes leem o código-fonte de
 * propósito — o que precisa ser garantido aqui não é o resultado de uma função,
 * é a AUSÊNCIA de um caminho que rode o resolver sem o usuário pedir.
 *
 * Já custou horas de conciliação feita à mão, substituída por palpite em
 * background. Se um destes quebrar, a mudança está errada — não o teste.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const managerSrc = readFileSync(
  resolve(__dirname, '../ManagerModule.tsx'),
  'utf8',
);

/** Trecho da função, do cabeçalho até a próxima declaração de mesmo nível. */
function corpoDaFuncao(src: string, nome: string): string {
  const inicio = src.indexOf(nome);
  expect(inicio, `função ${nome} não encontrada`).toBeGreaterThan(-1);
  const resto = src.slice(inicio);
  const fim = resto.indexOf('\n  const handle', 1);
  return fim > 0 ? resto.slice(0, fim) : resto;
}

describe('extrato — nenhum agente automático de contas', () => {
  it('não existe efeito de reaplicação automática de regras', () => {
    // O efeito antigo era disparado por esta chave e rodava o resolver em
    // background sobre TODAS as linhas, gravando por cima da conciliação.
    expect(managerSrc).not.toContain('autoReapplyKey');
    expect(managerSrc).not.toContain('lastAutoReapplyRef');
    expect(managerSrc).not.toContain('autoReapplyAbortRef');
  });

  it('abrir extrato salvo restaura sem passar pelo resolver', () => {
    const corpo = corpoDaFuncao(managerSrc, 'handleSelectExtratoPasta');
    expect(corpo).toContain('saveExtratoLocal');
    expect(corpo).not.toContain('applyExtratoContaResolver');
  });

  it('só a ação explícita "Reaplicar contas" roda o resolver sem preservação', () => {
    // Posição de cada chamada do resolver no arquivo.
    const posicoes: number[] = [];
    for (let i = managerSrc.indexOf('applyExtratoContaResolverAsync('); i > -1; ) {
      posicoes.push(i);
      i = managerSrc.indexOf('applyExtratoContaResolverAsync(', i + 1);
    }
    expect(posicoes.length).toBeGreaterThan(0);

    // A janela cobre tanto as opções inline quanto um `resolverOpts` montado
    // logo acima da chamada.
    const temPreservacao = (pos: number) =>
      managerSrc.slice(Math.max(0, pos - 1500), pos + 1200).includes('preservarContasExistentes');

    const semPreservacao = posicoes.filter((p) => !temPreservacao(p));

    // Exatamente uma, e ela tem que estar dentro de handleReaplicarExtratoContas.
    expect(semPreservacao).toHaveLength(1);

    const inicioBotao = managerSrc.indexOf('const handleReaplicarExtratoContas');
    expect(inicioBotao).toBeGreaterThan(-1);
    const fimBotao = managerSrc.indexOf('\n  const handle', inicioBotao + 1);
    expect(semPreservacao[0]).toBeGreaterThan(inicioBotao);
    expect(semPreservacao[0]).toBeLessThan(fimBotao);
  });

  it('a exportação TXT+ não descarta linha por causa de conta', () => {
    const dominio = readFileSync(
      resolve(__dirname, '../../logic/dominioTxtIO.ts'),
      'utf8',
    );
    const inicio = dominio.indexOf('export function buildTxtPlusFromExtratoRows');
    const corpo = dominio.slice(inicio, dominio.indexOf('\nexport ', inicio + 10));

    // Usa a mesma resolução da tabela.
    expect(corpo).toContain('resolveExtratoRowContas');
    // Não usa o motor que forçava o banco e devolvia null para sumir com a linha.
    expect(corpo).not.toContain('resolvePartidaDominioExtrato');

    // O único `continue` permitido é a guarda de valor (lançamento de R$ 0).
    // Qualquer outro seria um filtro decidindo o que entra no arquivo.
    const continues = corpo.match(/continue/g) ?? [];
    expect(continues).toHaveLength(1);
    expect(corpo).toContain('if (!(valorAbsoluto > 0)) continue;');
  });
});
