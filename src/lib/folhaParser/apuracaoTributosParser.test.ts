import { describe, expect, it } from 'vitest';
import {
  encargosEmpresaParaLinhasFolha,
  parseApuracaoTributos,
  ultimoDiaDaCompetencia,
} from './apuracaoTributosParser';

/**
 * Duas páginas do "Apuração de Tributos Federais" real da Obras Sociais, no formato exato em
 * que o extrator de texto entrega: rótulos depois do valor e o "Saldo a recolher" colado no
 * nome do encargo.
 */
const PDF_REAL = `1/4
APURAÇÃO DE TRIBUTOS FEDERAIS
Página:
Emissão:
Hora:
20/08/2026
08:55:21
Folha Mensal
Cálculo:
CNPJ: 05.988.299/0001-58
52 - OBRAS SOCIAIS DO CENTRO ESPIRITA LUZ DAEmpresa:
Competência: 02/2026
Saldo a compensar
(-)Compensação DCOMP: (-)Salário Família: 540,320,00
(-)Salário Maternidade: (-)Retenções: 0,000,00
(-)Retenções(-)Compensação DCOMP Saldo a recolher(-)Salário Maternidade(-)Salário FamíliaEncargos Valor
0,00 540,32 0,00 0,00 1.441,90INSS Segurados Folha 1.982,22
0,00 0,00 0,00 0,00 260,78INSS Empresa e RAT Folha 260,78
0,00 0,00 0,00 0,00 260,78PIS Folha 260,78
Total saldo à recolher: 1.963,46
Sistema licenciado para INOV CONSULTORIA E SERVICOS ADMINISTRATIVOS LTDA

2/4
APURAÇÃO DE TRIBUTOS FEDERAIS
Folha Mensal
Cálculo:
CNPJ: 05.988.299/0001-58
52 - OBRAS SOCIAIS DO CENTRO ESPIRITA LUZ DAEmpresa:
Competência: 03/2026
(-)Retenções(-)Compensação DCOMP Saldo a recolher(-)Salário Maternidade(-)Salário FamíliaEncargos Valor
0,00 540,32 0,00 0,00 1.524,20INSS Segurados Folha 2.064,52
0,00 0,00 0,00 0,00 269,93INSS Empresa e RAT Folha 269,93
0,00 0,00 0,00 0,00 269,93PIS Folha 269,93
Total saldo à recolher: 2.064,06
Sistema licenciado para INOV CONSULTORIA E SERVICOS ADMINISTRATIVOS LTDA`;

describe('ultimoDiaDaCompetencia', () => {
  it('converte MM/YYYY no último dia do mês', () => {
    expect(ultimoDiaDaCompetencia('02/2026')).toBe('28/02/2026');
    expect(ultimoDiaDaCompetencia('03/2026')).toBe('31/03/2026');
    expect(ultimoDiaDaCompetencia('04/2026')).toBe('30/04/2026');
    expect(ultimoDiaDaCompetencia('13/2026')).toBe('');
  });
});

describe('parseApuracaoTributos — PDF real', () => {
  const paginas = parseApuracaoTributos(PDF_REAL);

  it('lê todas as páginas, uma competência cada', () => {
    expect(paginas.map((p) => p.competencia)).toEqual(['02/2026', '03/2026']);
    expect(paginas.map((p) => p.data)).toEqual(['28/02/2026', '31/03/2026']);
  });

  it('lê o cabeçalho, que vem com o rótulo DEPOIS do valor', () => {
    expect(paginas[0]?.tipoCalculo).toBe('Folha Mensal');
    expect(paginas[0]?.empresa).toBe('52 - OBRAS SOCIAIS DO CENTRO ESPIRITA LUZ DA');
    expect(paginas[0]?.cnpj).toBe('05.988.299/0001-58');
  });

  it('separa o saldo a recolher do valor — o saldo vem colado no nome do encargo', () => {
    const inssSegurados = paginas[0]?.linhas.find((l) => l.encargo === 'INSS Segurados Folha');
    // 1.982,22 de INSS menos 540,32 de salário-família compensado
    expect(inssSegurados?.valor).toBeCloseTo(1982.22, 2);
    expect(inssSegurados?.saldoARecolher).toBeCloseTo(1441.9, 2);
  });

  it('a soma dos saldos fecha com o total impresso no rodapé', () => {
    for (const pagina of paginas) {
      const soma = pagina.linhas.reduce((s, l) => s + l.saldoARecolher, 0);
      expect(soma).toBeCloseTo(pagina.totalSaldoARecolher!, 2);
    }
  });

  it('não confunde cabeçalho e rodapé com linha de encargo', () => {
    for (const pagina of paginas) {
      expect(pagina.linhas.map((l) => l.encargo)).toEqual([
        'INSS Segurados Folha',
        'INSS Empresa e RAT Folha',
        'PIS Folha',
      ]);
    }
  });

  it('marca o INSS dos segurados como retenção do empregado, não encargo da empresa', () => {
    const [pagina] = paginas;
    expect(pagina?.linhas.find((l) => l.encargo === 'INSS Segurados Folha')?.ehEncargoEmpresa).toBe(false);
    expect(pagina?.linhas.find((l) => l.encargo === 'INSS Empresa e RAT Folha')?.ehEncargoEmpresa).toBe(true);
    expect(pagina?.linhas.find((l) => l.encargo === 'PIS Folha')?.ehEncargoEmpresa).toBe(true);
  });
});

describe('encargosEmpresaParaLinhasFolha', () => {
  const linhas = encargosEmpresaParaLinhasFolha(parseApuracaoTributos(PDF_REAL));

  it('importa só os encargos da empresa, pelo saldo a recolher', () => {
    expect(linhas.map((l) => `${l.date} ${l.description} ${l.credito.toFixed(2)}`)).toEqual([
      '28/02/2026 INSS Empresa e RAT Folha 260.78',
      '28/02/2026 PIS Folha 260.78',
      '31/03/2026 INSS Empresa e RAT Folha 269.93',
      '31/03/2026 PIS Folha 269.93',
    ]);
  });

  it('deixa de fora o INSS retido do empregado — já vem no Resumo da Folha', () => {
    expect(linhas.some((l) => /SEGURADO/i.test(l.description))).toBe(false);
  });

  it('entra como obrigação a recolher (crédito), com a despesa definida pela regra', () => {
    expect(linhas.every((l) => l.credito > 0 && l.debito === 0)).toBe(true);
    expect(linhas.every((l) => l.tipo === 'INFORMATIVA')).toBe(true);
  });

  it('gera id estável por competência e encargo, para não duplicar em reimportação', () => {
    const ids = linhas.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const outraLeitura = encargosEmpresaParaLinhasFolha(parseApuracaoTributos(PDF_REAL));
    expect(outraLeitura.map((l) => l.id)).toEqual(ids);
  });
});

/**
 * A MESMA página, agora como o app extrai: linhas reconstruídas pela posição na página, da
 * esquerda para a direita. O rótulo vem antes do valor e as colunas ficam na ordem impressa.
 */
const PDF_ORDEM_VISUAL = `--- Página 1 ---
Empresa: 52 - OBRAS SOCIAIS DO CENTRO ESPIRITA LUZ DA Página: 1/4
CNPJ: 05.988.299/0001-58 Emissão: 20/08/2026
Cálculo: Folha Mensal Hora: 08:55:21
Competência: 02/2026
APURAÇÃO DE TRIBUTOS FEDERAIS
Saldo a compensar
(-)Compensação DCOMP: 0,00 (-)Salário Família: 540,32
(-)Salário Maternidade: 0,00 (-)Retenções: 0,00
Encargos Valor (-)Compensação DCOMP (-)Salário Família (-)Salário Maternidade (-)Retenções Saldo a recolher
INSS Segurados Folha 1.982,22 0,00 540,32 0,00 0,00 1.441,90
INSS Empresa e RAT Folha 260,78 0,00 0,00 0,00 0,00 260,78
PIS Folha 260,78 0,00 0,00 0,00 0,00 260,78
Total saldo à recolher: 1.963,46
Saldo remanescente à restituir
(-)DCOMP: 0,00 (-)Salário Família: 0,00
(-)Salário Maternidade: 0,00 (-)Retenções: 0,00
Sistema licenciado para INOV CONSULTORIA E SERVICOS ADMINISTRATIVOS LTDA`;

describe('parseApuracaoTributos — ordem visual (a extração do app)', () => {
  const [pagina] = parseApuracaoTributos(PDF_ORDEM_VISUAL);

  it('lê a competência e o cabeçalho com o rótulo ANTES do valor', () => {
    expect(pagina?.competencia).toBe('02/2026');
    expect(pagina?.data).toBe('28/02/2026');
    expect(pagina?.tipoCalculo).toBe('Folha Mensal');
    expect(pagina?.empresa).toBe('52 - OBRAS SOCIAIS DO CENTRO ESPIRITA LUZ DA');
  });

  it('lê as mesmas três linhas, com valor na primeira coluna e saldo na última', () => {
    expect(pagina?.linhas.map((l) => [l.encargo, l.valor, l.saldoARecolher])).toEqual([
      ['INSS Segurados Folha', 1982.22, 1441.9],
      ['INSS Empresa e RAT Folha', 260.78, 260.78],
      ['PIS Folha', 260.78, 260.78],
    ]);
  });

  it('não confunde as linhas de compensação e o total com encargos', () => {
    // "(-)Compensação DCOMP: 0,00 (-)Salário Família: 540,32" tem dois números mas não é encargo
    expect(pagina?.linhas).toHaveLength(3);
    expect(pagina?.totalSaldoARecolher).toBeCloseTo(1963.46, 2);
  });

  it('produz o mesmo resultado dos dois formatos de extração', () => {
    const visual = parseApuracaoTributos(PDF_ORDEM_VISUAL)[0];
    const interno = parseApuracaoTributos(PDF_REAL)[0];

    expect(visual?.competencia).toBe(interno?.competencia);
    expect(visual?.linhas).toEqual(interno?.linhas);
  });
});
