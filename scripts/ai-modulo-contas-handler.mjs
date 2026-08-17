/**
 * IA sugere contas (código reduzido) para abas Contas dos módulos.
 */
import {
  callGemini,
  isGeminiConfigured,
  parseGeminiJson,
  sanitizeGeminiModel,
  EXTRACT_MAX_OUTPUT_TOKENS,
  EXTRACT_REQUEST_TIMEOUT_MS,
} from './gemini-client.mjs';
import { loadAiConfig } from './ai-config-store.mjs';

const SYSTEM = [
  'Você é contador brasileiro especialista em plano de contas Domínio e partidas dobradas.',
  'Sua tarefa: preencher as CONTAS (débito/crédito) de um módulo do Eye Vision / ContabilFacil.',
  '',
  'REGRA OBRIGATÓRIA — CÓDIGO REDUZIDO:',
  '- O campo "conta" DEVE ser SOMENTE o CÓDIGO REDUZIDO da conta (ex.: "8", "147", "4003").',
  '- É PROIBIDO usar classificação hierárquica com pontos (ex.: "1.1.20.400.003", "2.1.03.01").',
  '- Use SOMENTE codigoReduzido que exista no plano enviado.',
  '- NÃO invente contas.',
  '',
  'Para cada campo da lista "campos", escolha a conta do plano cujo NOME melhor casa com o label/keywords.',
  'Respeite a natureza contábil: ativo (classificação 1), passivo (2), receita (4), despesa (5+).',
  'Preencha preferencialmente campos vazios; se o usuário pedir, pode substituir.',
  '',
  'Responda SOMENTE JSON válido:',
  '{"resumo":"texto curto PT-BR","contas":[{"key":"accEmprestimoDebit","conta":"147","motivo":"..."}]}',
  'Máximo 40 contas. Se não houver evidência, contas=[].',
].join('\n');

function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function sanitizeCodigoReduzido(raw) {
  const v = String(raw ?? '').trim();
  if (!v || v.includes('.') || !/^\d{1,7}$/.test(v)) return '';
  return v;
}

function sameCodigoReduzido(a, b) {
  const sa = sanitizeCodigoReduzido(a);
  const sb = sanitizeCodigoReduzido(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  return String(parseInt(sa, 10)) === String(parseInt(sb, 10));
}

function isClassificacaoHierarquica(val) {
  const v = String(val ?? '').trim();
  if (!v) return false;
  if (v.includes('.')) return /^\d+(\.\d+)+$/.test(v);
  const digits = v.replace(/\D/g, '');
  return digits.length >= 8;
}

/** Resolve sugestão da IA para código reduzido válido no plano. */
function resolveCodigoReduzidoFromPlano(raw, plano) {
  const input = String(raw ?? '').trim();
  if (!input || !Array.isArray(plano) || !plano.length) return '';

  const asReduzido = sanitizeCodigoReduzido(input);
  if (asReduzido) {
    const hit = plano.find((p) => sameCodigoReduzido(p.codigoReduzido, asReduzido));
    if (hit) return sanitizeCodigoReduzido(hit.codigoReduzido) || asReduzido;
  }

  if (isClassificacaoHierarquica(input)) {
    const inputNorm = input.replace(/[^\d]/g, '');
    const byClassif = plano.find((p) => {
      const c = String(p.classificacao ?? p.code ?? '').trim();
      return c === input || c.replace(/[^\d]/g, '') === inputNorm;
    });
    if (byClassif) return sanitizeCodigoReduzido(byClassif.codigoReduzido) || '';
    return '';
  }

  const planoTemReduzido = plano.some((p) => Boolean(sanitizeCodigoReduzido(p.codigoReduzido)));
  if (asReduzido) {
    if (planoTemReduzido) return '';
    return asReduzido;
  }

  return '';
}

function sanitizeContas(rawList, plano, allowedKeys) {
  const list = Array.isArray(rawList) ? rawList : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const key = String(item?.key ?? '').trim();
    if (!key || (allowedKeys.size > 0 && !allowedKeys.has(key))) continue;
    if (seen.has(key)) continue;
    const conta = resolveCodigoReduzidoFromPlano(item?.conta ?? item?.code ?? '', plano);
    if (!conta || conta.includes('.')) continue;
    seen.add(key);
    out.push({
      key,
      conta,
      motivo: String(item?.motivo ?? '').trim().slice(0, 200),
    });
    if (out.length >= 40) break;
  }
  return out;
}

function buildUserPayload(body) {
  const plano = Array.isArray(body?.plano) ? body.plano : [];
  const campos = Array.isArray(body?.campos) ? body.campos : [];
  const contasAtuais = body?.contasAtuais && typeof body.contasAtuais === 'object' ? body.contasAtuais : {};
  const anexosTexto = Array.isArray(body?.anexosTexto) ? body.anexosTexto : [];
  const contexto = body?.contexto && typeof body.contexto === 'object' ? body.contexto : {};

  const planoParaIa = plano
    .map((p) => ({
      codigoReduzido: sanitizeCodigoReduzido(p?.codigoReduzido ?? ''),
      name: String(p?.name ?? '').trim(),
      classificacao: String(p?.classificacao ?? p?.code ?? '').trim(),
    }))
    .filter((p) => p.codigoReduzido && p.name)
    .slice(0, 500);

  const lines = [
    `Empresa: ${body?.company ?? ''}`,
    `Módulo: ${body?.modulo ?? ''}`,
    '',
    '--- Mensagem do usuário ---',
    String(body?.message ?? '').trim() || 'Preencha as contas vazias com as melhores do plano.',
    '',
    '--- Contexto do módulo ---',
    JSON.stringify(contexto),
    '',
    '--- Campos a preencher (key / label / keywords) ---',
    JSON.stringify(
      campos.map((c) => ({
        key: c.key,
        label: c.label,
        keywords: c.keywords,
        preferGroup: c.preferGroup,
      })),
    ),
    '',
    '--- Contas já preenchidas (código reduzido) ---',
    JSON.stringify(contasAtuais),
    '',
    '--- Plano de contas (codigoReduzido + nome; classificacao só referência) ---',
    JSON.stringify(planoParaIa),
  ];

  if (anexosTexto.length) {
    lines.push(
      '',
      `--- Documentos de inteligência ---\n${anexosTexto.join('\n---\n').slice(0, 30_000)}`,
    );
  }

  lines.push(
    '',
    'Devolva JSON com contas[].key e contas[].conta = codigoReduzido EXATO do plano (sem pontos).',
  );
  return lines.join('\n');
}

/**
 * @param {Record<string, unknown>} body
 */
export async function handleAiSuggestModuloContas(body) {
  if (!isGeminiConfigured()) {
    return {
      status: 503,
      body: {
        ok: false,
        resumo: '',
        contas: [],
        detail: 'IA não configurada (chave Gemini ausente).',
        reason: 'not_configured',
      },
    };
  }

  const plano = Array.isArray(body?.plano) ? body.plano : [];
  const campos = Array.isArray(body?.campos) ? body.campos : [];
  const allowedKeys = new Set(campos.map((c) => String(c?.key ?? '').trim()).filter(Boolean));

  const planoComReduzido = plano.filter((p) => sanitizeCodigoReduzido(p?.codigoReduzido));
  if (!planoComReduzido.length) {
    return {
      status: 400,
      body: {
        ok: false,
        resumo: '',
        contas: [],
        detail:
          'Plano sem código reduzido — importe o plano na aba Gerencial com a coluna Código Reduzido preenchida.',
        reason: 'empty_plano',
      },
    };
  }

  const cfg = loadAiConfig();
  const model = sanitizeGeminiModel(body?.model || cfg?.model);
  const userContent = buildUserPayload({ ...body, plano: planoComReduzido });

  try {
    const out = await callGemini({
      model,
      strongOnly: true,
      systemInstruction: SYSTEM,
      userContent,
      temperature: 0,
      jsonMode: true,
      maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
      timeoutMs: EXTRACT_REQUEST_TIMEOUT_MS,
    });
    const parsed = parseGeminiJson(out.text) ?? {};
    const contas = sanitizeContas(parsed.contas ?? parsed.accounts, planoComReduzido, allowedKeys);
    return {
      status: 200,
      body: {
        ok: contas.length > 0,
        resumo: String(parsed.resumo ?? '').trim() ||
          (contas.length ? `${contas.length} conta(s) sugerida(s) pela IA.` : 'Nenhuma conta sugerida.'),
        contas,
        model: out.model,
        detail: contas.length ? undefined : 'A IA não retornou códigos reduzidos válidos.',
      },
    };
  } catch (err) {
    return {
      status: 500,
      body: {
        ok: false,
        resumo: '',
        contas: [],
        detail: err instanceof Error ? err.message : String(err),
        reason: 'gemini_error',
      },
    };
  }
}
