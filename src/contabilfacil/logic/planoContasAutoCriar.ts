import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { derivePlanoGroupFromCode, derivePlanoNatureFromGroup, codeLengthToPlanoLevel } from './planoContasMapper';
import {
  addContaToMatchKeys,
  buildContaMatchKeys,
  contaMatchesKeys,
  type ContaMatchKeys,
} from '../../extratoVision/utils/razaoContabil';

export type AccountPlanNovo = {
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: 'S' | 'A';
  nivel?: number;
  group?: 'ATIVO' | 'PASSIVO' | 'PATRIMONIO_LIQUIDO' | 'RECEITA' | 'DESPESA';
  nature?: 'DEVEDORA' | 'CREDORA';
  /** Conta criada automaticamente a partir do razão — ainda precisa de um nome de verdade. */
  precisaRenomear?: boolean;
};

/**
 * Lançamentos do razão cuja classificação/código não existe no plano de contas viram
 * contas "órfãs" flutuando fora do grupo certo no balancete (em vez de sumir). Esta
 * função gera as entradas de plano correspondentes — nível/grupo/natureza inferidos
 * pela própria classificação — para que, uma vez salvas no plano, a conta se encaixe
 * automaticamente na hierarquia certa e apareça na lista de "contas a renomear".
 */
function isCnpjOrMetadata(classificacao: string): boolean {
  const digits = classificacao.replace(/\D/g, '');
  // Rejeita se parecer CNPJ (14+ dígitos contínuos) ou tiver padrão CNPJ formatado
  if (digits.length >= 14) return true;
  if (/\d{2}\.?\d{3}\.?\d{3}[\/\-]?\d{4}[\-]?\d{2}/.test(classificacao)) return true;
  return false;
}

export function detectarContasNovas(
  razaoRows: VisionBalanceteRow[],
  planoAtual: Array<{ code: string; codigoReduzido?: string }>,
): AccountPlanNovo[] {
  // Usa a mesma disciplina de `findPlanoRow`/`contaMatchesKeys` (código com pontos
  // só casa por classificação; código solto é tratado como reduzido) — antes essa
  // função normalizava a string inteira de uma vez só, sem respeitar segmento a
  // segmento, então uma conta já existente cuja classificação viesse grafada com
  // padding de zeros diferente do plano (comum entre importações de meses
  // distintos) era tratada como "nova" e ficava presa em "contas a renomear",
  // somindo do balancete/export até o usuário confirmar manualmente.
  const existentes = buildContaMatchKeys(planoAtual);
  // Acumula as contas novas já detectadas nesta própria chamada, para não gerar
  // duas entradas pendentes pra mesma conta grafada de formas diferentes.
  const pendentes: ContaMatchKeys = { byCls: new Set(), byReduced: new Set() };

  const novas: AccountPlanNovo[] = [];
  for (const r of razaoRows) {
    const classificacao = (r.classificacao || r.codigo || '').trim();
    // Classificação/código de conta é só dígitos e pontos (ex.: "1.1.1.02.01109" ou
    // "0001109") — qualquer outro caractere (barra, hífen, letra) indica que o texto
    // não é uma conta de verdade (ex.: um CNPJ "44.854.551/0001-98" vazado do arquivo).
    if (!classificacao || !/^\d+(\.\d+)*$/.test(classificacao)) continue;
    // Rejeita CNPJs e dados de metadados que foram truncados
    if (isCnpjOrMetadata(classificacao)) continue;

    const rowKey = { classificacao: r.classificacao, codigo: r.codigo };
    if (contaMatchesKeys(rowKey, existentes)) continue;
    if (contaMatchesKeys(rowKey, pendentes)) continue;

    // Se classificacao não tem pontos (é código reduzido), NÃO pode ser usada como code
    // Precisa gerar uma classificação estruturada correta seguindo a hierarquia do grupo
    const temPontos = classificacao.includes('.');
    let codeGerado = classificacao;

    if (!temPontos) {
      // Código reduzido solto — não tem classificação estruturada
      // Deixa para o usuário preencher manualmente quando tiver nomeado a conta
      codeGerado = '';
    }

    const group = temPontos ? derivePlanoGroupFromCode(classificacao) : undefined;
    // Código reduzido: usa r.codigo quando não tem pontos (é código reduzido direto),
    // ou quando tem pontos mas r.codigo é diferente da classificação (reduzido separado).
    const codigoReduzido = r.codigo && r.codigo !== classificacao ? r.codigo : (temPontos ? undefined : r.codigo || undefined);

    if (!codeGerado && !codigoReduzido) continue;

    novas.push({
      code: codeGerado || codigoReduzido || '',
      name: `CONTA NOVA — ${r.nome || classificacao}`,
      codigoReduzido,
      tipo: 'A',
      nivel: temPontos ? codeLengthToPlanoLevel(classificacao) : undefined,
      group,
      nature: group ? derivePlanoNatureFromGroup(group) : undefined,
      precisaRenomear: true,
    });
    addContaToMatchKeys(pendentes, { code: codeGerado, codigoReduzido });
  }
  return novas;
}
