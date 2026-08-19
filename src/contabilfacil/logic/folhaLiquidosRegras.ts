/**
 * Transforma o "Relatório de Líquidos" da folha em regras de conciliação.
 *
 * A ideia central é a BUSCA QUE VAI ENCURTANDO:
 *   1. tenta achar o NOME COMPLETO no histórico do extrato;
 *   2. não achou? vai tirando a última palavra — nome + sobrenome;
 *   3. ainda não achou? tenta só o primeiro nome;
 *   4. nada disso achou? cai para o DOCUMENTO (CPF/RG, tolerando mascaramento);
 *   5. em último caso, casa pelo VALOR do líquido da respectiva competência.
 *
 * Um fragmento de nome só é aceito se NÃO servir também para outro funcionário
 * da mesma folha (senão "MARIA" roubaria o pagamento de duas pessoas).
 */
import type {
  ExtratoRegraConta,
  ExtratoRegraCompetenciaJanela,
} from './extratoRegrasContasStorage';
import {
  competenciaAceitaData,
  normalizeExtratoMatchText,
  REGRA_COMPETENCIA_JANELA_PADRAO,
  somenteDigitos,
} from './extratoRegrasContasStorage';
import { scoreDocumentoNoHistorico } from './extratoRegrasContasMatcher';
import type { FolhaLiquidoItem, ParsedFolhaLiquidos } from './folhaLiquidosParser';
import { competenciaOrdem } from './folhaLiquidosParser';

export type FolhaEstrategia = 'auto' | 'historico' | 'documento' | 'valor';

/** Como a regra daquele funcionário acabou sendo montada. */
export type FolhaEstrategiaResolvida = 'historico' | 'documento' | 'valor';

export type FolhaLinhaExtrato = {
  description: string;
  nature: string;
  value: number;
  date?: string;
};

export type FolhaCompetenciaValor = {
  competencia: string;
  valor: number;
  /**
   * Lançamentos do extrato aberto que ESTA linha (funcionário + competência)
   * identificaria, contados da competência em diante.
   *
   * É por competência de propósito: duas linhas com o mesmo critério, o mesmo
   * valor e a mesma competência têm obrigatoriamente o mesmo número.
   */
  correspondencias: number;
};

export type FolhaFuncionarioPlano = {
  /** Identificador estável dentro do plano (código + nome). */
  chave: string;
  codigo: string;
  nome: string;
  identidade: string;
  identidadeDigitos: string;
  categoria: string;
  competencias: FolhaCompetenciaValor[];
  /** Estratégia efetivamente escolhida. */
  estrategia: FolhaEstrategiaResolvida;
  /** Texto que a regra vai procurar no histórico (só no modo histórico). */
  textoBusca: string;
  /** Explicação curta para a prévia. */
  motivo: string;
  /** Quantas linhas do extrato essa regra casaria hoje. */
  linhasCasadas: number;
  /** Contrapartida escolhida para este funcionário. */
  conta: string;
};

/** Palavras que sozinhas não identificam ninguém — não viram fragmento de busca. */
const CONECTIVOS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);

function normalizarNome(nome: string): string {
  return normalizeExtratoMatchText(nome);
}

/** `alvo` aparece em `texto` como palavra/frase inteira. */
function contemFrase(texto: string, alvo: string): boolean {
  if (!alvo) return false;
  const escaped = alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?:[^A-Z0-9]|$)`).test(texto);
  } catch {
    return texto.includes(alvo);
  }
}

/**
 * Fragmentos do nome, do mais específico ao mais genérico:
 * nome completo → … → nome + sobrenome → primeiro nome.
 * Conectivos no fim ("MARIA APARECIDA DE") são descartados.
 */
export function fragmentosDoNome(nome: string): string[] {
  const palavras = normalizarNome(nome).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return [];
  const out: string[] = [];
  for (let n = palavras.length; n >= 1; n--) {
    const pedaco = palavras.slice(0, n);
    while (pedaco.length > 1 && CONECTIVOS.has(pedaco[pedaco.length - 1])) pedaco.pop();
    const texto = pedaco.join(' ');
    if (!texto) continue;
    // Fragmento de uma palavra só vale se não for conectivo.
    if (pedaco.length === 1 && CONECTIVOS.has(pedaco[0])) continue;
    if (!out.includes(texto)) out.push(texto);
  }
  return out;
}

/** Linhas de saída (pagamentos) do extrato — é onde o líquido da folha aparece. */
function linhasDeSaida(extrato: FolhaLinhaExtrato[]): string[] {
  return extrato
    .filter((r) => (r.nature === 'C' ? 'C' : 'D') === 'D')
    .map((r) => normalizeExtratoMatchText(r.description))
    .filter(Boolean);
}

/** O fragmento serve para outro funcionário também? Então é ambíguo. */
function fragmentoAmbiguo(fragmento: string, nomesNormalizados: string[]): boolean {
  let usos = 0;
  for (const nome of nomesNormalizados) {
    if (contemFrase(nome, fragmento)) usos += 1;
    if (usos > 1) return true;
  }
  return false;
}

export type PlanoFolhaInput = {
  parsed: ParsedFolhaLiquidos;
  /** Competências (MM/AAAA) que o usuário quer importar. */
  competenciasSelecionadas: string[];
  extrato: FolhaLinhaExtrato[];
  estrategia: FolhaEstrategia;
  contaPadrao: string;
};

export type PlanoFolha = {
  funcionarios: FolhaFuncionarioPlano[];
  /** Competências efetivamente consideradas. */
  competencias: string[];
};

/** Agrupa o relatório por funcionário e resolve a estratégia de busca de cada um. */
export function montarPlanoFolha(input: PlanoFolhaInput): PlanoFolha {
  const { parsed, competenciasSelecionadas, extrato, estrategia, contaPadrao } = input;
  const selecionadas = new Set(
    competenciasSelecionadas.length > 0
      ? competenciasSelecionadas
      : parsed.competencias.map((c) => c.competencia),
  );

  type CompetenciaBruta = { competencia: string; valor: number };
  type Acc = {
    item: FolhaLiquidoItem;
    competencias: CompetenciaBruta[];
  };
  const porFuncionario = new Map<string, Acc>();
  const competencias: string[] = [];

  for (const comp of parsed.competencias) {
    if (!selecionadas.has(comp.competencia)) continue;
    competencias.push(comp.competencia);
    for (const item of comp.itens) {
      const chave = `${item.codigo}|${normalizarNome(item.nome)}`;
      const cur = porFuncionario.get(chave);
      if (cur) {
        cur.competencias.push({ competencia: comp.competencia, valor: item.valor });
        // Documento vazio numa competência não apaga o que veio de outra.
        if (!cur.item.identidadeDigitos && item.identidadeDigitos) cur.item = item;
        continue;
      }
      porFuncionario.set(chave, {
        item,
        competencias: [{ competencia: comp.competencia, valor: item.valor }],
      });
    }
  }

  const nomesNormalizados = [...porFuncionario.values()].map((a) => normalizarNome(a.item.nome));
  const historicosSaida = linhasDeSaida(extrato);

  const funcionarios: FolhaFuncionarioPlano[] = [];
  for (const [chave, acc] of porFuncionario) {
    const { item } = acc;
    const nomeNorm = normalizarNome(item.nome);
    const fragmentos = fragmentosDoNome(item.nome);

    // 1) Nome — do completo ao primeiro nome, parando no primeiro que casa.
    let textoBusca = '';
    let linhasNome = 0;
    let houveAmbiguo = false;
    for (const frag of fragmentos) {
      if (fragmentoAmbiguo(frag, nomesNormalizados)) {
        houveAmbiguo = true;
        continue;
      }
      const casadas = historicosSaida.filter((h) => contemFrase(h, frag)).length;
      if (casadas > 0) {
        textoBusca = frag;
        linhasNome = casadas;
        break;
      }
    }

    // 2) Documento (CPF/RG), aceitando número mascarado no histórico.
    const doc = somenteDigitos(item.identidadeDigitos);
    const linhasDoc =
      doc.length >= 5
        ? historicosSaida.filter((h) => scoreDocumentoNoHistorico(h, doc) > 0).length
        : 0;

    let resolvida: FolhaEstrategiaResolvida;
    let motivo: string;
    let linhasCasadas: number;

    if (estrategia === 'historico') {
      resolvida = 'historico';
      textoBusca = textoBusca || fragmentos[0] || nomeNorm;
      linhasCasadas = linhasNome;
      motivo =
        linhasNome > 0
          ? `Nome localizado: "${textoBusca}"`
          : 'Nome não localizado no extrato';
    } else if (estrategia === 'documento') {
      resolvida = 'documento';
      linhasCasadas = linhasDoc;
      motivo =
        doc.length < 5
          ? 'Sem documento informado no relatório'
          : linhasDoc > 0
            ? `Documento ${doc} localizado no histórico`
            : 'Documento não localizado no extrato';
    } else if (estrategia === 'valor') {
      resolvida = 'valor';
      linhasCasadas = contarLinhasPorValor(extrato, acc.competencias);
      motivo = `Valor do líquido em ${acc.competencias.length} competência(s)`;
    } else if (textoBusca) {
      resolvida = 'historico';
      linhasCasadas = linhasNome;
      motivo =
        textoBusca === nomeNorm
          ? 'Nome completo localizado no histórico'
          : `Nome reduzido para "${textoBusca}"${
              houveAmbiguo ? ' — reduzir mais tornaria a busca ambígua' : ''
            }`;
    } else if (linhasDoc > 0) {
      resolvida = 'documento';
      linhasCasadas = linhasDoc;
      motivo = `Nome não localizado — identificação pelo documento ${doc}`;
    } else {
      resolvida = 'valor';
      linhasCasadas = contarLinhasPorValor(extrato, acc.competencias);
      motivo = 'Nome e documento não localizados — identificação pelo valor da competência';
    }

    const competenciasResolvidas: FolhaCompetenciaValor[] = [...acc.competencias]
      .sort((a, b) => competenciaOrdem(a.competencia) - competenciaOrdem(b.competencia))
      .map((c) => ({
        competencia: c.competencia,
        valor: c.valor,
        correspondencias: contarCorrespondencias(extrato, {
          criterio: resolvida,
          competencia: c.competencia,
          valor: c.valor,
          texto: textoBusca,
          documento: doc,
        }),
      }));

    funcionarios.push({
      chave,
      codigo: item.codigo,
      nome: item.nome,
      identidade: item.identidade,
      identidadeDigitos: doc,
      categoria: item.categoria,
      competencias: competenciasResolvidas,
      estrategia: resolvida,
      textoBusca: resolvida === 'historico' ? textoBusca || nomeNorm : '',
      motivo,
      linhasCasadas,
      conta: contaPadrao,
    });
  }

  funcionarios.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { funcionarios, competencias: [...new Set(competencias)] };
}

/** Quantas linhas do extrato têm exatamente algum dos líquidos do funcionário. */
function contarLinhasPorValor(
  extrato: FolhaLinhaExtrato[],
  competencias: Array<{ valor: number }>,
): number {
  const alvos = new Set(competencias.map((c) => Math.round(Math.abs(c.valor) * 100)));
  let n = 0;
  for (const row of extrato) {
    if ((row.nature === 'C' ? 'C' : 'D') !== 'D') continue;
    if (alvos.has(Math.round(Math.abs(Number(row.value) || 0) * 100))) n += 1;
  }
  return n;
}

type AlvoCorrespondencia = {
  criterio: FolhaEstrategiaResolvida;
  competencia: string;
  valor: number;
  texto: string;
  documento: string;
};

/**
 * Lançamentos do extrato que uma linha da prévia identificaria.
 *
 * Conta sempre pelo MESMO critério que a regra vai usar e dentro da mesma janela
 * de datas (da competência em diante). Assim duas linhas com o mesmo valor e a
 * mesma competência nunca exibem números diferentes.
 */
function contarCorrespondencias(extrato: FolhaLinhaExtrato[], alvo: AlvoCorrespondencia): number {
  const valorAlvo = Math.round(Math.abs(alvo.valor) * 100);
  let n = 0;
  for (const row of extrato) {
    if ((row.nature === 'C' ? 'C' : 'D') !== 'D') continue;
    if (!competenciaAceitaData(alvo.competencia, REGRA_COMPETENCIA_JANELA_PADRAO, row.date)) {
      continue;
    }
    if (alvo.criterio === 'valor') {
      if (Math.round(Math.abs(Number(row.value) || 0) * 100) === valorAlvo) n += 1;
      continue;
    }
    const historico = normalizeExtratoMatchText(row.description);
    if (!historico) continue;
    if (alvo.criterio === 'documento') {
      if (alvo.documento.length >= 5 && scoreDocumentoNoHistorico(historico, alvo.documento) > 0) {
        n += 1;
      }
      continue;
    }
    if (alvo.texto && contemFrase(historico, alvo.texto)) n += 1;
  }
  return n;
}

export type RegrasDaFolhaInput = {
  plano: PlanoFolha;
  contaBanco: string;
  janela: ExtratoRegraCompetenciaJanela;
};

/**
 * Converte o plano em regras prontas para gravar.
 * Histórico/documento geram UMA regra por funcionário; valor gera uma regra por
 * competência (é o valor daquele mês que identifica o pagamento).
 */
export function regrasDaFolha(
  input: RegrasDaFolhaInput,
): Array<Omit<ExtratoRegraConta, 'id'>> {
  const { plano, contaBanco, janela } = input;
  const out: Array<Omit<ExtratoRegraConta, 'id'>> = [];

  for (const f of plano.funcionarios) {
    const conta = f.conta.trim();
    if (!conta) continue;
    const base = {
      nature: 'D' as const,
      contaBanco: contaBanco.trim(),
      contaContrapartida: conta,
      origem: 'folha_liquidos' as const,
      funcionario: f.nome,
    };

    if (f.estrategia === 'historico') {
      const descricao = f.textoBusca.trim();
      if (!descricao) continue;
      out.push({ ...base, nome: descricao.slice(0, 40), descricao, matchTipo: 'historico' });
      continue;
    }

    if (f.estrategia === 'documento') {
      if (f.identidadeDigitos.length < 5) continue;
      out.push({
        ...base,
        nome: `DOC ${f.identidadeDigitos}`.slice(0, 40),
        descricao: f.nome,
        matchTipo: 'documento',
        documento: f.identidadeDigitos,
      });
      continue;
    }

    for (const comp of f.competencias) {
      out.push({
        ...base,
        nome: `${f.nome} ${comp.competencia}`.slice(0, 40),
        descricao: f.nome,
        matchTipo: 'valor',
        valor: Math.abs(comp.valor),
        competencia: comp.competencia,
        competenciaJanela: janela ?? REGRA_COMPETENCIA_JANELA_PADRAO,
      });
    }
  }

  return out;
}
