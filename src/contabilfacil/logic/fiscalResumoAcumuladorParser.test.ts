import { describe, it, expect } from 'vitest';
import { parseResumoAcumuladorPdfText } from './fiscalResumoAcumuladorParser';

describe('fiscalResumoAcumuladorParser — Resumo por Acumulador (Sistema Domínio)', () => {
  // Texto exatamente como extraído do PDF real, incluindo os "1" soltos grudados nas linhas.
  const text = `
AMO SERVICOS MEDICOS E ODONTOLOGICOS LTDA
CNPJ: 14.205.521/0001-90
Período: 01/01/2026 até 30/06/2026
RESUMO POR ACUMULADOR
ENTRADAS
Código Descrição Vlr Contábil Base ICMS Vlr ICMS Isentas ICMS Outras ICMS Vlr IPI BC ICMS ST Vlr ICMS ST
28 AQUISIÇÃO DE SERVIÇO A VISTA 1933 2933 0,00 0,00 0,00 0,00 0,00 0,00 0,00 0,00
1 29 AQUISIÇÃO DE SERVIÇO A PRAZO 1933 2933 90.560,00 0,00 0,00 0,00 0,00 0,00 0,00 0,00
Total: 90.560,00 0,00 0,00 0,00 0,00 0,00 0,00 0,00
SAÍDAS
Código Descrição Vlr Contábil Base ICMS Vlr ICMS Isentas ICMS Outras ICMS Vlr IPI BC ICMS ST Vlr ICMS ST
1 501 SERVIÇO PRESTADO A PRAZO - LOCAÇÃO 23.264,00 0,00 0,00 0,00 0,00 0,00 0,00 0,00
Total: 23.264,00 0,00 0,00 0,00 0,00 0,00 0,00 0,00
SERVIÇOS
Cód Descrição Vlr Contábil Base ISS Vlr ISS Isentas ISS Outras ISS Base ISSR Vlr ISSR Isentas ISSR Outras ISSR
1 500 SERVIÇO PRESTADO A VISTA 199.958,69 199.958,69 8.126,53 0,00 0,00 0,00 0,00 0,00 0,00
Total: 199.958,69 199.958,69 8.126,53 0,00 0,00 0,00 0,00 0,00 0,00
Sistema licenciado para INOV CONSULTORIA E SERVICOS ADMINISTRATIVOS LTDA
`;

  it('reconhece os 4 acumuladores (2 entradas, 1 saída, 1 serviço) e ignora subtotais/cabeçalhos', () => {
    const result = parseResumoAcumuladorPdfText(text);
    expect(result.errors).toEqual([]);
    expect(result.linhas.length).toBe(4);
  });

  it('extrai o código correto mesmo com o "1" do marcador de grupo colado (não confunde com o código)', () => {
    const result = parseResumoAcumuladorPdfText(text);
    const entradas = result.linhas.filter((l) => l.secao === 'entradas');
    expect(entradas.map((l) => l.codigo).sort()).toEqual(['28', '29']);

    const entradaPrazo = entradas.find((l) => l.codigo === '29')!;
    expect(entradaPrazo.descricao).toBe('AQUISIÇÃO DE SERVIÇO A PRAZO');
    expect(entradaPrazo.valorContabil).toBe(90560);
  });

  it('remove os CFOPs colados no fim da descrição', () => {
    const result = parseResumoAcumuladorPdfText(text);
    const entradaVista = result.linhas.find((l) => l.codigo === '28')!;
    expect(entradaVista.descricao).toBe('AQUISIÇÃO DE SERVIÇO A VISTA');
    expect(entradaVista.valorContabil).toBe(0);
  });

  it('extrai a saída (hífen na descrição não é confundido com valor monetário)', () => {
    const result = parseResumoAcumuladorPdfText(text);
    const saida = result.linhas.find((l) => l.secao === 'saidas')!;
    expect(saida.codigo).toBe('501');
    expect(saida.descricao).toBe('SERVIÇO PRESTADO A PRAZO - LOCAÇÃO');
    expect(saida.valorContabil).toBe(23264);
  });

  it('extrai o serviço (9 colunas monetárias, sem CFOP)', () => {
    const result = parseResumoAcumuladorPdfText(text);
    const servico = result.linhas.find((l) => l.secao === 'servicos')!;
    expect(servico.codigo).toBe('500');
    expect(servico.descricao).toBe('SERVIÇO PRESTADO A VISTA');
    expect(servico.valorContabil).toBe(199958.69);
  });

  it('extrai CNPJ e período', () => {
    const result = parseResumoAcumuladorPdfText(text);
    expect(result.cnpj).toBe('14.205.521/0001-90');
    expect(result.periodoInicio).toBe('01/01/2026');
    expect(result.periodoFim).toBe('30/06/2026');
  });

  it('retorna erro quando não reconhece nenhum acumulador', () => {
    const result = parseResumoAcumuladorPdfText('texto qualquer sem seções');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.linhas).toEqual([]);
  });
});
