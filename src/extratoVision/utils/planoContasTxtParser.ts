import type { VisionPlanoRow } from '../types/accounting';
import {
  acceptCodigoReduzidoFromFile,
  isDominioReduzidoZeroPadded,
  isReduzidoPrimeiroPair,
  parsePlanoTxtParts,
  sanitizeCodigoReduzido,
} from '../../contabilfacil/logic/planoContasMapper';
import { inferAccountTypes } from './planilhaModelo';

function codeLengthToLevel(len: number): number {
  if (len <= 1) return 1;
  if (len <= 2) return 2;
  if (len <= 3) return 3;
  if (len <= 5) return 4;
  if (len <= 10) return 5;
  return 6;
}

/**
 * Domínio/Alterdata (largura fixa): o campo de código é sempre uma string de até
 * 12 dígitos representando grupo(1) + subgrupo(1) + subsubgrupo(1) + conta(2) +
 * subconta(5) concatenados SEM ponto, com zeros à esquerda até completar 12 —
 * o número de dígitos "significativos" (sem os zeros de preenchimento) indica o
 * nível: 1 dígito = grupo, 2 = grupo.subgrupo, 3 = +subsubgrupo, 5 = +conta(2),
 * 10 = +subconta(5). Sem essa conversão, a classificação vinha "0000000000005"
 * em vez de "5", quebrando toda relação pai/filho (isFilhaDe, nível, etc.).
 */
function fixedWidthCodigoParaClassificacao(rawDigits: string): string {
  const stripped = rawDigits.replace(/^0+/, '') || '0';
  const len = stripped.length;
  if (len <= 1) return stripped;
  if (len === 2) return `${stripped[0]}.${stripped[1]}`;
  if (len === 3) return `${stripped[0]}.${stripped[1]}.${stripped[2]}`;
  if (len <= 5) {
    const p = stripped.padStart(5, '0');
    return `${p[0]}.${p[1]}.${p[2]}.${p.slice(3, 5)}`;
  }
  const p = stripped.padStart(10, '0');
  return `${p[0]}.${p[1]}.${p[2]}.${p.slice(3, 5)}.${p.slice(5, 10)}`;
}

/** Formato largura fixa Domínio/Alterdata: 7-digit reduzido | código | descrição | S/A */
export function parsePlanoFixedWidth(text: string): VisionPlanoRow[] {
  const rows: VisionPlanoRow[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    if (raw.length < 10) continue;
    if (!/^\d{7}/.test(raw)) continue;
    if (/^9{10,}/.test(raw)) continue;

    const codigoReduzidoRaw = raw.slice(0, 7);
    const codigoReduzido = isDominioReduzidoZeroPadded(codigoReduzidoRaw)
      ? codigoReduzidoRaw
      : undefined;

    let codigo = raw.slice(7, 26).replace(/\D/g, '');
    if (!codigo) {
      const codigoMatch = raw.slice(7).match(/(\d{1,19})/);
      if (!codigoMatch) continue;
      codigo = codigoMatch[1];
    }

    let nome = '';
    let tipo: 'S' | 'A' | undefined;

    if (raw.length >= 27) {
      nome = raw.slice(26, 66).trim();
    }

    if (raw.length >= 67) {
      const t = raw.slice(66, 67).trim();
      if (t === 'S' || t === 'A') tipo = t;
    }

    if (!nome) {
      const rest = raw.slice(26).trimStart();
      const m = rest.match(/^(.+?)\s+([SA])\s*$/);
      if (m) {
        nome = m[1].trim();
        tipo = m[2] as 'S' | 'A';
      } else {
        nome = rest.replace(/\s+[SA]\s*$/, '').trim();
      }
    }

    if (!codigo || !nome) continue;

    const classificacao = fixedWidthCodigoParaClassificacao(codigo);

    const key = `${classificacao}::${nome}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      codigo: classificacao,
      nome,
      codigoReduzido,
      tipo,
      nivel: classificacao.split('.').filter(Boolean).length,
    });
  }

  return rows;
}

export function isPlanoFixedWidthFormat(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const matching = lines.filter((l) => /^\d{7}\d+\s/.test(l) && isDominioReduzidoZeroPadded(l.slice(0, 7)));
  return matching.length >= 3;
}

function isPlanoHeaderLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    (lower.includes('reduzido') || lower.includes('classifica') || lower.includes('codigo')) &&
    (lower.includes('descri') || lower.includes('nome') || lower.includes('tipo'))
  );
}

/** CSV/TXT Domínio: reduzido;classificação;descrição;tipo (prioridade sobre largura fixa). */
export function isPlanoSemicolonFormat(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;

  const semi = lines.filter((l) => /[;|]/.test(l) && !isPlanoHeaderLine(l));
  if (semi.length < Math.min(2, lines.length)) return false;

  const planoLike = semi.filter((l) => {
    const parts = l.split(/[;|]/).map((s) => s.trim());
    if (parts.length < 3) return false;
    const [p0, p1, p2] = parts;
    if (isReduzidoPrimeiroPair(p0, p1) && p2.length > 1) return true;
    if (/^\d[\d.]{0,19}$/.test(p0) && p1.length > 1 && !/^\d[\d.]{0,19}$/.test(p1)) return true;
    return false;
  });

  return planoLike.length >= Math.min(2, semi.length);
}

export function parsePlanoSemicolon(text: string): VisionPlanoRow[] {
  const rows: VisionPlanoRow[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !/[;|]/.test(line) || isPlanoHeaderLine(line)) continue;

    const parts = line.split(/[;|]/).map((s) => s.trim());
    if (parts.length < 2) continue;

    const parsed = parsePlanoTxtParts(parts);
    const code = parsed.code?.trim();
    const name = parsed.name?.trim();
    if (!code || !name || name === 'CONTA PADRAO') continue;

    const key = `${code}::${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      codigo: code,
      nome: name,
      codigoReduzido: parsed.codigoReduzido,
      tipo: parsed.tipo,
      nivel: parsed.nivel ?? codeLengthToLevel(code.replace(/\./g, '').length),
    });
  }

  return rows;
}

export function parsePlanoSpedI010(text: string): VisionPlanoRow[] {
  const rows: VisionPlanoRow[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    if (!/^\|I010\|/i.test(raw.trim())) continue;
    const parts = raw.trim().split('|');
    const cod = (parts[2] ?? '').trim();
    const ind = (parts[3] ?? '').trim().toUpperCase();
    const desc = (parts[4] ?? '').trim();
    const nivelStr = (parts[5] ?? '').trim();
    const nivel = parseInt(nivelStr, 10) || codeLengthToLevel(cod.length);
    if (!cod || !desc) continue;
    const key = `${cod}::${desc}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const tipo: 'S' | 'A' | undefined = ind === 'S' || ind === 'A' ? ind : undefined;
    rows.push({ codigo: cod, nome: desc, tipo, nivel });
  }

  return rows;
}

export function parsePlanoTextFree(text: string): VisionPlanoRow[] {
  const rows: VisionPlanoRow[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length < 3) continue;

    if (line.startsWith('|')) {
      const parts = line.split('|');
      const maybeCod = (parts[1] ?? '').trim();
      const maybeDesc = (parts[2] ?? '').trim();
      const maybeTipoRaw = (parts[3] ?? '').trim().toUpperCase();
      const maybeTipo: 'S' | 'A' | undefined =
        maybeTipoRaw === 'S' || maybeTipoRaw === 'A' ? maybeTipoRaw : undefined;

      if (/^\d[\d.]{0,19}$/.test(maybeCod) && maybeDesc.length > 1) {
        const key = `${maybeCod}::${maybeDesc}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({
            codigo: maybeCod,
            nome: maybeDesc,
            tipo: maybeTipo,
            nivel: codeLengthToLevel(maybeCod.replace(/\./g, '').length),
          });
        }
        continue;
      }
    }

    if (line.includes('\t')) {
      const parts = line.split('\t').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const maybeReduzido = parts[0];
        const maybeClassif = parts[1];
        const maybeDesc = parts[2];
        const maybeTipoRaw = (parts[3] ?? '').trim().toUpperCase();
        const maybeTipo: 'S' | 'A' | undefined =
          maybeTipoRaw === 'S' || maybeTipoRaw === 'A' ? maybeTipoRaw : undefined;

        if (isReduzidoPrimeiroPair(maybeReduzido, maybeClassif) && maybeDesc?.length > 1) {
          const key = `${maybeClassif}::${maybeDesc}`;
          if (!seen.has(key)) {
            seen.add(key);
            rows.push({
              codigo: maybeClassif,
              nome: maybeDesc,
              codigoReduzido: acceptCodigoReduzidoFromFile(maybeReduzido, maybeClassif, 'semicolon'),
              tipo: maybeTipo,
              nivel: codeLengthToLevel(maybeClassif.replace(/\./g, '').length),
            });
          }
          continue;
        }

        const cod = parts[0];
        const desc = parts[1];
        const fallbackTipoRaw = (parts[2] ?? '').trim().toUpperCase();
        const fallbackTipo: 'S' | 'A' | undefined =
          fallbackTipoRaw === 'S' || fallbackTipoRaw === 'A' ? fallbackTipoRaw : undefined;

        if (/^\d[\d.]{0,19}$/.test(cod) && desc.length > 1) {
          const key = `${cod}::${desc}`;
          if (!seen.has(key)) {
            seen.add(key);
            rows.push({
              codigo: cod,
              nome: desc,
              tipo: fallbackTipo,
              nivel: codeLengthToLevel(cod.replace(/\./g, '').length),
            });
          }
          continue;
        }
      }
    }

    const mRed = line.match(/^(\d{1,7})\s+(\d(?:[\d.]{0,23}))\s{1,}([A-Za-zÀ-ÿ\w(].{1,120}?)(?:\s+([SA]))?$/i);
    if (mRed) {
      const red = mRed[1];
      const cod = mRed[2].replace(/\.+$/, '');
      const desc = mRed[3].trim();
      const tRaw = (mRed[4] ?? '').toUpperCase();
      const tipo: 'S' | 'A' | undefined = tRaw === 'S' || tRaw === 'A' ? tRaw : undefined;

      if (desc.length > 1 && isReduzidoPrimeiroPair(red, cod)) {
        const key = `${cod}::${desc}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({
            codigo: cod,
            nome: desc,
            codigoReduzido: acceptCodigoReduzidoFromFile(red, cod, 'semicolon'),
            tipo,
            nivel: codeLengthToLevel(cod.replace(/\./g, '').length),
          });
        }
        continue;
      }
    }

    const m = line.match(/^(\d(?:[\d.]{0,23}))\s{1,}([A-Za-zÀ-ÿ\w(].{1,120}?)(?:\s+([SA]))?$/i);
    if (m) {
      const cod = m[1].replace(/\.+$/, '');
      const desc = m[2].trim();
      const tRaw = (m[3] ?? '').toUpperCase();
      const tipo: 'S' | 'A' | undefined = tRaw === 'S' || tRaw === 'A' ? tRaw : undefined;

      if (desc.length > 1) {
        const key = `${cod}::${desc}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({
            codigo: cod,
            nome: desc,
            tipo,
            nivel: codeLengthToLevel(cod.replace(/\./g, '').length),
          });
        }
      }
    }
  }

  return rows;
}

/** Parser unificado de TXT plano de contas (mesma ordem da interface Extrato Vision). */
export function parsePlanoContasText(text: string): VisionPlanoRow[] {
  let rows: VisionPlanoRow[] = [];
  if (isPlanoSemicolonFormat(text)) {
    rows = parsePlanoSemicolon(text);
  } else if (isPlanoFixedWidthFormat(text)) {
    rows = parsePlanoFixedWidth(text);
  } else if (/\|I010\|/i.test(text)) {
    rows = parsePlanoSpedI010(text);
  } else {
    rows = parsePlanoTextFree(text);
  }
  return inferAccountTypes(rows);
}
