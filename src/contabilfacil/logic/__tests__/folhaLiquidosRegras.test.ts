import { describe, it, expect } from 'vitest';
import { fragmentosDoNome, montarPlanoFolha, regrasDaFolha } from '../folhaLiquidosRegras';
import type { ParsedFolhaLiquidos } from '../folhaLiquidosParser';
import { matchExtratoRegraConta, scoreDocumentoNoHistorico } from '../extratoRegrasContasMatcher';
import type { ExtratoRegraConta } from '../extratoRegrasContasStorage';
import { REGRA_COMPETENCIA_JANELA_PADRAO } from '../extratoRegrasContasStorage';

function folha(): ParsedFolhaLiquidos {
  const item = (codigo: string, nome: string, identidade: string, valor: number) => ({
    codigo,
    nome,
    identidade,
    identidadeDigitos: identidade.replace(/\D/g, ''),
    valor,
    categoria: 'EMPREGADOS',
  });
  return {
    fileName: 'liquidos.pdf',
    empresa: 'OBRAS SOCIAIS',
    cnpj: '05.988.299/0001-58',
    issues: [],
    competencias: [
      {
        competencia: '01/2026',
        total: null,
        itens: [
          item('17', 'CAROLLINE TAVEIRA DOS SANTOS', '4279500', 1671.01),
          item('14', 'CLEDO TEIXEIRA', '2811027', 1499.43),
          item('6', 'IVANIR INACIO DA SILVA', '32012202433435', 1671.01),
          item('21', 'LAURA RODRIGUES DA SILVA', '6706157', 1670.0),
        ],
      },
      {
        competencia: '02/2026',
        total: null,
        itens: [
          item('17', 'CAROLLINE TAVEIRA DOS SANTOS', '4279500', 1671.12),
          item('14', 'CLEDO TEIXEIRA', '2811027', 1499.43),
          item('6', 'IVANIR INACIO DA SILVA', '32012202433435', 1671.12),
          item('21', 'LAURA RODRIGUES DA SILVA', '6706157', 1670.5),
        ],
      },
    ],
  };
}

const extrato = [
  // Nome completo no histórico.
  { description: 'PIX ENVIADO CAROLLINE TAVEIRA DOS SANTOS', nature: 'D', value: 1671.01, date: '2026-02-05' },
  // Só o começo do nome — força a busca a encurtar.
  { description: 'PIX ENVIADO CLEDO TEIXEIRA JUNIOR', nature: 'D', value: 1499.43, date: '2026-02-05' },
  // Nenhum nome, mas o CPF mascarado aparece.
  { description: 'TED PAGAMENTO SALARIO CPF 320122024***', nature: 'D', value: 1671.01, date: '2026-02-05' },
  // Nem nome nem documento — só o valor identifica.
  { description: 'PAGAMENTO FOLHA 02', nature: 'D', value: 1670.5, date: '2026-03-05' },
];

const plano = (estrategia: 'auto' | 'historico' | 'documento' | 'valor' = 'auto') =>
  montarPlanoFolha({
    parsed: folha(),
    competenciasSelecionadas: [],
    extrato,
    estrategia,
    contaPadrao: '2101',
  });

const byNome = (p: ReturnType<typeof plano>, nome: string) =>
  p.funcionarios.find((f) => f.nome.startsWith(nome))!;

describe('Folha de líquidos — busca que vai encurtando', () => {
  it('fragmentosDoNome vai do nome completo até o primeiro nome', () => {
    expect(fragmentosDoNome('MARIA APARECIDA DE SOUSA XAVIER')).toEqual([
      'MARIA APARECIDA DE SOUSA XAVIER',
      'MARIA APARECIDA DE SOUSA',
      'MARIA APARECIDA',
      'MARIA',
    ]);
  });

  it('usa o nome completo quando ele está no histórico', () => {
    const f = byNome(plano(), 'CAROLLINE');
    expect(f.estrategia).toBe('historico');
    expect(f.textoBusca).toBe('CAROLLINE TAVEIRA DOS SANTOS');
    expect(f.linhasCasadas).toBe(1);
  });

  it('encurta o nome até achar (histórico traz nome a mais)', () => {
    const f = byNome(plano(), 'CLEDO');
    expect(f.estrategia).toBe('historico');
    expect(f.textoBusca).toBe('CLEDO TEIXEIRA');
  });

  it('cai para o documento quando o nome não aparece', () => {
    const f = byNome(plano(), 'IVANIR');
    expect(f.estrategia).toBe('documento');
    expect(f.identidadeDigitos).toBe('32012202433435');
    expect(f.linhasCasadas).toBe(1);
  });

  it('cai para o valor da competência quando nome e documento falham', () => {
    const f = byNome(plano(), 'LAURA');
    expect(f.estrategia).toBe('valor');
    expect(f.competencias).toHaveLength(2);
  });

  it('estratégia fixa "só valor" ignora nome e documento', () => {
    expect(plano('valor').funcionarios.every((f) => f.estrategia === 'valor')).toBe(true);
  });

  it('gera uma regra por competência no modo valor e uma só nos demais', () => {
    const regras = regrasDaFolha({
      plano: plano(),
      contaBanco: '1076',
      janela: 'competencia_e_seguinte',
    });
    const laura = regras.filter((r) => r.funcionario?.startsWith('LAURA'));
    expect(laura).toHaveLength(2);
    expect(laura.map((r) => r.competencia)).toEqual(['01/2026', '02/2026']);
    expect(regras.filter((r) => r.funcionario?.startsWith('CAROLLINE'))).toHaveLength(1);
    expect(regras.every((r) => r.nature === 'D' && r.contaBanco === '1076')).toBe(true);
  });
});

describe('Documento mascarado no histórico', () => {
  it('acha o CPF completo', () => {
    expect(scoreDocumentoNoHistorico('PIX CPF 12345678900 SALARIO', '12345678900')).toBeGreaterThan(0);
  });

  it('acha quando só o começo do CPF aparece', () => {
    expect(scoreDocumentoNoHistorico('PIX CPF 123456789 SALARIO', '12345678900')).toBeGreaterThan(0);
  });

  it('acha quando só o fim do CPF aparece', () => {
    expect(scoreDocumentoNoHistorico('PIX CPF 45678900 SALARIO', '12345678900')).toBeGreaterThan(0);
  });

  it('não casa com número curto sem relação', () => {
    expect(scoreDocumentoNoHistorico('PIX AGENCIA 1234 SALARIO', '12345678900')).toBe(0);
  });

  it('prefere o documento que reconheceu o maior pedaço', () => {
    const regra = (documento: string, contra: string): ExtratoRegraConta => ({
      id: documento,
      nome: documento,
      descricao: 'FUNCIONARIO',
      nature: 'D',
      contaBanco: '1076',
      contaContrapartida: contra,
      matchTipo: 'documento',
      documento,
    });
    const hit = matchExtratoRegraConta(
      'PIX CPF 12345678900',
      'D',
      [regra('12345678911', '111'), regra('12345678900', '222')],
      undefined,
      '2026-02-05',
    );
    expect(hit?.contaContrapartida).toBe('222');
  });
});

describe('Competência em diante (padrão das regras importadas)', () => {
  const regra: ExtratoRegraConta = {
    id: 'v1',
    nome: 'LAURA 01/2026',
    descricao: 'LAURA RODRIGUES DA SILVA',
    nature: 'D',
    contaBanco: '1076',
    contaContrapartida: '2101',
    matchTipo: 'valor',
    valor: 1670,
    competencia: '01/2026',
    competenciaJanela: 'competencia_em_diante',
  };

  it('procura no próprio mês e em todos os meses seguintes', () => {
    for (const data of ['2026-01-31', '2026-02-05', '2026-03-05', '2026-04-10', '2026-12-20']) {
      expect(matchExtratoRegraConta('PAGAMENTO', 'D', [regra], 1670, data)).not.toBeNull();
    }
  });

  it('não olha para trás da competência', () => {
    expect(matchExtratoRegraConta('PAGAMENTO', 'D', [regra], 1670, '2025-12-28')).toBeNull();
  });

  it('atravessa a virada do ano', () => {
    const dez = { ...regra, competencia: '12/2025' };
    expect(matchExtratoRegraConta('PAGAMENTO', 'D', [dez], 1670, '2026-03-05')).not.toBeNull();
    expect(matchExtratoRegraConta('PAGAMENTO', 'D', [dez], 1670, '2025-11-30')).toBeNull();
  });

  it('é a janela que a importação da folha grava', () => {
    const regras = regrasDaFolha({
      plano: plano('valor'),
      contaBanco: '1076',
      janela: REGRA_COMPETENCIA_JANELA_PADRAO,
    });
    expect(REGRA_COMPETENCIA_JANELA_PADRAO).toBe('competencia_em_diante');
    expect(regras.every((r) => r.competenciaJanela === 'competencia_em_diante')).toBe(true);
  });
});

describe('Janela de competência (modos antigos já gravados)', () => {
  const regraValor: ExtratoRegraConta = {
    id: 'v1',
    nome: 'LAURA 01/2026',
    descricao: 'LAURA RODRIGUES DA SILVA',
    nature: 'D',
    contaBanco: '1076',
    contaContrapartida: '2101',
    matchTipo: 'valor',
    valor: 1670,
    competencia: '01/2026',
    competenciaJanela: 'competencia_e_seguinte',
  };

  it('casa no mês da competência e no mês seguinte', () => {
    expect(matchExtratoRegraConta('PAGAMENTO', 'D', [regraValor], 1670, '2026-01-31')).not.toBeNull();
    expect(matchExtratoRegraConta('PAGAMENTO', 'D', [regraValor], 1670, '2026-02-05')).not.toBeNull();
  });

  it('não casa fora da janela', () => {
    expect(matchExtratoRegraConta('PAGAMENTO', 'D', [regraValor], 1670, '2026-03-05')).toBeNull();
    expect(matchExtratoRegraConta('PAGAMENTO', 'D', [regraValor], 1670, '2025-12-05')).toBeNull();
  });

  it('vira dezembro→janeiro corretamente', () => {
    const dez = { ...regraValor, competencia: '12/2025' };
    expect(matchExtratoRegraConta('PAGAMENTO', 'D', [dez], 1670, '2026-01-05')).not.toBeNull();
  });

  it('sem data na linha, a competência não bloqueia o match', () => {
    expect(matchExtratoRegraConta('PAGAMENTO', 'D', [regraValor], 1670)).not.toBeNull();
  });

  it('aceita data em formato BR', () => {
    expect(matchExtratoRegraConta('PAGAMENTO', 'D', [regraValor], 1670, '05/02/2026')).not.toBeNull();
  });
});

/**
 * Duas pessoas, mesma competência, mesmo valor, mesmo critério — a prévia tem
 * que mostrar o MESMO número de correspondências. Antes a contagem era por
 * funcionário (somando todas as competências dele), então quem tinha valores
 * diferentes nos outros meses exibia um número diferente na mesma linha.
 */
describe('Correspondências da prévia são por competência', () => {
  const duasPessoas: ParsedFolhaLiquidos = {
    fileName: 'liquidos.pdf',
    empresa: '',
    cnpj: '',
    issues: [],
    competencias: [
      {
        competencia: '01/2026',
        total: null,
        itens: [
          {
            codigo: '21',
            nome: 'LAURA RODRIGUES DA SILVA',
            identidade: '6706157',
            identidadeDigitos: '6706157',
            valor: 1671.01,
            categoria: 'EMPREGADOS',
          },
          {
            codigo: '30',
            nome: 'MARIA APARECIDA DE SOUSA XAVIER',
            identidade: '4700464',
            identidadeDigitos: '4700464',
            valor: 1671.01,
            categoria: 'EMPREGADOS',
          },
        ],
      },
      {
        // Nos outros meses os valores divergem — não pode afetar a linha de 01/2026.
        competencia: '02/2026',
        total: null,
        itens: [
          {
            codigo: '21',
            nome: 'LAURA RODRIGUES DA SILVA',
            identidade: '6706157',
            identidadeDigitos: '6706157',
            valor: 1761.68,
            categoria: 'EMPREGADOS',
          },
          {
            codigo: '30',
            nome: 'MARIA APARECIDA DE SOUSA XAVIER',
            identidade: '4700464',
            identidadeDigitos: '4700464',
            valor: 1671.12,
            categoria: 'EMPREGADOS',
          },
        ],
      },
    ],
  };

  // Nenhum nome/documento no histórico: as duas caem no critério de valor.
  const extratoFolha = [
    { description: 'PAGAMENTO FOLHA', nature: 'D', value: 1671.01, date: '2026-02-05' },
    { description: 'PAGAMENTO FOLHA', nature: 'D', value: 1671.01, date: '2026-02-05' },
    { description: 'PAGAMENTO FOLHA', nature: 'D', value: 1671.12, date: '2026-03-05' },
    { description: 'PAGAMENTO FOLHA', nature: 'D', value: 1761.68, date: '2026-03-05' },
  ];

  const planoDuas = montarPlanoFolha({
    parsed: duasPessoas,
    competenciasSelecionadas: [],
    extrato: extratoFolha,
    estrategia: 'auto',
    contaPadrao: '2101',
  });

  const linha = (nome: string, competencia: string) =>
    planoDuas.funcionarios
      .find((f) => f.nome.startsWith(nome))!
      .competencias.find((c) => c.competencia === competencia)!;

  it('mesmo valor + mesma competência ⇒ mesma contagem para pessoas diferentes', () => {
    const laura = linha('LAURA', '01/2026');
    const maria = linha('MARIA', '01/2026');
    expect(laura.valor).toBe(maria.valor);
    expect(laura.correspondencias).toBe(maria.correspondencias);
    expect(laura.correspondencias).toBe(2);
  });

  it('cada competência conta o próprio valor, não a soma do funcionário', () => {
    expect(linha('LAURA', '02/2026').correspondencias).toBe(1);
    expect(linha('MARIA', '02/2026').correspondencias).toBe(1);
  });

  it('não conta lançamento anterior à competência', () => {
    const soAntes = montarPlanoFolha({
      parsed: duasPessoas,
      competenciasSelecionadas: ['02/2026'],
      extrato: [{ description: 'PAGAMENTO FOLHA', nature: 'D', value: 1761.68, date: '2026-01-05' }],
      estrategia: 'valor',
      contaPadrao: '2101',
    });
    const laura = soAntes.funcionarios
      .find((f) => f.nome.startsWith('LAURA'))!
      .competencias.find((c) => c.competencia === '02/2026')!;
    expect(laura.correspondencias).toBe(0);
  });
});
