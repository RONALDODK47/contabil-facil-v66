import { describe, expect, it } from 'vitest';
import { buildFolhaPartidas, buildFolhaTotaisPorConta } from './folhaToRazao';
import type { FolhaRegra } from './folhaContasAutomacaoStorage';
import { classificarRubricaDestino, type FolhaDestinoId } from './folhaRubricaTaxonomia';

/**
 * Competência 01/2026 da Obras Sociais.
 *
 * O Domínio, na tela de Pagamentos dessa competência, mostra duas linhas:
 *   Folha Mensal .... 24.209,40
 *   Rescisão ........  2.154,75
 *
 * "Salários a pagar" e "Rescisões a pagar" têm de fechar com esses dois valores, cada verba
 * na sua conta — sem transferência de uma para a outra.
 */
const COMPETENCIA = '31/01/2026';

const SALARIOS_A_PAGAR = '187';
const RESCISOES_A_PAGAR = '167';

type Linha = {
  id: string;
  date: string;
  description: string;
  debito: number;
  credito: number;
  tipo: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA';
  tipoCalculo?: string;
};

/**
 * Mapeamento natural: a conta A PAGAR segue o tipo de cálculo (folha mensal → salários a pagar,
 * rescisão → rescisões a pagar) e a conta de DESPESA segue a natureza da rubrica.
 */
const CONTAS_POR_DESTINO: Partial<Record<FolhaDestinoId, { debito: string; credito: string }>> = {
  REMUNERACAO: { debito: '298', credito: SALARIOS_A_PAGAR },
  GRATIFICACOES_PREMIOS: { debito: '300', credito: SALARIOS_A_PAGAR },
  FERIAS: { debito: '302', credito: '166' },
  BENEFICIO_INSS: { debito: '38', credito: SALARIOS_A_PAGAR },
  INSS_RETIDO: { debito: SALARIOS_A_PAGAR, credito: '184' },
  CONSIGNADO: { debito: SALARIOS_A_PAGAR, credito: '152' },
  // Rescisão: despesa própria contra rescisões a pagar, e o INSS do desligado baixa dessa conta
  RESCISAO: { debito: '298', credito: RESCISOES_A_PAGAR },
  INSS_RESCISAO: { debito: RESCISOES_A_PAGAR, credito: '184' },
  FGTS: { debito: '304', credito: '192' },
};

const REGRAS: FolhaRegra[] = Object.entries(CONTAS_POR_DESTINO).map(([destino, contas], i) => ({
  id: `r${i}`,
  descricao: destino,
  contaDebito: contas!.debito,
  contaCredito: contas!.credito,
  destino: destino as FolhaDestinoId,
}));

const totaisDe = (linhas: Linha[]) =>
  buildFolhaTotaisPorConta(buildFolhaPartidas(linhas, REGRAS), (c) => c);
const saldoCredor = (linhas: Linha[], conta: string) => {
  const t = totaisDe(linhas).find((x) => x.conta === conta);
  return t ? -t.saldo : undefined;
};

// ---------------------------------------------------------------------------
// O caminho correto: Resumo emitido POR TIPO DE CÁLCULO
// ---------------------------------------------------------------------------

/** Resumo emitido só com "Cálculo: Rescisão" — tudo aqui é do empregado desligado. */
const RESCISAO: Linha[] = [
  { id: 'r1', date: COMPETENCIA, description: '9179 - SALDO DE SALARIO HORAS2', debito: 0, credito: 1370.96, tipo: 'PROVENTOS', tipoCalculo: 'Rescisão' },
  { id: 'r2', date: COMPETENCIA, description: '229 - FERIAS PROPORCIONAIS', debito: 0, credito: 566.67, tipo: 'PROVENTOS', tipoCalculo: 'Rescisão' },
  { id: 'r3', date: COMPETENCIA, description: '28169 - 1/3 FERIAS PROPORCIONAIS RESCISAO', debito: 0, credito: 188.89, tipo: 'PROVENTOS', tipoCalculo: 'Rescisão' },
  { id: 'r4', date: COMPETENCIA, description: '58550 - 13 SALARIO INTEGRAL RESCISAO', debito: 0, credito: 141.67, tipo: 'PROVENTOS', tipoCalculo: 'Rescisão' },
  { id: 'r5', date: COMPETENCIA, description: '2826 - INSS SOBRE RESCISAO', debito: 102.82, credito: 0, tipo: 'DESCONTOS', tipoCalculo: 'Rescisão' },
  { id: 'r6', date: COMPETENCIA, description: '2989 - INSS 13 SAL.RESCISAO', debito: 10.62, credito: 0, tipo: 'DESCONTOS', tipoCalculo: 'Rescisão' },
];

/** Resumo emitido só com "Cálculo: Folha Mensal" — sem nada do desligado. */
const FOLHA_MENSAL: Linha[] = [
  { id: 'm1', date: COMPETENCIA, description: '20 - GRATIFICACOES1', debito: 0, credito: 752.0, tipo: 'PROVENTOS', tipoCalculo: 'Folha Mensal' },
  { id: 'm2', date: COMPETENCIA, description: '243 - DESCANSO SEMANAL REMUNERADO2', debito: 0, credito: 2583.04, tipo: 'PROVENTOS', tipoCalculo: 'Folha Mensal' },
  { id: 'm3', date: COMPETENCIA, description: '249 - GRATIFICACAO', debito: 0, credito: 1077.08, tipo: 'PROVENTOS', tipoCalculo: 'Folha Mensal' },
  { id: 'm4', date: COMPETENCIA, description: '274 - GRATIFICAÇÃO DE FUNÇÃO', debito: 0, credito: 188.0, tipo: 'PROVENTOS', tipoCalculo: 'Folha Mensal' },
  { id: 'm5', date: COMPETENCIA, description: '995 - SALARIO FAMILIA .', debito: 0, credito: 540.32, tipo: 'PROVENTOS', tipoCalculo: 'Folha Mensal' },
  { id: 'm6', date: COMPETENCIA, description: '8781 - SALARIO EMPREGADO 2', debito: 0, credito: 6484.0, tipo: 'PROVENTOS', tipoCalculo: 'Folha Mensal' },
  // 13.156,70 do agregado menos os 1.370,96 do desligado
  { id: 'm7', date: COMPETENCIA, description: '9179 - SALDO DE SALARIO HORAS2', debito: 0, credito: 11785.74, tipo: 'PROVENTOS', tipoCalculo: 'Folha Mensal' },
  { id: 'm8', date: COMPETENCIA, description: '9180 - SALDO DE SALARIO DIAS.2', debito: 0, credito: 3242.0, tipo: 'PROVENTOS', tipoCalculo: 'Folha Mensal' },
  { id: 'm9', date: COMPETENCIA, description: '360 - DESC. EMP. CRED. TRAB Nº 0000001054844453', debito: 172.52, credito: 0, tipo: 'DESCONTOS', tipoCalculo: 'Folha Mensal' },
  { id: 'm10', date: COMPETENCIA, description: '362 - DESC. EMP. CRED. TRAB Nº 0000001079740603', debito: 40.07, credito: 0, tipo: 'DESCONTOS', tipoCalculo: 'Folha Mensal' },
  { id: 'm11', date: COMPETENCIA, description: '750 - DESC. EMP. CRED. TRAB Nº 00000001191563497', debito: 245.0, credito: 0, tipo: 'DESCONTOS', tipoCalculo: 'Folha Mensal' },
  { id: 'm12', date: COMPETENCIA, description: '998 - I.N.S.S.', debito: 1985.19, credito: 0, tipo: 'DESCONTOS', tipoCalculo: 'Folha Mensal' },
  { id: 'm13', date: COMPETENCIA, description: '996 - F.G.T.S DO MES', debito: 0, credito: 2088.92, tipo: 'INFORMATIVA', tipoCalculo: 'Folha Mensal' },
];

describe('Resumo por tipo de cálculo — cada verba na sua conta a pagar', () => {
  it('no relatório de RESCISÃO o tipo de cálculo manda, não o nome da rubrica', () => {
    // "SALDO DE SALARIO HORAS" não tem "rescisão" no nome, mas num Resumo de Rescisão é o
    // saldo do desligado: pelo nome iria parar em salários a pagar.
    expect(classificarRubricaDestino('9179 - SALDO DE SALARIO HORAS2', 'PROVENTOS')?.id).toBe('REMUNERACAO');
    expect(
      classificarRubricaDestino('9179 - SALDO DE SALARIO HORAS2', 'PROVENTOS', { calculoRescisao: true })?.id,
    ).toBe('RESCISAO');
    expect(
      classificarRubricaDestino('998 - I.N.S.S.', 'DESCONTOS', { calculoRescisao: true })?.id,
    ).toBe('INSS_RESCISAO');
  });

  it('rescisões a pagar fecha em 2.154,75, sem encostar em salários a pagar', () => {
    const totais = totaisDe(RESCISAO);

    // Proventos do desligado 2.268,19 − INSS dele 113,44
    expect(totais.find((t) => t.conta === RESCISOES_A_PAGAR)?.credito).toBeCloseTo(2268.19, 2);
    expect(totais.find((t) => t.conta === RESCISOES_A_PAGAR)?.debito).toBeCloseTo(113.44, 2);
    expect(saldoCredor(RESCISAO, RESCISOES_A_PAGAR)).toBeCloseTo(2154.75, 2);

    expect(totais.find((t) => t.conta === SALARIOS_A_PAGAR)).toBeUndefined();
  });

  it('salários a pagar fecha em 24.209,40, sem nenhuma verba de rescisão', () => {
    const totais = totaisDe(FOLHA_MENSAL);

    expect(saldoCredor(FOLHA_MENSAL, SALARIOS_A_PAGAR)).toBeCloseTo(24209.4, 2);
    expect(totais.find((t) => t.conta === RESCISOES_A_PAGAR)).toBeUndefined();
  });

  it('as duas competências juntas reproduzem a tela de Pagamentos do Domínio', () => {
    const tudo = [...FOLHA_MENSAL, ...RESCISAO];

    expect(saldoCredor(tudo, SALARIOS_A_PAGAR)).toBeCloseTo(24209.4, 2);
    expect(saldoCredor(tudo, RESCISOES_A_PAGAR)).toBeCloseTo(2154.75, 2);
  });

  it('as despesas ficam separadas por natureza', () => {
    const totais = totaisDe([...FOLHA_MENSAL, ...RESCISAO]);

    expect(totais.find((t) => t.conta === '300')?.debito).toBeCloseTo(2017.08, 2); // gratificações
    expect(totais.find((t) => t.conta === '304')?.debito).toBeCloseTo(2088.92, 2); // FGTS
    expect(totais.find((t) => t.conta === '38')?.debito).toBeCloseTo(540.32, 2); // salário-família
  });

  it('tudo fecha em partida dobrada', () => {
    const totais = totaisDe([...FOLHA_MENSAL, ...RESCISAO]);
    const d = totais.reduce((s, t) => s + t.debito, 0);
    const c = totais.reduce((s, t) => s + t.credito, 0);
    expect(d).toBeCloseTo(c, 2);
  });
});

// ---------------------------------------------------------------------------
// O limite do relatório agregado
// ---------------------------------------------------------------------------

/**
 * O mesmo mês, mas do Resumo emitido como "Folha Mensal e Complementar" / "Todos": o saldo de
 * salário do desligado (1.370,96) está somado dentro da linha dos demais, e as férias
 * proporcionais dele aparecem na mesma rubrica das de todo mundo.
 */
const AGREGADO: Linha[] = [
  { id: 'a1', date: COMPETENCIA, description: '20 - GRATIFICACOES1', debito: 0, credito: 752.0, tipo: 'PROVENTOS' },
  { id: 'a2', date: COMPETENCIA, description: '229 - FERIAS PROPORCIONAIS', debito: 0, credito: 566.67, tipo: 'PROVENTOS' },
  { id: 'a3', date: COMPETENCIA, description: '243 - DESCANSO SEMANAL REMUNERADO2', debito: 0, credito: 2583.04, tipo: 'PROVENTOS' },
  { id: 'a4', date: COMPETENCIA, description: '249 - GRATIFICACAO', debito: 0, credito: 1077.08, tipo: 'PROVENTOS' },
  { id: 'a5', date: COMPETENCIA, description: '274 - GRATIFICAÇÃO DE FUNÇÃO', debito: 0, credito: 188.0, tipo: 'PROVENTOS' },
  { id: 'a6', date: COMPETENCIA, description: '995 - SALARIO FAMILIA .', debito: 0, credito: 540.32, tipo: 'PROVENTOS' },
  { id: 'a7', date: COMPETENCIA, description: '28169 - 1/3 FERIAS PROPORCIONAIS RESCISAO', debito: 0, credito: 188.89, tipo: 'PROVENTOS' },
  { id: 'a8', date: COMPETENCIA, description: '58550 - 13 SALARIO INTEGRAL RESCISAO', debito: 0, credito: 141.67, tipo: 'PROVENTOS' },
  { id: 'a9', date: COMPETENCIA, description: '8781 - SALARIO EMPREGADO 2', debito: 0, credito: 6484.0, tipo: 'PROVENTOS' },
  { id: 'a10', date: COMPETENCIA, description: '9179 - SALDO DE SALARIO HORAS2', debito: 0, credito: 13156.7, tipo: 'PROVENTOS' },
  { id: 'a11', date: COMPETENCIA, description: '9180 - SALDO DE SALARIO DIAS.2', debito: 0, credito: 3242.0, tipo: 'PROVENTOS' },
  { id: 'a12', date: COMPETENCIA, description: '51 - LIQUIDO RESCISAO', debito: 2154.75, credito: 0, tipo: 'DESCONTOS' },
  { id: 'a13', date: COMPETENCIA, description: '360 - DESC. EMP. CRED. TRAB Nº 0000001054844453', debito: 172.52, credito: 0, tipo: 'DESCONTOS' },
  { id: 'a14', date: COMPETENCIA, description: '362 - DESC. EMP. CRED. TRAB Nº 0000001079740603', debito: 40.07, credito: 0, tipo: 'DESCONTOS' },
  { id: 'a15', date: COMPETENCIA, description: '2826 - INSS SOBRE RESCISAO', debito: 102.82, credito: 0, tipo: 'DESCONTOS' },
  { id: 'a16', date: COMPETENCIA, description: '2989 - INSS 13 SAL.RESCISAO', debito: 10.62, credito: 0, tipo: 'DESCONTOS' },
  { id: 'a17', date: COMPETENCIA, description: '998 - I.N.S.S.', debito: 1985.19, credito: 0, tipo: 'DESCONTOS' },
  { id: 'a18', date: COMPETENCIA, description: '750 - DESC. EMP. CRED. TRAB Nº 00000001191563497', debito: 245.0, credito: 0, tipo: 'DESCONTOS' },
  { id: 'a19', date: COMPETENCIA, description: '996 - F.G.T.S DO MES', debito: 0, credito: 2088.92, tipo: 'INFORMATIVA' },
];

describe('Resumo agregado — o dado não permite separar', () => {
  it('salários a pagar NÃO fecha com o Domínio, e a diferença é o saldo do desligado', () => {
    const saldo = saldoCredor(AGREGADO, SALARIOS_A_PAGAR)!;

    // Sobra exatamente o saldo de salário do desligado, que veio somado na linha dos demais.
    expect(saldo).toBeCloseTo(24209.4 + 1370.96, 2);
    expect(saldo).not.toBeCloseTo(24209.4, 2);
  });

  it('rescisões a pagar também não fecha: só entra o que tem "rescisão" no nome', () => {
    const totais = totaisDe(AGREGADO);
    const rescisoes = totais.find((t) => t.conta === RESCISOES_A_PAGAR);

    // 1/3 férias 188,89 + 13º 141,67 − INSS 113,44 — longe dos 2.154,75 reais
    expect(-(rescisoes!.saldo)).toBeCloseTo(217.12, 2);
    expect(-(rescisoes!.saldo)).not.toBeCloseTo(2154.75, 2);
  });
});
