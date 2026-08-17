import type { AchadoAuditoriaBalancete } from './auditoriaBalanceteContinua';

export type ReferenciaNormativaDetalhada = {
  /** Por que o achado indica erro ou risco contábil. */
  explicacao: string;
  norma: string;
  normaParagrafo: string;
  normaTrecho: string;
};

const REF_PARTIDAS_DOBRADAS: ReferenciaNormativaDetalhada = {
  explicacao:
    'O razão/balancete não fecha: a soma dos débitos difere da soma dos créditos. Na contabilidade por partidas dobradas, cada fato contábil gera pelo menos um débito e um crédito de mesmo valor; o total do período deve zerar a diferença.',
  norma: 'ITG 2000 (R1) — Escrituração contábil de pequenas e médias empresas',
  normaParagrafo: 'Capítulo 4 (Método das partidas dobradas), itens 15 a 17',
  normaTrecho:
    'Cada transação ou evento que modifica o patrimônio [...] deve ser registrado mediante o método das partidas dobradas, de forma que a soma dos débitos seja igual à soma dos créditos.',
};

const REF_NATUREZA_INVERTIDA: ReferenciaNormativaDetalhada = {
  explicacao:
    'O saldo final está com natureza oposta à esperada para o grupo da conta (ex.: ativo com saldo credor, passivo com saldo devedor). Isso distorce o balanço, a DRE e indicadores; pode indicar classificação errada, estorno incompleto ou conta retificadora ausente.',
  norma: 'CPC 26 (R1) / NBC TG 26 (R5) — Apresentação das Demonstrações Contábeis',
  normaParagrafo: 'Itens 47 a 54 (estrutura patrimonial) e 71 a 73 (compensação)',
  normaTrecho:
    'As entidades devem apresentar ativos e passivos separadamente [...] Os ativos e passivos não devem ser compensados, salvo quando a compensação for exigida ou permitida por outra norma.',
};

const REF_BANCO_INVERTIDO: ReferenciaNormativaDetalhada = {
  explicacao:
    'Conta de banco ou disponibilidade com saldo credor (ou sinal contrário ao de ativo circulante). Saldo negativo de conta corrente pode exigir reclassificação para empréstimos no passivo (CPC 26). Saldo credor em conta de ativo impede leitura correta do caixa e da liquidez.',
  norma: 'CPC 26 (R1) / NBC TG 03 (R4) — Caixa e Equivalentes de Caixa',
  normaParagrafo: 'CPC 26, itens 54 e 66; NBC TG 03, itens 6 a 9 (definição de equivalentes)',
  normaTrecho:
    'Caixa e equivalentes de caixa compreendem caixa, depósitos bancários à vista e aplicações de alta liquidez [...] classificados no ativo circulante.',
};

const REF_BANCO_FORA_GRUPO1: ReferenciaNormativaDetalhada = {
  explicacao:
    'Conta identificada como banco ou disponibilidade não está no ativo circulante (grupo 1). Bancos e caixa devem integrar 1.1.1 / 1.1.2 para conciliação, DFC e ECD; em passivo (grupo 2) a natureza é de obrigação (empréstimo), não de disponibilidade.',
  norma: 'Manual de Escrituração Digital (ECD) — SPED Contábil / Receita Federal',
  normaParagrafo: 'Registro I155 (detalhes dos saldos) e tabela de plano referencial — grupo 1 (Ativo)',
  normaTrecho:
    'Os saldos das contas analíticas devem ser informados conforme o plano de contas adotado, respeitando a natureza contábil e a classificação patrimonial (ativo, passivo, PL, receitas, despesas).',
};

const REF_RF_BANCO_GRUPO: ReferenciaNormativaDetalhada = {
  explicacao:
    'A classificação contábil da conta não coincide com o grupo exigido pelo catálogo Receita Federal para contas bancárias (ativo, grupo 1, natureza devedora). Isso afeta conformidade do plano e regras automáticas de conciliação.',
  norma: 'CPC 26 / NBC TG 26 + catálogo RF (regras contábeis do sistema)',
  normaParagrafo: 'CPC 26, item 54 (ativo circulante); regra RF «Contas bancárias — ativo circulante»',
  normaTrecho:
    'Bancos e contas movimento no ativo (grupo 1) com natureza devedora. Saldo credor exige conferência (adiantamento, limite, classificação errada).',
};

const REF_RF_NATUREZA: ReferenciaNormativaDetalhada = {
  explicacao:
    'O saldo da conta não atende à natureza (D ou C) definida na regra fiscal/contábil vinculada ao tipo de conta (ex.: banco devedor, passivo credor). O lançamento ou o plano precisa ser ajustado.',
  norma: 'Regra Receita Federal (catálogo contábil) + CPC 26',
  normaParagrafo: 'Conforme fundamento da regra RF aplicada; CPC 26, itens 47 a 54',
  normaTrecho:
    'A apresentação e a classificação das contas devem refletir a natureza econômica do direito ou da obrigação.',
};

const REF_SEM_CLASSIFICACAO: ReferenciaNormativaDetalhada = {
  explicacao:
    'Linha do balancete sem código ou classificação estruturada. Sem conta contábil identificável não há rastreio na ECD, conciliação automática nem validação por grupo (ativo/passivo).',
  norma: 'ITG 2000 (R1) / NBC TG 1000 — Escrituração',
  normaParagrafo: 'ITG 2000, Capítulo 5 (livros e registros); NBC TG 1000, item 20',
  normaTrecho:
    'A escrituração deve ser realizada com clareza, facilitando sua compreensão e o correto registro dos fatos contábeis.',
};

const REF_PASSIVO_FOLHA: ReferenciaNormativaDetalhada = {
  explicacao:
    'Obrigação de folha ou provisão com saldo de natureza devedora ou fora do passivo. Salários, férias, 13º e encargos a pagar são passivos exigíveis de natureza credora (grupo 2).',
  norma: 'CPC 26 (R1) + eSocial / legislação trabalhista',
  normaParagrafo: 'CPC 26, itens 61 a 64 (passivo exigível); CLT arts. 457 e 477 (verbas rescisórias)',
  normaTrecho:
    'Passivo exigível é a obrigação presente derivada de eventos passados, cuja liquidação exige saída de recursos.',
};

const REF_IMPOSTO_PASSIVO: ReferenciaNormativaDetalhada = {
  explicacao:
    'Conta de imposto/obrigação tributária no passivo com saldo devedor. Tributos a recolher são obrigações (natureza credora); saldo devedor sugere pagamento a maior, compensação mal classificada ou conta no grupo errado.',
  norma: 'CPC 26 (R1) / CTN',
  normaParagrafo: 'CPC 26, itens 61 a 64; CTN art. 113 (obrigação tributária)',
  normaTrecho:
    'A obrigação tributária surge com a ocorrência do fato gerador, nos termos da legislação aplicável.',
};

const REF_GENERICO: ReferenciaNormativaDetalhada = {
  explicacao:
    'O saldo ou a classificação da conta divergem da estrutura patrimonial e das regras contábeis adotadas no sistema (CPC/RF). Revise o plano de contas, os lançamentos do período e a natureza D/C.',
  norma: 'CPC 26 (R1) / NBC TG 26 (R5)',
  normaParagrafo: 'Itens 40 a 54 (estrutura das demonstrações)',
  normaTrecho:
    'As demonstrações contábeis devem apresentar informação relevante e fidedigna sobre a entidade.',
};

function mergeRef(
  achado: Pick<AchadoAuditoriaBalancete, 'detalhe' | 'norma'>,
  ref: ReferenciaNormativaDetalhada,
): ReferenciaNormativaDetalhada {
  return {
    ...ref,
    explicacao: achado.detalhe?.trim()
      ? `${ref.explicacao} Detalhe identificado: ${achado.detalhe.trim()}`
      : ref.explicacao,
    norma: achado.norma?.trim() || ref.norma,
  };
}

/** Resolve texto didático + citação normativa para o PDF e telas de auditoria. */
export function resolverReferenciaNormativaAchado(
  achado: Pick<AchadoAuditoriaBalancete, 'id' | 'titulo' | 'detalhe' | 'norma'>,
): ReferenciaNormativaDetalhada {
  const titulo = achado.titulo.toLowerCase();
  const id = achado.id.toLowerCase();

  if (id === 'partida-dobrada' || titulo.includes('diferença entre débitos')) {
    return mergeRef(achado, REF_PARTIDAS_DOBRADAS);
  }
  if (titulo.includes('fora do ativo') || id.startsWith('banco-grupo')) {
    return mergeRef(achado, REF_BANCO_FORA_GRUPO1);
  }
  if (
    titulo.includes('banco') &&
    (titulo.includes('invertido') || titulo.includes('disponibilidade'))
  ) {
    return mergeRef(achado, REF_BANCO_INVERTIDO);
  }
  if (titulo.includes('grupo incorreto') || id.startsWith('rf-grupo')) {
    return mergeRef(achado, REF_RF_BANCO_GRUPO);
  }
  if (titulo.includes('natureza divergente') || id.startsWith('rf-nat')) {
    const ref = { ...REF_RF_NATUREZA };
    const mBanco = /rf-contabil-banco/i.test(id) || /bancári|banco/i.test(achado.titulo);
    const mCaixa = /rf-contabil-caixa/i.test(id) || /caixa|equivalente/i.test(achado.titulo);
    if (mBanco) {
      ref.norma = 'CPC 26 / NBC TG 26; ITG 2000 (R1); ECD registro I155';
      ref.normaParagrafo = 'Regra RF «Contas bancárias — ativo circulante»; CPC 26, item 54';
      ref.normaTrecho = REF_RF_BANCO_GRUPO.normaTrecho;
    } else if (mCaixa) {
      ref.norma = 'CPC 03 / NBC TG 03 (Caixa e Equivalentes); ITG 2000';
      ref.normaParagrafo = 'NBC TG 03, itens 6 a 9; regra RF «Caixa e equivalentes»';
      ref.normaTrecho =
        'Caixa e equivalentes de caixa compreendem caixa, depósitos bancários à vista e aplicações de alta liquidez.';
    }
    return mergeRef(achado, ref);
  }
  if (titulo.includes('natureza invertida') || id.startsWith('inv-')) {
    return mergeRef(achado, REF_NATUREZA_INVERTIDA);
  }
  if (titulo.includes('sem código') || titulo.includes('sem classificação') || id.startsWith('sem-class')) {
    return mergeRef(achado, REF_SEM_CLASSIFICACAO);
  }
  if (titulo.includes('folha') || id.startsWith('folha')) {
    return mergeRef(achado, REF_PASSIVO_FOLHA);
  }
  if (titulo.includes('imposto') && titulo.includes('passivo')) {
    return mergeRef(achado, REF_IMPOSTO_PASSIVO);
  }

  return mergeRef(achado, REF_GENERICO);
}

export function enriquecerAchadoAuditoria(achado: AchadoAuditoriaBalancete): AchadoAuditoriaBalancete {
  const ref = resolverReferenciaNormativaAchado(achado);
  return {
    ...achado,
    explicacao: ref.explicacao,
    normaParagrafo: ref.normaParagrafo,
    normaTrecho: ref.normaTrecho,
    norma: ref.norma,
  };
}
