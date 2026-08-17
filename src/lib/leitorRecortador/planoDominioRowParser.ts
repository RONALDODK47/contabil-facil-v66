/**
 * Extração posicional de linhas do Plano de Contas Domínio (PDF texto nativo).
 * Layout típico: [marcador 1] | reduzido | S/A | classificação | nome | grau
 */
import type { PDFTextItem } from './types';

const RE_CLASSIFICACAO = /^\d+(?:\.\d+)+$/;
const RE_CLASSIFICACAO_FLEX = /^\d+(?:\.\d+)*$/;

export type DominioPlanoBounds = {
  marcadorMax: number;
  reduzidoMax: number;
  tipoMax: number;
  classificacaoMax: number;
  descricaoMin: number;
  grauMin: number;
};

export function calibrateDominioPlanoBounds(
  items: PDFTextItem[],
  imgWidth: number,
): DominioPlanoBounds {
  const classXs = items
    .filter((it) => RE_CLASSIFICACAO.test(it.text.trim().replace(/\s/g, '')))
    .map((it) => it.x);
  const classX = classXs.length
    ? classXs.sort((a, b) => a - b)[Math.floor(classXs.length / 2)]!
    : imgWidth * 0.118;

  const redXs = items
    .filter((it) => {
      const s = it.text.trim();
      return /^\d{1,7}$/.test(s) && !s.includes('.') && it.x < classX - imgWidth * 0.04;
    })
    .map((it) => it.x);
  const redX = redXs.length
    ? redXs.sort((a, b) => a - b)[Math.floor(redXs.length / 2)]!
    : imgWidth * 0.055;

  const descXs = items
    .filter(
      (it) =>
        /[A-Za-zÀ-ÿ]{3,}/.test(it.text) &&
        it.x > classX + imgWidth * 0.12 &&
        it.x < imgWidth * 0.82,
    )
    .map((it) => it.x);
  const descX = descXs.length
    ? descXs.sort((a, b) => a - b)[Math.floor(descXs.length / 2)]!
    : imgWidth * 0.42;

  const grauXs = items
    .filter((it) => /^[1-6]$/.test(it.text.trim()) && it.x > imgWidth * 0.75)
    .map((it) => it.x);
  const grauX = grauXs.length
    ? grauXs.sort((a, b) => a - b)[Math.floor(grauXs.length / 2)]!
    : imgWidth * 0.9;

  return {
    marcadorMax: Math.max(12, redX * 0.55),
    reduzidoMax: classX - imgWidth * 0.02,
    tipoMax: classX - imgWidth * 0.005,
    classificacaoMax: descX - imgWidth * 0.04,
    descricaoMin: classX + imgWidth * 0.14,
    grauMin: grauX - imgWidth * 0.04,
  };
}

function tokenCenter(item: PDFTextItem): number {
  return item.x + item.width / 2;
}

/** Remove tipo S/A colado ao final do nome (coluna vizinha no PDF). */
export function stripTrailingPlanoTipoFromName(name: string): string {
  return name.replace(/\s+[SA]\s*$/i, '').replace(/\s+/g, ' ').trim();
}

function classificacaoRightEdge(items: PDFTextItem[]): number {
  let right = 0;
  for (const it of items) {
    const compact = it.text.trim().replace(/\s/g, '');
    if (RE_CLASSIFICACAO.test(compact) || (compact.includes('.') && RE_CLASSIFICACAO_FLEX.test(compact))) {
      right = Math.max(right, it.x + it.width);
    }
  }
  return right;
}

/** Extrai campos da linha usando posição X dos tokens (layout Domínio). */
export function extractPlanoDominioFieldsFromItems(
  items: PDFTextItem[],
  imgWidth: number,
  bounds?: DominioPlanoBounds,
): Record<string, string> {
  const b = bounds ?? calibrateDominioPlanoBounds(items, imgWidth);
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const fields: Record<string, string> = {};
  const descParts: string[] = [];
  const classRight = classificacaoRightEdge(sorted);
  const nomeMinX = Math.max(b.descricaoMin, classRight > 0 ? classRight + imgWidth * 0.008 : b.descricaoMin);

  for (const it of sorted) {
    const raw = it.text.trim();
    if (!raw) continue;
    const cx = tokenCenter(it);
    const compact = raw.replace(/\s/g, '');

    if (cx < b.marcadorMax && raw === '1') continue;

    if (
      cx < b.reduzidoMax &&
      /^\d{1,7}$/.test(compact) &&
      !compact.includes('.') &&
      !fields.codigoReduzido
    ) {
      fields.codigoReduzido = compact;
      continue;
    }

    if (cx < b.tipoMax && /^[SA]$/i.test(raw)) {
      fields.tipo = raw.toUpperCase();
      continue;
    }

    if (cx < b.classificacaoMax && RE_CLASSIFICACAO.test(compact)) {
      fields.codigoClassificacao = compact;
      continue;
    }

    if (
      cx < b.classificacaoMax &&
      RE_CLASSIFICACAO_FLEX.test(compact) &&
      compact.includes('.')
    ) {
      fields.codigoClassificacao = compact;
      continue;
    }

    if (cx >= b.grauMin && /^[1-6]$/.test(raw)) {
      fields.nivel = raw;
      continue;
    }
  }

  // Nome completo: todos os tokens entre classificação e grau (sem cortar).
  for (const it of sorted) {
    const raw = it.text.trim();
    if (!raw) continue;
    const cx = tokenCenter(it);
    const compact = raw.replace(/\s/g, '');

    if (it.x + it.width < nomeMinX - 4) continue;
    if (cx >= b.grauMin && /^[1-6]$/.test(raw)) continue;
    if (cx < b.tipoMax && /^[SA]$/i.test(raw)) continue;
    if (RE_CLASSIFICACAO_FLEX.test(compact) && compact.includes('.')) continue;
    if (!/[A-Za-zÀ-ÿ]/.test(raw)) continue;

    descParts.push(raw);
  }

  if (descParts.length) {
    fields.descricao = stripTrailingPlanoTipoFromName(descParts.join(' '));
  }

  return fields;
}

export function looksLikePlanoClassificacao(val: string | undefined): boolean {
  const c = (val ?? '').trim().replace(/\s/g, '');
  if (!c) return false;
  return RE_CLASSIFICACAO.test(c) || (c.includes('.') && /^\d+(?:\.\d+)*$/.test(c));
}
