import { describe, it, expect } from 'vitest';
import { parseAcompanhamentoPdfText, acompanhamentoRowsToInvoices } from './fiscalAcompanhamentoParser';

describe('fiscalAcompanhamentoParser — Entradas.pdf (Sistema Domínio)', () => {
  const text = `
AMO SERVICOS MEDICOS E ODONTOLOGICOS LTD
CNPJ: 14.205.521/0001-90
Período: 01/01/2026 até 30/06/2026
ACOMPANHAMENTO DE ENTRADAS
Código Data Nota Série Espécie Código Fornecedor CFOP AC. UF Valor Contábil Tipo Base Cálculo Alíq. Valor Isentas Outras
18 24/04/2026 45 1 39 10 ADOXY COMERCIO E SERVICOS LTDA 2-933 29 RJ 17.000,00 ISS 17.000,00 2,00 340,00 0,00 0,00
1Total Fornecedor
17.000,00 ISS 17.000,00 340,00 0,00 0,00
15 16/03/2026 42 45 4 NM SERVIAOS ADMINISTRATIVOS1-933 28 BA 0,00 ISS 0,00 0,00 0,00 0,00 0,00
1Total Fornecedor
0,00 ISS 0,00 0,00 0,00 0,00
19 30/04/2026 57912 1 39 5 TOKARSKI COMERCIO INDUSTRIA LTDA 2-933 29 GO 20.360,00 ISS 20.360,00 5,00 1.018,00 0,00 0,00
1Total Geral
90.560,00 ISS 90.560,00 3.425,98 0,00 0,00
Sistema licenciado para INOV CONSULTORIA E SERVICOS ADMINISTRATIVOS LTDA
`;

  it('reconhece as 3 notas de entrada e ignora subtotais/rodapé', () => {
    const result = parseAcompanhamentoPdfText(text, 'entrada');
    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBe(3);
  });

  it('extrai corretamente uma linha normal (CFOP com espaço)', () => {
    const result = parseAcompanhamentoPdfText(text, 'entrada');
    const row = result.rows[0]!;
    expect(row.data).toBe('24/04/2026');
    expect(row.nota).toBe('45');
    expect(row.codigoParticipante).toBe('10');
    expect(row.participante).toBe('ADOXY COMERCIO E SERVICOS LTDA');
    expect(row.cfop).toBe('2-933');
    expect(row.acumulador).toBe('29');
    expect(row.uf).toBe('RJ');
    expect(row.valorContabil).toBe(17000);
    expect(row.tipo).toBe('ISS');
    expect(row.aliquota).toBe(2);
    expect(row.valor).toBe(340);
  });

  it('recupera o CFOP mesmo quando ele fica colado no nome (sem espaço na extração do PDF)', () => {
    const result = parseAcompanhamentoPdfText(text, 'entrada');
    const row = result.rows[1]!;
    expect(row.participante).toBe('NM SERVIAOS ADMINISTRATIVOS');
    expect(row.cfop).toBe('1-933');
    expect(row.uf).toBe('BA');
    expect(row.valorContabil).toBe(0);
  });

  it('converte para SpedInvoice com valor negativo (entrada) e ISS mapeado', () => {
    const result = parseAcompanhamentoPdfText(text, 'entrada');
    const invoices = acompanhamentoRowsToInvoices(result);
    expect(invoices.length).toBe(3);
    expect(invoices[0]!.type).toBe('entrada');
    expect(invoices[0]!.value).toBe(-17000);
    expect(invoices[0]!.date).toBe('2026-04-24');
    expect(invoices[0]!.iss).toBe(340);
    expect(invoices[0]!.participantName).toBe('ADOXY COMERCIO E SERVICOS LTDA');
    // CFOP sem hífen (o relatório mostra "2-933"; sanitizeCfop() só aceita dígitos puros).
    expect(invoices[0]!.cfop).toBe('2933');
  });
});

describe('fiscalAcompanhamentoParser — Saídas.pdf (Sistema Domínio)', () => {
  const text = `
AMO SERVICOS MEDICOS E ODONTOLOGICOS LTD
CNPJ: 14.205.521/0001-90
ACOMPANHAMENTO DE SAÍDAS
Código Data Nota Série Espécie Código Cliente CFOP AC. UF Valor Contábil Tipo Base Cálculo Alíq. Valor Isentas Outras
4 01/06/2026 4 47 1047 Ayana Duarte Neres 5-908 501 BA 2.800,00 0,00 0,00 0,00 0,00 0,00
5 01/06/2026 5 47 1047 Ayana Duarte Neres 5-908 501 BA 2.800,00 0,00 0,00 0,00 0,00 0,00
1Total Cliente
5.600,00 0,00 0,00 0,00 0,00
1 30/04/2026 1 47 1828 WILSON MIRANDA CAMPOS 5-908 501 BA 5.350,00 0,00 0,00 0,00 0,00 0,00
1Total Geral
23.264,00 0,00 0,00 0,00 0,00
Sistema licenciado para INOV CONSULTORIA E SERVICOS ADMINISTRATIVOS LTDA
`;

  it('reconhece as notas de saída, mesmo com Série em branco (sem token)', () => {
    const result = parseAcompanhamentoPdfText(text, 'saida');
    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBe(3);
    const row = result.rows[0]!;
    expect(row.nota).toBe('4');
    expect(row.codigoParticipante).toBe('1047');
    expect(row.participante).toBe('Ayana Duarte Neres');
    expect(row.cfop).toBe('5-908');
    expect(row.tipo).toBeUndefined();
    expect(row.valorContabil).toBe(2800);
  });

  it('converte para SpedInvoice com valor positivo (saída)', () => {
    const result = parseAcompanhamentoPdfText(text, 'saida');
    const invoices = acompanhamentoRowsToInvoices(result);
    expect(invoices[0]!.type).toBe('saida');
    expect(invoices[0]!.value).toBe(2800);
    expect(invoices[0]!.date).toBe('2026-06-01');
  });
});

describe('fiscalAcompanhamentoParser — Entradas.pdf real, com "1" soltos grudados nas linhas', () => {
  // Texto exatamente como extraído do PDF real (inclui o marcador de grupo "1" que às vezes
  // fica numa linha própria e às vezes gruda no início da linha seguinte — bug que fazia 4
  // das 9 notas sumirem e o total bater 59.500 em vez de 90.560).
  const text = `
AMO SERVICOS MEDICOS E ODONTOLOGICOS LTD
14.205.521/0001-90
01/01/2026 até 30/06/2026
ACOMPANHAMENTO DE ENTRADAS
Código Data Nota Série Espécie Código Fornecedor CFOP AC. UF Valor Contábil Tipo Base Cálculo Alíq. Valor Isentas Outras
18 24/04/2026 45 1 39 10 ADOXY COMERCIO E SERVICOS LTDA 2-933 29 RJ 17.000,00 ISS 17.000,00 2,00 340,00 0,00 0,00
1Total Fornecedor
17.000,00 ISS 17.000,00 340,00 0,00 0,00
1
15 16/03/2026 42 45 4 NM SERVIAOS ADMINISTRATIVOS1-933 28 BA 0,00 ISS 0,00 0,00 0,00 0,00 0,00
1Total Fornecedor
0,00 ISS 0,00 0,00 0,00 0,00
1
16 02/04/2026 44 1 39 9 NM SERVIÇOS ADMINISTRATIVOS1-933 29 BA 7.500,00 ISS 7.500,00 2,01 150,75 0,00 0,00
1 17 30/04/2026 45 1 39 9 NM SERVIÇOS ADMINISTRATIVOS1-933 29 BA 5.000,00 ISS 5.000,00 2,01 100,50 0,00 0,00
20 29/05/2026 50 1 39 9 NM SERVIÇOS ADMINISTRATIVOS1-933 29 BA 3.300,00 ISS 3.300,00 2,01 66,33 0,00 0,00
1 21 30/06/2026 52 5 39 9 NM SERVIÇOS ADMINISTRATIVOS1-933 29 BA 4.000,00 ISS 4.000,00 2,01 80,40 0,00 0,00
Total Fornecedor
1 19.800,00 ISS 19.800,00 397,98 0,00 0,00
1 19 30/04/2026 57912 1 39 5 TOKARSKI COMERCIO INDUSTRIA LTDA 2-933 29 GO 20.360,00 ISS 20.360,00 5,00 1.018,00 0,00 0,00
22 01/06/2026 67956 5 39 5 TOKARSKI COMERCIO INDUSTRIA LTDA 2-933 29 GO 31.700,00 ISS 31.700,00 5,00 1.585,00 0,00 0,00
1 23 17/06/2026 72576 5 39 5 TOKARSKI COMERCIO INDUSTRIA LTDA 2-933 29 GO 1.700,00 ISS 1.700,00 5,00 85,00 0,00 0,00
Total Fornecedor
1 53.760,00 ISS 53.760,00 2.688,00 0,00 0,00
1Total Geral
90.560,00 ISS 90.560,00 3.425,98 0,00 0,00
1
Sistema licenciado para INOV CONSULTORIA E SERVICOS ADMINISTRATIVOS LTDA
`;

  it('reconhece as 9 notas (não só as que não tinham "1" grudado) e bate o Total Geral de 90.560,00', () => {
    const result = parseAcompanhamentoPdfText(text, 'entrada');
    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBe(9);
    const soma = result.rows.reduce((s, r) => s + r.valorContabil, 0);
    expect(Math.round(soma * 100) / 100).toBe(90560);
  });

  it('recupera as notas cujo código ficou colado ao "1" do marcador de grupo', () => {
    const result = parseAcompanhamentoPdfText(text, 'entrada');
    const notas = result.rows.map((r) => r.nota).sort();
    expect(notas).toEqual(['42', '44', '45', '45', '50', '52', '57912', '67956', '72576'].sort());
  });
});

describe('fiscalAcompanhamentoParser — Serviços.pdf (Sistema Domínio, sem coluna CFOP)', () => {
  const text = `
AMO SERVICOS MEDICOS E ODONTOLOGICOS LTD
CNPJ: 14.205.521/0001-90
ACOMPANHAMENTO DE SERVIÇOS
Código Data Nota Série Espécie Código Cliente AC. UF Valor Contábil Tipo Base Cálculo Alíq. Valor Isentas Outras
1943 26/03/2026 142 1 39 180 Adriana Souza Ramos 500 BA 500,00 ISS 500,00 5,00 25,00 0,00 0,00
1991 15/04/2026 215 1 39 458 Adriel Santos Cardoso 500 BA 600,00 ISS 600,00 5,00 30,00 0,00 0,00
1Total Geral
199.958,69 ISS 199.958,69 8.126,53 0,00 0,00
Sistema licenciado para INOV CONSULTORIA E SERVICOS ADMINISTRATIVOS LTDA
`;

  it('reconhece lançamentos de serviço sem coluna CFOP', () => {
    const result = parseAcompanhamentoPdfText(text, 'servico');
    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBe(2);
    const row = result.rows[0]!;
    expect(row.cfop).toBeUndefined();
    expect(row.participante).toBe('Adriana Souza Ramos');
    expect(row.acumulador).toBe('500');
    expect(row.valor).toBe(25);
  });

  it('trata serviço prestado como saída (receita) no SpedInvoice', () => {
    const result = parseAcompanhamentoPdfText(text, 'servico');
    const invoices = acompanhamentoRowsToInvoices(result);
    expect(invoices[0]!.type).toBe('saida');
    expect(invoices[0]!.value).toBe(500);
    expect(invoices[0]!.iss).toBe(25);
  });
});
