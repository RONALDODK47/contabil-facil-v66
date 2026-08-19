import { describe, it, expect } from 'vitest';
import { parseFolhaLiquidosRows } from '../folhaLiquidosParser';

/** Linhas como o extrator de PDF do projeto devolve (código e nome vêm na mesma célula). */
function paginaCompetencia(competencia: string, valores: string[]): string[][] {
  return [
    ['Empresa:', 'OBRAS SOCIAIS DO CENTRO ESPIRITA LUZ DA', 'Página:', '1 / 7'],
    ['CNPJ:', '05.988.299/0001-58', 'Emissão:', '19/08/2026'],
    ['Cálculo:', 'Folha Mensal', 'Horas:', '09:11:21'],
    ['Competência:', competencia],
    ['RELAÇÃO GERAL DOS LÍQUIDOS'],
    ['Código Nome do empregado', 'Identidade', 'Valor'],
    ['Empregados'],
    ['17 CAROLLINE TAVEIRA DOS SANTOS', '4279500', valores[0]],
    ['20 IOLANDA APARECIDA LOPES EVANGELISTA', '5173938 2 VIA', valores[1]],
    ['6 IVANIR INACIO DA SILVA', '32012202433435', valores[2]],
    ['Empregados: 3', 'Estagiários: 0', 'Contribuintes: 0', 'Total da Empresa:', valores[3]],
    ['(total por extenso)'],
    ['PALMELO, 19/08/2026', 'Responsável:'],
  ];
}

describe('Relatório de Líquidos — parser', () => {
  const rows = [
    ...paginaCompetencia('01/2026', ['1.671,01', '1.176,92', '1.671,01', '4.518,94']),
    ...paginaCompetencia('02/2026', ['1.671,12', '1.176,92', '1.671,12', '4.519,16']),
  ];
  const parsed = parseFolhaLiquidosRows(rows, 'Relatório de Líquidos.pdf');

  it('lê uma competência por página, sem misturar', () => {
    expect(parsed.competencias.map((c) => c.competencia)).toEqual(['01/2026', '02/2026']);
    expect(parsed.competencias[0].itens).toHaveLength(3);
    expect(parsed.competencias[1].itens).toHaveLength(3);
  });

  it('separa código, nome, identidade e valor', () => {
    const item = parsed.competencias[0].itens[0];
    expect(item.codigo).toBe('17');
    expect(item.nome).toBe('CAROLLINE TAVEIRA DOS SANTOS');
    expect(item.identidade).toBe('4279500');
    expect(item.valor).toBeCloseTo(1671.01, 2);
  });

  it('guarda só os dígitos da identidade suja ("5173938 2 VIA")', () => {
    const item = parsed.competencias[0].itens[1];
    expect(item.identidade).toBe('5173938 2 VIA');
    expect(item.identidadeDigitos).toBe('51739382');
  });

  it('não confunde o rodapé "Empregados: 3" com um funcionário', () => {
    const nomes = parsed.competencias[0].itens.map((i) => i.nome);
    expect(nomes.some((n) => n.includes('Empregados'))).toBe(false);
  });

  it('confere a soma dos líquidos com o total impresso', () => {
    expect(parsed.issues).toEqual([]);
    expect(parsed.competencias[0].total).toBeCloseTo(4518.94, 2);
  });

  it('acusa divergência quando a soma não fecha com o total', () => {
    const ruim = parseFolhaLiquidosRows(
      paginaCompetencia('03/2026', ['1.000,00', '1.000,00', '1.000,00', '9.999,99']),
      'x.pdf',
    );
    expect(ruim.issues.join(' ')).toContain('03/2026');
  });

  it('rejeita PDF que não é o relatório de líquidos', () => {
    const outro = parseFolhaLiquidosRows([['EXTRATO BANCARIO'], ['01/01/2026', '100,00']], 'x.pdf');
    expect(outro.competencias).toHaveLength(0);
    expect(outro.issues[0]).toContain('não reconhecido');
  });
});
