/**
 * Consolidação / merge: 1 regra por entidade + natureza (AJTF D / AJTF C).
 */
import type { AiColigada } from './aiInteligenciaStorage';
import { aliasMatchesHistorico, isNomeColigadaInvalido, matchColigadaNoHistorico } from './aiInteligenciaStorage';
import {
  canonicalColigadaDescricao,
  extractRegraEntityDescricao,
  resolveDescricaoRegraColigada,
  resolveDescricaoRegraSocio,
  razaoSocialColigadaDescricao,
  sanitizarHistoricoExtratoParaRegra,
} from './extratoRegrasCobertura';
import type { ExtratoRegraConta } from './extratoRegrasContasStorage';
import {
  normalizeExtratoMatchText,
  normContaBancoCode,
} from './extratoRegrasContasStorage';

export {
  canonicalColigadaDescricao,
  extractRegraEntityDescricao,
  resolveDescricaoRegraColigada,
  resolveDescricaoRegraSocio,
  razaoSocialColigadaDescricao,
};

/** Chave de dedup: natureza + entidade (não o texto literal do PIX). */
export function regraEntityDedupKey(
  regra: Pick<ExtratoRegraConta, 'descricao' | 'nature' | 'contaBanco' | 'contaContrapartida'>,
  coligadas: AiColigada[] = [],
): string {
  const nature = regra.nature === 'C' ? 'C' : 'D';
  const entity = extractRegraEntityDescricao(regra.descricao, nature, coligadas);
  return `${nature}|${normalizeExtratoMatchText(entity)}|${normContaBancoCode(regra.contaBanco)}|${normContaBancoCode(regra.contaContrapartida)}`;
}

/** Prefere histórico completo do extrato quando um texto contém o outro. */
function preferDescricao(a: string, b: string): string {
  const na = normalizeExtratoMatchText(a);
  const nb = normalizeExtratoMatchText(b);
  if (!na) return nb;
  if (!nb) return na;
  if (na === nb) return na;
  if (na.includes(nb)) return na;
  if (nb.includes(na)) return nb;
  if (na.length !== nb.length) return na.length >= nb.length ? na : nb;
  if (na.length <= 12 && !na.includes(' ') && nb.includes(' ')) return nb;
  if (nb.length <= 12 && !nb.includes(' ') && na.includes(' ')) return na;
  return na.length <= nb.length ? na : nb;
}

/**
 * Consolida regras duplicadas da mesma entidade+natureza+banco.
 * Ex.: "PIX RECEBIDO A J T" + "A J T F LTDA" (mesma nature) → 1 regra "AJTF".
 */
export function consolidateExtratoRegras(
  regras: ExtratoRegraConta[],
  coligadas: AiColigada[] = [],
): ExtratoRegraConta[] {
  if (regras.length <= 1) return regras;

  const groups = new Map<string, ExtratoRegraConta>();
  let changed = false;

  for (const r of regras) {
    const nature = r.nature === 'C' ? 'C' : 'D';
    const entityDesc = extractRegraEntityDescricao(r.descricao, nature, coligadas);
    if (!entityDesc) {
      groups.set(`raw|${r.id}`, r);
      continue;
    }

    // Inclui contaContrapartida na chave — sem isso, duas regras legítimas
    // para a mesma entidade/natureza/banco mas com contas de classificação
    // DIFERENTES eram mescladas em uma só, descartando silenciosamente uma
    // delas (bug real: regras cadastradas pelo usuário "sumiam" ao trocar
    // de empresa ou reimportar backup, porque essa consolidação roda
    // automaticamente nesses momentos).
    const groupKey = `${nature}|${normalizeExtratoMatchText(entityDesc)}|${normContaBancoCode(r.contaBanco)}|${normContaBancoCode(r.contaContrapartida)}`;
    const existing = groups.get(groupKey);
    if (!existing) {
      groups.set(groupKey, {
        ...r,
        descricao: r.descricao,
        nome: r.descricao.slice(0, 40),
      });
      continue;
    }

    changed = true;
    const preferredDesc = preferDescricao(existing.descricao, r.descricao);
    groups.set(groupKey, {
      ...existing,
      descricao: preferredDesc,
      nome: preferredDesc.slice(0, 40),
      contaContrapartida: existing.contaContrapartida || r.contaContrapartida,
    });
  }

  const out = Array.from(groups.values());
  if (!changed && out.length === regras.length) return regras;
  return out;
}

export type RegraSugestaoInput = {
  descricao: string;
  nature: string;
  contaContrapartida: string;
};

/**
 * Mescla sugestões: 1 regra por entidade+natureza+banco.
 */
export function mergeSugestoesIntoRegras(input: {
  current: ExtratoRegraConta[];
  sugestoes: RegraSugestaoInput[];
  contaBanco: string;
  resolveContra: (raw: string) => string;
  coligadas?: AiColigada[];
}): { next: ExtratoRegraConta[]; added: number; updated: number } {
  const coligadas = input.coligadas ?? [];
  const banco = input.contaBanco.trim();
  let next = [...input.current];
  let added = 0;
  let updated = 0;
  const seenKeys = new Set(
    next
      .filter((r) => normContaBancoCode(r.contaBanco) === normContaBancoCode(banco))
      .map((r) => {
        const nature = r.nature === 'C' ? 'C' : 'D';
        const entity = extractRegraEntityDescricao(r.descricao, nature, coligadas);
        return `${nature}|${normalizeExtratoMatchText(entity)}|${normContaBancoCode(banco)}`;
      }),
  );

  for (const sug of input.sugestoes) {
    const contra = input.resolveContra(sug.contaContrapartida);
    const nature = sug.nature === 'C' ? ('C' as const) : ('D' as const);
    let entityDesc = extractRegraEntityDescricao(sug.descricao, nature, coligadas);
    let descRegra =
      normalizeExtratoMatchText(sanitizarHistoricoExtratoParaRegra(sug.descricao, nature, coligadas)) ||
      entityDesc;

    const coligHit = matchColigadaNoHistorico(sug.descricao, coligadas);
    if (coligHit && isNomeColigadaInvalido(descRegra)) {
      descRegra = razaoSocialColigadaDescricao(coligHit);
      entityDesc = descRegra;
    } else if (isNomeColigadaInvalido(descRegra)) {
      continue;
    }

    if (!contra || !entityDesc) continue;

    const groupKey = `${nature}|${normalizeExtratoMatchText(entityDesc)}|${normContaBancoCode(banco)}`;

    const sameEntity = next.find(
      (r) =>
        normContaBancoCode(r.contaBanco) === normContaBancoCode(banco) &&
        r.nature === nature &&
        normalizeExtratoMatchText(
          extractRegraEntityDescricao(r.descricao, nature, coligadas),
        ) === normalizeExtratoMatchText(entityDesc),
    );

    if (sameEntity) {
      const contraMudou =
        normContaBancoCode(sameEntity.contaContrapartida) !== normContaBancoCode(contra);
      const descMudou =
        normalizeExtratoMatchText(sameEntity.descricao) !== normalizeExtratoMatchText(descRegra);
      if (contraMudou || descMudou) {
        next = next.map((r) =>
          r.id === sameEntity.id
            ? {
                ...r,
                nature,
                contaContrapartida: contra,
                nome: descRegra.slice(0, 40),
                descricao: preferDescricao(sameEntity.descricao, descRegra),
              }
            : r,
        );
        updated += 1;
      }
      seenKeys.add(groupKey);
      continue;
    }

    if (seenKeys.has(groupKey)) continue;
    seenKeys.add(groupKey);
    next.push({
      id: crypto.randomUUID(),
      nome: descRegra.slice(0, 40),
      descricao: descRegra,
      nature,
      contaBanco: banco,
      contaContrapartida: contra,
    });
    added += 1;
  }

  return { next: consolidateExtratoRegras(next, coligadas), added, updated };
}

export function entityAliasMatchesHistorico(historico: string, regraDescricao: string): boolean {
  return aliasMatchesHistorico(historico, regraDescricao);
}
