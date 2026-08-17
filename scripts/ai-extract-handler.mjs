/**
 * Extração de extrato bancário via IA (visão + texto OCR).
 */
import { callGemini, callGeminiVision, isGeminiConfigured, parseGeminiJson, EXTRACT_MAX_OUTPUT_TOKENS, EXTRACT_REQUEST_TIMEOUT_MS } from './gemini-client.mjs';
import { getApiKeyForProvider, isProviderConfigured } from './ai-secrets-store.mjs';
import { findModelInCatalog, normalizeSelectedModel } from './ai-model-catalog.mjs';
import { loadAiConfig } from './ai-config-store.mjs';
import {
  buildExtratoAiExtractSystem,
  buildPlanoAiExtractSystem,
  detectBankHint,
  EXTRATO_AI_FILL_MISSING_SYSTEM,
  EXTRATO_AI_REPAIR_SYSTEM,
  EXTRATO_AI_REFINE_SYSTEM,
  PLANO_AI_REFINE_SYSTEM,
  EXTRATO_AI_SURGICAL_SYSTEM,
  EXTRATO_AI_SURGICAL_SCHEMA,
  LOAN_CONTRACT_AI_SYSTEM,
  LOAN_CONTRACT_AI_SCHEMA,
  EXTRATO_AI_OCR_OVERLAY_SYSTEM,
  EXTRATO_AI_OCR_OVERLAY_SCHEMA,
} from './ai-extract-prompts.mjs';
import {
  computeConciliacaoAi,
  escolherSaldoAnteriorAi,
  mergeAiExtratoRows,
  needsConciliacaoRepair,
  normalizeAiPlanoRows,
  normalizeAiRows,
  parseAiSaldoFields,
} from './ai-extract-utils.mjs';
import { convertExtrato, convertPlano, DEFAULT_GEMINI_MODEL, formatGeminiErrorMessage } from './erp-contabil/index.mjs';

async function callGeminiExtract({ model, systemInstruction, userParts, images, temperature = 0, responseSchema }) {
  const extractOpts = {
    model,
    systemInstruction,
    temperature,
    jsonMode: true,
    maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
    timeoutMs: EXTRACT_REQUEST_TIMEOUT_MS,
    responseSchema,
  };
  if (images?.length > 0) {
    return callGeminiVision({
      ...extractOpts,
      userText: userParts,
      images: images.slice(0, 15),
    });
  }
  return callGemini({
    ...extractOpts,
    userContent: userParts,
  });
}

const PLANO_AI_JSON_REPAIR_SYSTEM = [
  'Você recebe uma resposta quase-JSON de extração de plano de contas brasileiro.',
  'Devolva SOMENTE JSON válido no formato:',
  '{"rows":[{"codigoReduzido":"","codigoClassificacao":"1.1.1.01","descricao":"CAIXA","tipo":"A","nivel":"4","_linhaOcr":"..."}]}',
  'Corrija aspas, vírgulas finais e feche arrays/objetos truncados. Preserve TODAS as contas reconhecíveis.',
].join('\n');

async function repairAiPlanoExtractJson({ model, brokenText, images }) {
  const out = await callGeminiExtract({
    model,
    systemInstruction: PLANO_AI_JSON_REPAIR_SYSTEM,
    userParts: String(brokenText ?? '').slice(0, 120_000),
    images: images?.length ? images.slice(0, 2) : [],
    temperature: 0,
  });
  return parseGeminiJson(out.text);
}

function buildPlanoExtractUserParts({ fileName, ocrText }) {
  return [
    fileName ? `Arquivo: ${fileName}` : '',
    ocrText?.trim()
      ? `\n--- Texto OCR (referência — confira cada código) ---\n${ocrText.trim().slice(0, 28_000)}`
      : '',
    '\nExtraia TODAS as contas do plano (sintéticas e analíticas).',
  ]
    .filter(Boolean)
    .join('\n');
}

async function extractPlanoWithGemini({ model, ocrText, images, fileName }) {
  if (!isGeminiConfigured()) {
    return { ok: false, reason: 'gemini_not_configured', detail: 'Configure a chave Gemini na aba IA ou no .env' };
  }

  const systemInstruction = buildPlanoAiExtractSystem();
  const userParts = buildPlanoExtractUserParts({ fileName, ocrText });

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      rows: {
        type: 'ARRAY',
        description: 'Lista completa de contas do plano de contas.',
        items: {
          type: 'OBJECT',
          properties: {
            codigoReduzido: { type: 'STRING', description: 'Código reduzido da conta' },
            codigoClassificacao: { type: 'STRING', description: 'Classificação estruturada (ex: 1.1.1.01.001)' },
            descricao: { type: 'STRING', description: 'Nome/descrição da conta contábil' },
            tipo: { type: 'STRING', description: 'Tipo da conta contábil', enum: ['S', 'A'] },
            nivel: { type: 'STRING', description: 'Nível da conta na hierarquia (ex: 1, 2, 3, 4, 5)' },
            _linhaOcr: { type: 'STRING', description: 'Texto bruto original correspondente' },
          },
          required: ['codigoClassificacao', 'descricao'],
        },
      },
    },
    required: ['rows'],
  };

  const out = await callGeminiExtract({
    model,
    systemInstruction,
    userParts,
    images,
    temperature: 0,
    responseSchema,
  });

  let parsed = parseGeminiJson(out.text);
  if (!parsed) {
    try {
      parsed = await repairAiPlanoExtractJson({ model: out.model, brokenText: out.text, images });
    } catch {
      /* segue para erro amigável */
    }
  }
  if (!parsed) {
    return {
      ok: false,
      reason: 'parse_error',
      detail: 'A IA respondeu em formato inválido — tente novamente ou use modo Híbrido.',
    };
  }

  const rows = normalizeAiPlanoRows(parsed?.rows ?? parsed?.contas ?? (Array.isArray(parsed) ? parsed : []));
  if (rows.length === 0) {
    return { ok: false, reason: 'empty_extraction', detail: 'A IA não retornou contas válidas.' };
  }

  return { ok: true, rows, provider: 'gemini', model: out.model };
}

async function extractPlanoWithGeminiPerPage({ model, ocrText, images, fileName }) {
  const pages = (images ?? []).slice(0, 12);
  if (pages.length === 0) {
    return extractPlanoWithGemini({ model, ocrText, images, fileName });
  }

  let mergedRows = [];
  let lastModel = model;

  const concurrency = 4;
  const results = [];

  for (let i = 0; i < pages.length; i += concurrency) {
    const batch = pages.slice(i, i + concurrency);
    const batchPromises = batch.map((page, index) => {
      const pageIndex = i + index;
      const pageLabel = `${fileName || 'plano'} — pág. ${pageIndex + 1}/${pages.length}`;
      return extractPlanoWithGemini({
        model,
        ocrText: '',
        images: [page],
        fileName: pageLabel,
      });
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  for (const pageResult of results) {
    if (!pageResult.ok) continue;
    lastModel = pageResult.model ?? model;
    if (pageResult.rows?.length) {
      mergedRows = mergedRows.concat(pageResult.rows);
    }
  }

  if (mergedRows.length === 0) {
    return { ok: false, reason: 'empty_extraction', detail: 'IA por página não retornou contas.' };
  }

  return { ok: true, rows: mergedRows, provider: 'gemini', model: lastModel };
}

async function extractPlanoWithOpenAI({ model, ocrText, images, fileName }) {
  const { key } = getApiKeyForProvider('openai');
  if (!key) {
    return { ok: false, reason: 'openai_not_configured', detail: 'Configure OPENAI_API_KEY na aba IA' };
  }

  const systemInstruction = buildPlanoAiExtractSystem();
  const content = [
    {
      type: 'text',
      text: [systemInstruction, buildPlanoExtractUserParts({ fileName, ocrText })].join('\n\n'),
    },
  ];

  for (const img of (images ?? []).slice(0, 3)) {
    if (img?.base64 && img?.mimeType) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: 'high' },
      });
    }
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
      temperature: 0.05,
      max_tokens: 16_384,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, reason: 'openai_error', detail: err.slice(0, 300) };
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '{}';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'parse_error', detail: 'Resposta OpenAI não é JSON válido' };
  }

  const rows = normalizeAiPlanoRows(parsed?.rows ?? []);
  if (rows.length === 0) {
    return { ok: false, reason: 'empty_extraction', detail: 'A IA não retornou contas válidas.' };
  }

  return { ok: true, rows, provider: 'openai', model };
}

async function extractPlanoWithAnthropic({ model, ocrText, images, fileName }) {
  const { key } = getApiKeyForProvider('anthropic');
  if (!key) {
    return { ok: false, reason: 'anthropic_not_configured', detail: 'Configure ANTHROPIC_API_KEY na aba IA' };
  }

  const systemInstruction = buildPlanoAiExtractSystem();
  const content = [];
  for (const img of (images ?? []).slice(0, 3)) {
    if (img?.base64 && img?.mimeType?.startsWith('image/')) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
      });
    }
  }
  content.push({
    type: 'text',
    text: [systemInstruction, buildPlanoExtractUserParts({ fileName, ocrText })].join('\n\n'),
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16_384,
      temperature: 0.05,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, reason: 'anthropic_error', detail: err.slice(0, 300) };
  }

  const data = await res.json();
  const text = data?.content?.find((c) => c.type === 'text')?.text ?? '{}';
  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return { ok: false, reason: 'parse_error', detail: 'Resposta Anthropic não é JSON válido' };
  }

  const rows = normalizeAiPlanoRows(parsed?.rows ?? []);
  if (rows.length === 0) {
    return { ok: false, reason: 'empty_extraction', detail: 'A IA não retornou contas válidas.' };
  }

  return { ok: true, rows, provider: 'anthropic', model };
}

async function extractLoanContractWithGemini({ model, images, fileName }) {
  if (!isGeminiConfigured()) {
    return { ok: false, reason: 'gemini_not_configured', detail: 'Configure a chave Gemini na aba IA ou no .env' };
  }

  const systemInstruction = LOAN_CONTRACT_AI_SYSTEM;
  const userParts = [
    fileName ? `Arquivo: ${fileName}` : '',
    '\nExtraia os dados do contrato de empréstimo/financiamento.',
  ].filter(Boolean).join('\n');

  const out = await callGeminiExtract({
    model,
    systemInstruction,
    userParts,
    images,
    temperature: 0,
    maxOutputTokens: 4096, // Contratos são JSONs pequenos
    responseSchema: LOAN_CONTRACT_AI_SCHEMA,
  });

  const parsed = parseGeminiJson(out.text);
  if (!parsed) {
    return {
      ok: false,
      reason: 'parse_error',
      detail: 'A IA respondeu em formato inválido para o contrato.',
    };
  }

  return { ok: true, data: parsed, provider: 'gemini', model: out.model };
}

/** @param {object} body */
export async function handleAiExtractLoanContract(body) {
  const config = loadAiConfig();
  const providerId = String(body?.providerId ?? config.providerId ?? 'gemini').trim();
  const model = normalizeSelectedModel(providerId, body?.model ?? config.model);

  if (!isProviderConfigured(providerId)) {
    return {
      status: 503,
      body: { ok: false, reason: `${providerId}_not_configured`, detail: `Configure a chave API de ${providerId} na aba IA` },
    };
  }

  const payload = {
    model,
    images: Array.isArray(body?.images) ? body.images : [],
    fileName: String(body?.fileName ?? '').trim(),
  };

  try {
    let result;
    if (providerId === 'gemini') {
      result = await extractLoanContractWithGemini(payload);
    } else {
      return {
        status: 400,
        body: { ok: false, reason: 'provider_not_supported', detail: 'Extração de contrato suportada apenas via Gemini Vision no momento.' },
      };
    }

    if (!result.ok) {
      return { status: 503, body: result };
    }

    return {
      status: 200,
      body: {
        ok: true,
        data: result.data,
        model: result.model,
        provider: result.provider,
        detail: 'Dados do contrato extraídos com sucesso.',
      },
    };
  } catch (err) {
    return {
      status: 503,
      body: {
        ok: false,
        reason: 'extract_error',
        detail: err?.userHint ?? err?.message ?? String(err),
      },
    };
  }
}

/** @param {object} body */
export async function handleAiExtractPlano(body) {
  const config = loadAiConfig();
  const providerId = String(body?.providerId ?? config.providerId ?? 'gemini').trim();
  const model = normalizeSelectedModel(providerId, body?.model ?? config.model);
  const modelEntry = findModelInCatalog(model);

  if (!isProviderConfigured(providerId)) {
    return {
      status: 503,
      body: {
        ok: false,
        reason: `${providerId}_not_configured`,
        detail: `Configure a chave API de ${providerId} na aba IA do Contábil`,
      },
    };
  }

  if (modelEntry && !modelEntry.supportsExtract && (body?.images?.length ?? 0) > 0) {
    return {
      status: 400,
      body: {
        ok: false,
        reason: 'model_no_vision',
        detail: `${modelEntry.label} não suporta extração visual — escolha um modelo com visão`,
      },
    };
  }

  const payload = {
    model,
    ocrText: String(body?.ocrText ?? ''),
    images: Array.isArray(body?.images) ? body.images : [],
    fileName: String(body?.fileName ?? '').trim(),
    perPage: body?.perPage === true,
    fileBase64: String(body?.fileBase64 ?? '').trim() || undefined,
    mimeType: String(body?.mimeType ?? '').trim() || undefined,
  };

  try {
    let result;
    switch (providerId) {
      case 'openai':
        result = await extractPlanoWithOpenAI(payload);
        break;
      case 'anthropic':
        result = await extractPlanoWithAnthropic(payload);
        break;
      case 'gemini':
      default:
        result = await extractPlanoWithErpContabil(payload);
        break;
    }

    if (!result.ok) {
      return { status: 503, body: result };
    }

    if (!result.rows?.length) {
      const hasInput =
        payload.images.length > 0 || String(payload.ocrText ?? '').trim().length > 20;
      return {
        status: 422,
        body: {
          ok: false,
          reason: 'empty_extraction',
          detail: hasInput
            ? `A IA processou o documento mas não retornou contas válidas (modelo ${result.model ?? model}). Tente modo Híbrido.`
            : 'Sem imagem nem texto OCR para enviar à IA — aguarde a página carregar e tente de novo.',
          provider: result.provider,
          model: result.model,
        },
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        rows: result.rows,
        model: result.model,
        provider: result.provider,
        rowCount: result.rows.length,
        detail: `${result.rows.length} conta(s) extraída(s).`,
      },
    };
  } catch (err) {
    return {
      status: 503,
      body: {
        ok: false,
        reason: 'extract_error',
        detail: err?.userHint ?? err?.message ?? String(err),
      },
    };
  }
}

const EXTRATO_AI_JSON_REPAIR_SYSTEM = [
  'Você recebe uma resposta quase-JSON de extração de extrato bancário brasileiro.',
  'Devolva SOMENTE JSON válido no formato:',
  '{"rows":[{"data":"DD/MM/AAAA","descricao":"...","valorCredito":"","valorDebito":"","valorMisto":"","_linhaOcr":"..."}],"saldoAnterior":0,"saldoFinal":0}',
  'Corrija aspas, vírgulas finais e feche arrays/objetos truncados. Preserve TODOS os lançamentos reconhecíveis.',
].join('\n');

async function repairAiExtractJson({ model, brokenText, images }) {
  const out = await callGeminiExtract({
    model,
    systemInstruction: EXTRATO_AI_JSON_REPAIR_SYSTEM,
    userParts: String(brokenText ?? '').slice(0, 120_000),
    images: images?.length ? images.slice(0, 2) : [],
    temperature: 0,
  });
  return parseGeminiJson(out.text);
}

function buildExtractUserParts({ statementYear, fileName, ocrText, bankHint }) {
  return [
    `Ano de referência: ${statementYear || new Date().getFullYear()}`,
    fileName ? `Arquivo: ${fileName}` : '',
    bankHint ? `Banco detectado: ${bankHint.toUpperCase()}` : '',
    ocrText?.trim() ? `\n--- Texto OCR Tesseract (referência — confira cada valor) ---\n${ocrText.trim().slice(0, 28_000)}` : '',
    '\nExtraia TODOS os lançamentos operacionais. Valide o saldo antes de responder.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function extractMissingRowsGemini({
  model,
  existingRows,
  saldoAnterior,
  saldoFinal,
  delta,
  ocrText,
  images,
  fileName,
  bankHint,
  statementYear,
}) {
  const userParts = [
    `Arquivo: ${fileName || 'extrato'}`,
    bankHint ? `Banco: ${bankHint}` : '',
    `Saldo anterior: ${saldoAnterior ?? '?'}`,
    `Saldo final PDF: ${saldoFinal ?? '?'}`,
    `Divergência atual: R$ ${delta?.toFixed(2) ?? '?'}`,
    `Lançamentos já extraídos (${existingRows.length}):`,
    JSON.stringify(existingRows.slice(0, 80), null, 0).slice(0, 10000),
    ocrText?.trim() ? `\nOCR Tesseract:\n${ocrText.trim().slice(0, 12000)}` : '',
    '\nExtraia SOMENTE os lançamentos faltantes para fechar o saldo.',
  ].join('\n');

  const out = await callGeminiExtract({
    model,
    systemInstruction: EXTRATO_AI_FILL_MISSING_SYSTEM,
    userParts,
    images,
    temperature: 0.05,
  });

  const parsed = parseGeminiJson(out.text);
  return normalizeAiRows(parsed?.rows ?? [], {
    statementYear,
    bankHint,
  });
}

async function repairExtractionGemini({
  model,
  rows,
  saldoAnterior,
  saldoFinal,
  conciliacao,
  ocrText,
  images,
  fileName,
  bankHint,
  statementYear,
}) {
  const userParts = [
    `Arquivo: ${fileName || 'extrato'}`,
    bankHint ? `Banco: ${bankHint}` : '',
    `Saldo anterior esperado: ${saldoAnterior ?? '?'}`,
    `Saldo final esperado: ${saldoFinal ?? '?'}`,
    `Saldo conciliado atual: ${conciliacao?.saldoConciliado ?? '?'}`,
    `Divergência: R$ ${conciliacao?.delta?.toFixed(2) ?? '?'}`,
    `Créditos extraídos: R$ ${conciliacao?.creditos?.toFixed(2) ?? '?'}`,
    `Débitos extraídos: R$ ${conciliacao?.debitos?.toFixed(2) ?? '?'}`,
    `\nLançamentos atuais (${rows.length}):`,
    JSON.stringify(rows.slice(0, 100), null, 0).slice(0, 12000),
    ocrText?.trim() ? `\nOCR Tesseract:\n${ocrText.trim().slice(0, 12000)}` : '',
    '\nDevolva a lista COMPLETA corrigida com saldo fechando (±R$ 0,10).',
  ].join('\n');

  const out = await callGeminiExtract({
    model,
    systemInstruction: EXTRATO_AI_REPAIR_SYSTEM,
    userParts,
    images,
    temperature: 0.05,
  });

  const parsed = parseGeminiJson(out.text);
  if (!parsed) return null;

  const repaired = normalizeAiRows(parsed?.rows ?? [], { statementYear, bankHint });
  if (repaired.length === 0) return null;

  const saldos = parseAiSaldoFields(parsed);
  return {
    rows: repaired,
    saldoAnterior: saldos.saldoAnterior ?? saldoAnterior,
    saldoFinal: saldos.saldoFinal ?? saldoFinal,
  };
}

async function finalizeAiExtratoResult({
  model,
  rows,
  saldoAnterior,
  saldoFinal,
  ocrText,
  images,
  fileName,
  bankHint,
  statementYear,
  provider,
}) {
  let outRows = rows;
  let sa = escolherSaldoAnteriorAi(rows, saldoAnterior, saldoFinal, ocrText);
  let sf = saldoFinal;
  let conciliacao = computeConciliacaoAi(outRows, sa, sf);

  const canRunSlowRepair = outRows.length > 0 && outRows.length <= 180;

  if (canRunSlowRepair && needsConciliacaoRepair(conciliacao) && sf != null && isGeminiConfigured()) {
    try {
      const extra = await extractMissingRowsGemini({
        model,
        existingRows: outRows,
        saldoAnterior: sa,
        saldoFinal: sf,
        delta: conciliacao.delta,
        ocrText,
        images,
        fileName,
        bankHint,
        statementYear,
      });
      if (extra.length > 0) {
        outRows = mergeAiExtratoRows(outRows, extra);
        conciliacao = computeConciliacaoAi(outRows, sa, sf);
      }
    } catch {
      /* mantém parcial */
    }
  }

  if (canRunSlowRepair && needsConciliacaoRepair(conciliacao) && sf != null && isGeminiConfigured()) {
    try {
      const repaired = await repairExtractionGemini({
        model,
        rows: outRows,
        saldoAnterior: sa,
        saldoFinal: sf,
        conciliacao,
        ocrText,
        images,
        fileName,
        bankHint,
        statementYear,
      });
      if (repaired?.rows?.length) {
        outRows = repaired.rows;
        if (repaired.saldoAnterior != null) sa = repaired.saldoAnterior;
        if (repaired.saldoFinal != null) sf = repaired.saldoFinal;
        conciliacao = computeConciliacaoAi(outRows, sa, sf);
      }
    } catch {
      /* mantém parcial */
    }
  }

  return {
    ok: true,
    rows: outRows,
    saldoAnterior: sa,
    saldoFinal: sf,
    conciliacao,
    provider,
    model,
  };
}

function mapErpTransactionsToRawRows(transactions, statementYear) {
  let lastDateBr = '';
  return (transactions ?? []).map((t) => {
    let dateStr = '';
    if (t?.date) {
      const parts = String(t.date).split('-');
      if (parts.length === 3 && parts[0].length === 4) {
        dateStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
      } else {
        dateStr = String(t.date);
      }
    } else if (lastDateBr) {
      dateStr = lastDateBr;
    }

    if (dateStr) lastDateBr = dateStr;

    let valorCredito = '';
    let valorDebito = '';
    if (t?.amount != null && t.amount !== 0) {
      const absVal = Math.abs(Number(t.amount));
      const formattedVal = absVal.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const isCredit = t.type === 'CREDIT' || (t.type !== 'DEBIT' && Number(t.amount) > 0);
      if (isCredit) valorCredito = formattedVal;
      else valorDebito = formattedVal;
    }

    return {
      data: dateStr,
      descricao: String(t?.description ?? '').trim(),
      valorCredito,
      valorDebito,
      valorMisto: '',
      _linhaOcr: `${t?.date || ''} ${t?.description || ''} ${t?.amount != null ? t.amount : ''}`.trim(),
      _statementYear: statementYear,
    };
  });
}

function mapErpPlanoToRows(planoContas) {
  return (planoContas ?? []).map((item) => {
    const classification = String(item?.classification ?? '').trim();
    const nivel = classification ? String(classification.split('.').length) : '';
    const typeUpper = String(item?.type ?? '').toUpperCase();
    let tipo = 'A';
    if (item?.isSynthetic === true) tipo = 'S';
    else if (typeUpper.includes('SINT') || nivel && Number(nivel) < 5) tipo = 'S';

    return {
      codigoReduzido: String(item?.code ?? '').trim(),
      codigoClassificacao: classification,
      descricao: String(item?.name ?? '').trim(),
      tipo,
      nivel,
      _linhaOcr: `${classification} ${item?.name ?? ''}`.trim(),
    };
  });
}

/** Motor erp.contabil — extração exaustiva (PDF chunked, imagem, planilha). */
async function extractWithErpContabil({
  model,
  ocrText,
  images,
  statementYear,
  fileName,
  bankHint: bankHintIn,
  fileBase64,
  mimeType,
}) {
  if (!isGeminiConfigured()) {
    return { ok: false, reason: 'gemini_not_configured', detail: 'Configure a chave Gemini na aba IA ou no .env' };
  }

  const bankHint = bankHintIn ?? detectBankHint(fileName, ocrText);
  const isPdf =
    Boolean(fileBase64) &&
    (String(mimeType || '').includes('pdf') || /\.pdf$/i.test(String(fileName || '')));

  try {
    const convertParams = {
      fileName,
      selectedModel: model || DEFAULT_GEMINI_MODEL,
    };

    if (isPdf) {
      convertParams.fileBase64 = fileBase64;
      convertParams.mimeType = mimeType || 'application/pdf';
    } else if (Array.isArray(images) && images.length > 0) {
      convertParams.images = images;
    } else {
      return {
        ok: false,
        reason: 'no_input',
        detail: 'Envie PDF, imagem ou planilha para extração.',
      };
    }

    const erpResult = await convertExtrato(convertParams);
    const rawRows = mapErpTransactionsToRawRows(erpResult?.transactions, statementYear);
    const rows = normalizeAiRows(rawRows, { statementYear, bankHint });
    if (!rows.length) {
      return { ok: false, reason: 'empty_extraction', detail: 'O motor erp.contabil não retornou lançamentos válidos.' };
    }

    return finalizeAiExtratoResult({
      model: model || DEFAULT_GEMINI_MODEL,
      rows,
      saldoAnterior: null,
      saldoFinal: null,
      ocrText,
      images,
      fileName,
      bankHint,
      statementYear,
      provider: 'erp-contabil',
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'extract_error',
      detail: formatGeminiErrorMessage(err),
    };
  }
}

/** Motor erp.contabil — plano de contas. */
async function extractPlanoWithErpContabil({ model, ocrText, images, fileName, fileBase64, mimeType }) {
  if (!isGeminiConfigured()) {
    return { ok: false, reason: 'gemini_not_configured', detail: 'Configure a chave Gemini na aba IA ou no .env' };
  }

  const isPdf =
    Boolean(fileBase64) &&
    (String(mimeType || '').includes('pdf') || /\.pdf$/i.test(String(fileName || '')));

  try {
    const convertParams = {
      fileName,
      selectedModel: model || DEFAULT_GEMINI_MODEL,
      ocrText,
      textContent: ocrText,
    };

    if (isPdf) {
      convertParams.fileBase64 = fileBase64;
      convertParams.mimeType = mimeType || 'application/pdf';
    } else if (Array.isArray(images) && images.length > 0) {
      convertParams.images = images;
    } else if (String(ocrText ?? '').trim().length > 20) {
      convertParams.textContent = ocrText;
    } else {
      return { ok: false, reason: 'no_input', detail: 'Envie documento ou texto OCR do plano de contas.' };
    }

    const erpResult = await convertPlano(convertParams);
    const rows = normalizeAiPlanoRows(mapErpPlanoToRows(erpResult?.planoContas ?? []));
    if (!rows.length) {
      return { ok: false, reason: 'empty_extraction', detail: 'O motor erp.contabil não retornou contas válidas.' };
    }

    return { ok: true, rows, provider: 'erp-contabil', model: model || DEFAULT_GEMINI_MODEL };
  } catch (err) {
    return {
      ok: false,
      reason: 'extract_error',
      detail: formatGeminiErrorMessage(err),
    };
  }
}

async function extractWithGeminiPerPage({ model, ocrText, images, statementYear, fileName, bankHint: bankHintIn }) {
  if (!isGeminiConfigured()) {
    return { ok: false, reason: 'gemini_not_configured', detail: 'Configure a chave Gemini na aba IA ou no .env' };
  }
  const bankHint = bankHintIn ?? detectBankHint(fileName, ocrText);
  const pages = (images ?? []).slice(0, 12);
  if (pages.length === 0) {
    return extractWithGemini({ model, ocrText, images, statementYear, fileName, bankHint });
  }

  let mergedRows = [];
  let saldoAnterior;
  let saldoFinal;
  let lastModel = model;
  const ocrChunks = String(ocrText ?? '')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  const concurrency = 4;
  const results = [];

  for (let i = 0; i < pages.length; i += concurrency) {
    const batch = pages.slice(i, i + concurrency);
    const batchPromises = batch.map((page, index) => {
      const pageIndex = i + index;
      const pageLabel = `${fileName || 'extrato'} — pág. ${pageIndex + 1}/${pages.length}`;
      const pageOcr = ocrChunks[pageIndex] ?? (pages.length === 1 ? ocrText : '');
      return extractWithGemini({
        model,
        ocrText: pageOcr,
        images: [page],
        statementYear,
        fileName: pageLabel,
        bankHint,
      });
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  for (const pageResult of results) {
    if (!pageResult.ok) continue;
    lastModel = pageResult.model ?? model;
    if (pageResult.rows?.length) {
      mergedRows = mergeAiExtratoRows(mergedRows, pageResult.rows);
    }
    if (pageResult.saldoAnterior != null && saldoAnterior == null) {
      saldoAnterior = pageResult.saldoAnterior;
    }
    if (pageResult.saldoFinal != null) {
      saldoFinal = pageResult.saldoFinal;
    }
  }

  if (mergedRows.length === 0) {
    return { ok: false, reason: 'empty_extraction', detail: 'IA por página não retornou lançamentos.' };
  }

  return finalizeAiExtratoResult({
    model: lastModel,
    rows: mergedRows,
    saldoAnterior,
    saldoFinal,
    ocrText,
    images: pages,
    fileName,
    bankHint,
    statementYear,
    provider: 'gemini',
  });
}

async function extractWithGemini({ model, ocrText, images, statementYear, fileName, bankHint: bankHintIn }) {
  if (!isGeminiConfigured()) {
    return { ok: false, reason: 'gemini_not_configured', detail: 'Configure a chave Gemini na aba IA ou no .env' };
  }

  const bankHint = bankHintIn ?? detectBankHint(fileName, ocrText);

  const systemInstruction = `Você é um auditor financeiro certificado e especialista em OCR de extratos bancários físicos escaneados. Sua missão é de PRECISÃO ABSOLUTA. Você vai ler o documento INTEIRO, linha por linha, página por página, sem pular absolutamente nada.

REGRAS ABSOLUTAS E INVIOLÁVEIS:
1. LEIA CADA LINHA: Percorra a imagem de cima para baixo em cada página. Cada linha com data e valor é um lançamento. Nenhuma pode ser ignorada.
2. NUNCA AGRUPE: Cada linha física do extrato = exatamente 1 objeto no array. Proibido mesclar ou agrupar.
3. NUNCA RESUMA: Proibido usar "..." ou "seguem mais X lançamentos". Retorne TODOS.
4. DATAS OBRIGATÓRIAS: Toda linha com data visível deve ter sua data extraída. Se a data estiver repetida em múltiplas linhas (como no extrato Sicredi), repita-a em cada objeto.
5. VALORES OBRIGATÓRIOS: Leia o valor exato de cada coluna. Débito = negativo. Crédito = positivo.
6. SALDOS: Extraia obrigatoriamente o saldo anterior (saldo_anterior) e saldo final (saldo_final) do documento.`;

  const userParts = `Analise este extrato bancário escaneado e extraia TODAS as transações, uma por uma, linha por linha.

INSTRUÇÕES DETALHADAS DE EXTRAÇÃO (SIGA EXATAMENTE):

1. VARREDURA LINHA A LINHA: Olhe para a imagem e percorra linha por linha, de cima para baixo, em CADA PÁGINA. Cada linha visível com uma data e um valor numérico é um lançamento obrigatório no array.

2. DATAS: Formate como YYYY-MM-DD. Se o extrato usar DD/MM, assuma o ano ${statementYear}. Se a linha de lançamento não repetir a data (mesma data de várias linhas), use a última data visível acima.

3. VALORES: 
   - Débito/Saída/D = amount negativo (ex: -150.00)
   - Crédito/Entrada/C = amount positivo (ex: +3200.00)
   - Leia o valor exatamente como está: não arredonde, não estime.

4. DESCRIÇÕES: Use a descrição completa da linha. Inclua anotações escritas à mão com caneta/lápis que apareçam ao lado ou acima do lançamento (ex: "Aluguel", "Zelador", "Psicologo"). Se houver anotação, incorpore na description (ex: "PIX - João Silva (Aluguel)").

5. SALDOS DO EXTRATO: Extraia também:
   - "saldo_anterior": valor numérico do saldo antes do período
   - "saldo_final": valor numérico do saldo ao final do período

6. COMPLETUDE TOTAL: Se o documento tiver 47 lançamentos, você DEVE retornar 47 objetos no array. Nenhum a mais, nenhum a menos. Conte visualmente as linhas antes de finalizar.

7. NUNCA DEIXE DE EXTRAIR: Se algum campo (valor, categoria) estiver ilegível, omita apenas esse campo. NUNCA omita a transação inteira.`;

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      transactions: {
        type: 'ARRAY',
        description: 'Lista completa e exaustiva de TODAS as transações financeiras extraídas e estruturadas.',
        items: {
          type: 'OBJECT',
          properties: {
            date: { type: 'STRING', description: 'Data da transação no formato YYYY-MM-DD' },
            description: { type: 'STRING', description: 'Descrição completa do lançamento, incluindo anotações à mão' },
            amount: { type: 'NUMBER', description: 'Valor numérico (positivo para créditos/entradas, negativo para débitos/saídas)' },
            type: { type: 'STRING', description: 'Tipo de transação bancária', enum: ['DEBIT', 'CREDIT'] },
            category: { type: 'STRING', description: 'Categoria financeira em português' }
          },
          required: ['date', 'description']
        }
      },
      saldo_anterior: { type: 'NUMBER', description: 'Saldo anterior do extrato (antes do período)' },
      saldo_final: { type: 'NUMBER', description: 'Saldo final do extrato (ao final do período)' },
      currency: { type: 'STRING', description: 'Moeda detectada (ex: BRL, USD, EUR)' },
      summary: { type: 'STRING', description: 'Um resumo descritivo curto do documento processado' }
    },
    required: ['transactions']
  };


  const out = await callGeminiExtract({
    model,
    systemInstruction,
    userParts,
    images,
    temperature: 0,
    responseSchema,
  });

  let parsed = parseGeminiJson(out.text);
  if (!parsed) {
    try {
      parsed = await repairAiExtractJson({ model: out.model, brokenText: out.text, images });
    } catch {
      /* segue para erro amigável */
    }
  }
  if (!parsed) {
    return {
      ok: false,
      reason: 'parse_error',
      detail: 'A IA respondeu em formato inválido mesmo após reparo automático — tente novamente, aumente a resolução do PDF ou use modo Híbrido.',
    };
  }

  let rawRows = parsed?.rows ?? parsed?.lancamentos ?? (Array.isArray(parsed) ? parsed : []);
  if (Array.isArray(parsed?.transactions)) {
    rawRows = parsed.transactions.map(t => {
      let dateStr = '';
      if (t.date) {
        // Converte YYYY-MM-DD → DD/MM/YYYY para normalizeAiRows funcionar corretamente
        const parts = String(t.date).split('-');
        if (parts.length === 3 && parts[0].length === 4) {
          dateStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
        } else {
          dateStr = t.date;
        }
      }

      let valorCredito = '';
      let valorDebito = '';

      if (t.amount != null && t.amount !== 0) {
        const absVal = Math.abs(t.amount);
        const formattedVal = absVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        // Usa type primeiro; cai para sinal do amount como fallback
        const isCredit = t.type === 'CREDIT' || (t.type !== 'DEBIT' && t.amount > 0);
        if (isCredit) {
          valorCredito = formattedVal;
        } else {
          valorDebito = formattedVal;
        }
      }

      return {
        data: dateStr,
        descricao: String(t.description ?? '').trim(),
        valorCredito,
        valorDebito,
        valorMisto: '',
        _linhaOcr: `${t.date || ''} ${t.description || ''} ${t.amount != null ? t.amount : ''}`.trim()
      };
    });
  }

  const rows = normalizeAiRows(rawRows, {
    statementYear,
    bankHint,
  });

  // Usa os campos saldo_anterior/saldo_final do novo schema, com fallback para parseAiSaldoFields
  const saldoAnteriorNew = typeof parsed?.saldo_anterior === 'number' ? parsed.saldo_anterior : null;
  const saldoFinalNew = typeof parsed?.saldo_final === 'number' ? parsed.saldo_final : null;
  const { saldoAnterior: saldoAnteriorLegacy, saldoFinal: saldoFinalLegacy } = parseAiSaldoFields(parsed);
  const saldoAnterior = saldoAnteriorNew ?? saldoAnteriorLegacy;
  const saldoFinal = saldoFinalNew ?? saldoFinalLegacy;


  const finalized = await finalizeAiExtratoResult({
    model: out.model,
    rows,
    saldoAnterior,
    saldoFinal,
    ocrText,
    images,
    fileName,
    bankHint,
    statementYear,
    provider: 'gemini',
  });

  return { ...finalized, model: out.model };
}

async function extractWithOpenAI({ model, ocrText, images, statementYear, fileName }) {
  const { key } = getApiKeyForProvider('openai');
  if (!key) {
    return { ok: false, reason: 'openai_not_configured', detail: 'Configure OPENAI_API_KEY na aba IA' };
  }

  const bankHint = detectBankHint(fileName, ocrText);
  const systemInstruction = buildExtratoAiExtractSystem(bankHint);

  const content = [
    {
      type: 'text',
      text: [
        systemInstruction,
        buildExtractUserParts({ statementYear, fileName, ocrText, bankHint }),
      ].join('\n\n'),
    },
  ];

  for (const img of (images ?? []).slice(0, 3)) {
    if (img?.base64 && img?.mimeType) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: 'high' },
      });
    }
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
      temperature: 0.05,
      max_tokens: 16_384,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, reason: 'openai_error', detail: err.slice(0, 300) };
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '{}';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'parse_error', detail: 'Resposta OpenAI não é JSON válido' };
  }

  const rows = normalizeAiRows(parsed?.rows ?? [], { statementYear, bankHint });
  const { saldoAnterior, saldoFinal } = parseAiSaldoFields(parsed);

  return finalizeAiExtratoResult({
    model,
    rows,
    saldoAnterior,
    saldoFinal,
    ocrText,
    images,
    fileName,
    bankHint,
    statementYear,
    provider: 'openai',
  });
}

async function extractWithAnthropic({ model, ocrText, images, statementYear, fileName }) {
  const { key } = getApiKeyForProvider('anthropic');
  if (!key) {
    return { ok: false, reason: 'anthropic_not_configured', detail: 'Configure ANTHROPIC_API_KEY na aba IA' };
  }

  const bankHint = detectBankHint(fileName, ocrText);
  const systemInstruction = buildExtratoAiExtractSystem(bankHint);

  const content = [];
  for (const img of (images ?? []).slice(0, 3)) {
    if (img?.base64 && img?.mimeType?.startsWith('image/')) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
      });
    }
  }
  content.push({
    type: 'text',
    text: [systemInstruction, buildExtractUserParts({ statementYear, fileName, ocrText, bankHint })].join('\n\n'),
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16_384,
      temperature: 0.05,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, reason: 'anthropic_error', detail: err.slice(0, 300) };
  }

  const data = await res.json();
  const text = data?.content?.find((c) => c.type === 'text')?.text ?? '{}';
  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return { ok: false, reason: 'parse_error', detail: 'Resposta Anthropic não é JSON válido' };
  }

  const rows = normalizeAiRows(parsed?.rows ?? [], { statementYear, bankHint });
  const { saldoAnterior, saldoFinal } = parseAiSaldoFields(parsed);

  return finalizeAiExtratoResult({
    model,
    rows,
    saldoAnterior,
    saldoFinal,
    ocrText,
    images,
    fileName,
    bankHint,
    statementYear,
    provider: 'anthropic',
  });
}

async function extractExtratoSurgical({ model, images, fileName }) {
  if (!isGeminiConfigured()) {
    return { ok: false, reason: 'gemini_not_configured', detail: 'Configure a chave Gemini na aba IA ou no .env' };
  }

  const systemInstruction = EXTRATO_AI_SURGICAL_SYSTEM;
  const userParts = `Por favor, extraia todas as transações das páginas do extrato bancário fornecidas (arquivo: ${fileName}) seguindo o formato do esquema JSON.`;
  const responseSchema = EXTRATO_AI_SURGICAL_SCHEMA;

  const out = await callGeminiExtract({
    model,
    systemInstruction,
    userParts,
    images,
    temperature: 0,
    responseSchema,
  });

  const parsed = parseGeminiJson(out.text);
  if (!parsed || !Array.isArray(parsed.transactions)) {
    return {
      ok: false,
      reason: 'parse_error',
      detail: 'A IA respondeu em formato inválido — tente novamente.',
    };
  }

  const rows = parsed.transactions.map(t => ({
    data: t.dateText,
    descricao: t.historyText,
    valorMisto: t.valueText,
    isNegative: t.isNegative,
    parsedValue: t.parsedValue,
    _linhaOcr: `${t.dateText} ${t.historyText} ${t.valueText}`.trim(),
  }));

  const saldoAnterior = typeof parsed.saldoAnterior === 'number' ? parsed.saldoAnterior : null;
  const saldoFinal = typeof parsed.saldoFinal === 'number' ? parsed.saldoFinal : null;

  return {
    ok: true,
    rows,
    saldoAnterior,
    saldoFinal,
    provider: 'gemini',
    model: out.model
  };
}

/** @param {object} body */
export async function handleAiExtractExtrato(body) {
  const config = loadAiConfig();
  const providerId = String(body?.providerId ?? config.providerId ?? 'gemini').trim();
  const model = normalizeSelectedModel(providerId, body?.model ?? config.model);
  const mode = String(body?.mode ?? '').trim();

  if (mode === 'surgical' && providerId === 'gemini') {
    const payload = {
      model,
      images: Array.isArray(body?.images) ? body.images : [],
      fileName: String(body?.fileName ?? '').trim(),
    };
    try {
      const result = await extractExtratoSurgical(payload);
      if (!result.ok) return { status: 503, body: result };
      return {
        status: 200,
        body: {
          ok: true,
          rows: result.rows,
          saldoAnterior: result.saldoAnterior,
          saldoFinal: result.saldoFinal,
          model: result.model,
          provider: result.provider,
          rowCount: result.rows.length,
          detail: `${result.rows.length} lançamento(s) extraído(s) via IA Cirúrgica.`,
        },
      };
    } catch (err) {
      return { status: 503, body: { ok: false, detail: err.message } };
    }
  }

  const modelEntry = findModelInCatalog(model);

  if (!isProviderConfigured(providerId)) {
    return {
      status: 503,
      body: {
        ok: false,
        reason: `${providerId}_not_configured`,
        detail: `Configure a chave API de ${providerId} na aba IA do Contábil`,
      },
    };
  }

  if (modelEntry && !modelEntry.supportsExtract && (body?.images?.length ?? 0) > 0) {
    return {
      status: 400,
      body: {
        ok: false,
        reason: 'model_no_vision',
        detail: `${modelEntry.label} não suporta extração visual — escolha um modelo com visão`,
      },
    };
  }

  const payload = {
    model,
    ocrText: String(body?.ocrText ?? ''),
    images: Array.isArray(body?.images) ? body.images : [],
    statementYear: String(body?.statementYear ?? new Date().getFullYear()),
    fileName: String(body?.fileName ?? '').trim(),
    perPage: body?.perPage === true,
    bankHint: body?.bankHint ? String(body.bankHint).trim() : undefined,
    fileBase64: String(body?.fileBase64 ?? '').trim() || undefined,
    mimeType: String(body?.mimeType ?? '').trim() || undefined,
  };

  const resolvedBankHint = payload.bankHint || detectBankHint(payload.fileName, payload.ocrText);

  try {
    let result;
    switch (providerId) {
      case 'openai':
        result = await extractWithOpenAI(payload);
        break;
      case 'anthropic':
        result = await extractWithAnthropic(payload);
        break;
      case 'gemini':
      default:
        result = await extractWithErpContabil(payload);
        break;
    }

    if (!result.ok) {
      return { status: 503, body: result };
    }

    if (!result.rows?.length) {
      const hasInput =
        payload.images.length > 0 || String(payload.ocrText ?? '').trim().length > 20;
      return {
        status: 422,
        body: {
          ok: false,
          reason: 'empty_extraction',
          detail: hasInput
            ? `A IA processou o documento mas não retornou lançamentos válidos (modelo ${result.model ?? model}). Tente modo Híbrido ou Tesseract.`
            : 'Sem imagem nem texto OCR para enviar à IA — aguarde a página carregar e tente de novo.',
          provider: result.provider,
          model: result.model,
        },
      };
    }

    const concMsg =
      result.conciliacao?.ok === false && result.conciliacao?.delta != null
        ? ` Atenção: saldo diverge R$ ${result.conciliacao.delta.toFixed(2)} do PDF.`
        : result.conciliacao?.ok
          ? ' Saldo conciliado com o PDF.'
          : '';

    return {
      status: 200,
      body: {
        ok: true,
        rows: result.rows,
        saldoAnterior: result.saldoAnterior,
        saldoFinal: result.saldoFinal ?? null,
        conciliacao: result.conciliacao ?? null,
        model: result.model,
        provider: result.provider,
        rowCount: result.rows.length,
        detail: `${result.rows.length} lançamento(s) extraído(s).${concMsg}`,
      },
    };
  } catch (err) {
    return {
      status: 503,
      body: {
        ok: false,
        reason: 'extract_error',
        detail: err?.userHint ?? err?.message ?? String(err),
      },
    };
  }
}

function buildRefineUserPayload({ bankHint, ocrText, lines }) {
  return JSON.stringify({
    banco: bankHint,
    ocrText: String(ocrText ?? '').slice(0, 14000),
    lines: (lines ?? []).slice(0, 120),
  });
}

async function refineOcrRowsWithGemini({ model, ocrText, lines, bankHint, refineSystem }) {
  const out = await callGemini({
    model,
    jsonMode: true,
    temperature: 0.05,
    systemInstruction: refineSystem,
    userContent: buildRefineUserPayload({ bankHint, ocrText, lines }),
  });
  const parsed = parseGeminiJson(out.text);
  return { parsed, model: out.model, provider: 'gemini' };
}

async function refineOcrRowsWithOpenAI({ model, ocrText, lines, bankHint, refineSystem }) {
  const { key } = getApiKeyForProvider('openai');
  if (!key) {
    return { ok: false, reason: 'openai_not_configured' };
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: refineSystem },
        { role: 'user', content: buildRefineUserPayload({ bankHint, ocrText, lines }) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.05,
      max_tokens: 16_384,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, reason: 'openai_error', detail: err.slice(0, 300) };
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '{}';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'parse_error', detail: 'Resposta OpenAI não é JSON válido' };
  }
  return { parsed, model, provider: 'openai' };
}

async function refineOcrRowsWithAnthropic({ model, ocrText, lines, bankHint, refineSystem }) {
  const { key } = getApiKeyForProvider('anthropic');
  if (!key) {
    return { ok: false, reason: 'anthropic_not_configured' };
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16_384,
      temperature: 0.05,
      system: refineSystem,
      messages: [
        {
          role: 'user',
          content: buildRefineUserPayload({ bankHint, ocrText, lines }),
        },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, reason: 'anthropic_error', detail: err.slice(0, 300) };
  }
  const data = await res.json();
  const text = data?.content?.find((c) => c.type === 'text')?.text ?? '{}';
  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return { ok: false, reason: 'parse_error', detail: 'Resposta Anthropic não é JSON válido' };
  }
  return { parsed, model, provider: 'anthropic' };
}

/** Refino híbrido: corrige linhas Tesseract existentes. */
export async function handleAiRefineOcrRows(body) {
  const config = loadAiConfig();
  const providerId = String(body?.providerId ?? config.providerId ?? 'gemini').trim();
  const model = normalizeSelectedModel(providerId, body?.model ?? config.model);
  const lines = Array.isArray(body?.lines) ? body.lines : [];
  const ocrText = String(body?.ocrText ?? '');
  const documentType = String(body?.documentType ?? 'extrato');
  const isPlano = documentType === 'plano';
  const refineSystem = isPlano ? PLANO_AI_REFINE_SYSTEM : EXTRATO_AI_REFINE_SYSTEM;

  if (!isProviderConfigured(providerId)) {
    return {
      status: 503,
      body: { ok: false, skipped: true, reason: 'not_configured', lines },
    };
  }

  try {
    const bankHint = isPlano ? null : detectBankHint('', ocrText);
    let refineOut;
    switch (providerId) {
      case 'openai':
        refineOut = await refineOcrRowsWithOpenAI({ model, ocrText, lines, bankHint, refineSystem });
        break;
      case 'anthropic':
        refineOut = await refineOcrRowsWithAnthropic({ model, ocrText, lines, bankHint, refineSystem });
        break;
      case 'gemini':
      default:
        refineOut = await refineOcrRowsWithGemini({ model, ocrText, lines, bankHint, refineSystem });
        break;
    }

    if (refineOut?.ok === false) {
      return {
        status: 200,
        body: {
          ok: false,
          skipped: true,
          reason: refineOut.reason ?? 'refine_error',
          detail: refineOut.detail,
          lines,
        },
      };
    }

    const parsed = refineOut.parsed ?? {};
    const rows = isPlano
      ? normalizeAiPlanoRows(parsed?.rows ?? lines)
      : normalizeAiRows(parsed?.rows ?? lines, { bankHint });
    if (isPlano) {
      return {
        status: 200,
        body: {
          ok: true,
          rows: rows.length > 0 ? rows : lines,
          model: refineOut.model,
          provider: refineOut.provider,
        },
      };
    }
    const conciliacao = computeConciliacaoAi(
      rows,
      parseAiSaldoFields(parsed).saldoAnterior,
      parseAiSaldoFields(parsed).saldoFinal,
    );
    return {
      status: 200,
      body: {
        ok: true,
        rows: rows.length > 0 ? rows : lines,
        model: refineOut.model,
        provider: refineOut.provider,
        conciliacao,
      },
    };
  } catch (err) {
    return {
      status: 200,
      body: { ok: false, skipped: true, reason: 'refine_error', detail: err?.message, lines },
    };
  }
}

const COLIGADAS_AI_EXTRACT_SYSTEM = [
  'Você extrai nomes de empresas COLIGADAS / partes relacionadas de documentos contábeis brasileiros.',
  'Leia o texto e/ou imagem e devolva SOMENTE JSON válido:',
  '{"coligadas":[{"nome":"RAZAO SOCIAL LTDA","aliases":["SIGLA","NOME CURTO"]}]}',
  'Regras:',
  '- nome = razão social ou nome principal da empresa coligada.',
  '- aliases = siglas, nomes curtos e variações (A.J.T.F, AJTF, etc.).',
  '- NÃO devolva nome de arquivo, extensão (.png/.pdf), marcador de página (PDFPAG, PAG 2),',
  '  rótulos genéricos ("empresas coligadas", "imagem anexada") nem cabeçalhos de planilha.',
  '- Se não houver empresa identificável, devolva {"coligadas":[]}.',
  'Máximo 40 coligadas.',
].join('\n');

function normalizeColigadasExtractRows(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const nome = String(item?.nome ?? '').trim();
    if (!nome || nome.length < 3 || nome.length > 90) continue;
    const upper = nome.toUpperCase();
    if (/^(IMAGEM|ARQUIVO)\s+ANEXAD|PDFPAG\d+|^PAG(INA)?\s*\d+$/i.test(upper)) continue;
    if (/\.(PNG|JPE?G|PDF|WEBP|GIF|BMP)$/i.test(nome)) continue;
    const key = upper.replace(/[^A-Z0-9]/g, '');
    if (!key || key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    const aliases = Array.isArray(item?.aliases)
      ? item.aliases.map((a) => String(a ?? '').trim()).filter(Boolean).slice(0, 12)
      : [];
    out.push({ nome, aliases: aliases.length ? aliases : [nome] });
    if (out.length >= 40) break;
  }
  return out;
}

async function extractColigadasWithGemini({ model, ocrText, images, fileName }) {
  if (!isGeminiConfigured()) {
    return { ok: false, reason: 'gemini_not_configured' };
  }
  const userParts = [
    fileName ? `Arquivo: ${fileName}` : '',
    ocrText?.trim() ? `\n--- Texto do documento ---\n${ocrText.trim().slice(0, 24_000)}` : '',
    '\nExtraia todas as empresas coligadas / partes relacionadas visíveis.',
  ]
    .filter(Boolean)
    .join('\n');
  const out = await callGeminiExtract({
    model,
    systemInstruction: COLIGADAS_AI_EXTRACT_SYSTEM,
    userParts,
    images: images?.length ? images.slice(0, 6) : [],
    temperature: 0.05,
  });
  const parsed = parseGeminiJson(out.text);
  const coligadas = normalizeColigadasExtractRows(parsed?.coligadas ?? []);
  if (!coligadas.length) {
    return { ok: false, reason: 'empty_extraction', detail: 'Nenhuma coligada identificada no documento.' };
  }
  return { ok: true, coligadas, provider: 'gemini', model: out.model ?? model };
}

/** @param {object} body */
export async function handleAiExtractColigadas(body) {
  const config = loadAiConfig();
  const providerId = String(body?.providerId ?? config.providerId ?? 'gemini').trim();
  const model = normalizeSelectedModel(providerId, body?.model ?? config.model);
  const images = Array.isArray(body?.images) ? body.images : [];
  const ocrText = String(body?.ocrText ?? body?.text ?? '');
  const fileName = String(body?.fileName ?? '').trim();

  if (!isProviderConfigured(providerId)) {
    return {
      status: 503,
      body: {
        ok: false,
        reason: `${providerId}_not_configured`,
        detail: `Configure a chave API de ${providerId} na aba IA do Contábil`,
      },
    };
  }

  if (!images.length && ocrText.trim().length < 20) {
    return {
      status: 422,
      body: {
        ok: false,
        reason: 'no_input',
        detail: 'Envie imagem ou texto do documento de coligadas.',
      },
    };
  }

  try {
    let result;
    if (providerId === 'gemini' || providerId === '') {
      result = await extractColigadasWithGemini({ model, ocrText, images, fileName });
    } else {
      result = await extractColigadasWithGemini({ model, ocrText, images, fileName });
    }
    if (!result.ok) {
      return { status: result.reason === 'empty_extraction' ? 422 : 503, body: result };
    }
    return {
      status: 200,
      body: {
        ok: true,
        coligadas: result.coligadas,
        model: result.model,
        provider: result.provider,
        detail: `${result.coligadas.length} coligada(s) extraída(s).`,
      },
    };
  } catch (err) {
    return {
      status: 503,
      body: {
        ok: false,
        reason: 'extract_error',
        detail: err?.userHint ?? err?.message ?? String(err),
      },
    };
  }
}

const SOCIOS_AI_EXTRACT_SYSTEM = [
  'Você extrai nomes de SÓCIOS / administradores / quotistas de contratos sociais brasileiros.',
  'Leia o texto e/ou imagem e devolva SOMENTE JSON válido:',
  '{"coligadas":[{"nome":"NOME COMPLETO DO SOCIO","aliases":["APELIDO","VARIACAO"]}]}',
  'Regras:',
  '- nome = nome completo da pessoa física (sócio, administrador, quotista).',
  '- aliases = variações curtas do nome quando visíveis.',
  '- NÃO devolva nome de arquivo, extensão, marcador de página nem rótulos genéricos.',
  '- NÃO devolva razão social da empresa — apenas pessoas físicas.',
  '- Se não houver sócio identificável, devolva {"coligadas":[]}.',
  'Máximo 20 sócios.',
].join('\n');

async function extractSociosWithGemini({ model, ocrText, images, fileName }) {
  if (!isGeminiConfigured()) {
    return { ok: false, reason: 'gemini_not_configured' };
  }
  const userParts = [
    fileName ? `Arquivo: ${fileName}` : '',
    ocrText?.trim() ? `\n--- Texto do documento ---\n${ocrText.trim().slice(0, 24_000)}` : '',
    '\nExtraia todos os sócios / administradores / quotistas visíveis.',
  ]
    .filter(Boolean)
    .join('\n');
  const out = await callGeminiExtract({
    model,
    systemInstruction: SOCIOS_AI_EXTRACT_SYSTEM,
    userParts,
    images: images?.length ? images.slice(0, 6) : [],
    temperature: 0.05,
  });
  const parsed = parseGeminiJson(out.text);
  const socios = normalizeColigadasExtractRows(parsed?.coligadas ?? parsed?.socios ?? []);
  if (!socios.length) {
    return { ok: false, reason: 'empty_extraction', detail: 'Nenhum sócio identificado no documento.' };
  }
  return { ok: true, coligadas: socios, provider: 'gemini', model: out.model ?? model };
}

/** @param {object} body */
export async function handleAiExtractSocios(body) {
  const config = loadAiConfig();
  const providerId = String(body?.providerId ?? config.providerId ?? 'gemini').trim();
  const model = normalizeSelectedModel(providerId, body?.model ?? config.model);
  const images = Array.isArray(body?.images) ? body.images : [];
  const ocrText = String(body?.ocrText ?? body?.text ?? '');
  const fileName = String(body?.fileName ?? '').trim();

  if (!isProviderConfigured(providerId)) {
    return {
      status: 503,
      body: {
        ok: false,
        reason: `${providerId}_not_configured`,
        detail: `Configure a chave API de ${providerId} na aba IA do Contábil`,
      },
    };
  }

  if (!images.length && ocrText.trim().length < 20) {
    return {
      status: 422,
      body: {
        ok: false,
        reason: 'no_input',
        detail: 'Envie imagem ou texto do contrato social / sócios.',
      },
    };
  }

  try {
    const result = await extractSociosWithGemini({ model, ocrText, images, fileName });
    if (!result.ok) {
      return { status: result.reason === 'empty_extraction' ? 422 : 503, body: result };
    }
    return {
      status: 200,
      body: {
        ok: true,
        coligadas: result.coligadas,
        model: result.model,
        provider: result.provider,
        detail: `${result.coligadas.length} sócio(s) extraído(s).`,
      },
    };
  } catch (err) {
    return {
      status: 503,
      body: {
        ok: false,
        reason: 'extract_error',
        detail: err?.userHint ?? err?.message ?? String(err),
      },
    };
  }
}

/** @param {object} body */
export async function handleAiOcrOverlay(body) {
  const config = loadAiConfig();
  const providerId = 'gemini'; // OCR Overlay suportado apenas via Gemini Vision
  const model = normalizeSelectedModel(providerId, body?.model ?? config.model);

  if (!isGeminiConfigured()) {
    return {
      status: 503,
      body: { ok: false, reason: 'gemini_not_configured', detail: 'Configure a chave Gemini na aba IA ou no .env' },
    };
  }

  const payload = {
    model,
    images: Array.isArray(body?.images) ? body.images : [],
    fileName: String(body?.fileName ?? '').trim(),
  };

  try {
    const out = await callGeminiExtract({
      model: payload.model,
      systemInstruction: EXTRATO_AI_OCR_OVERLAY_SYSTEM,
      userParts: `Realize o OCR do documento: ${payload.fileName}`,
      images: payload.images,
      temperature: 0,
      responseSchema: EXTRATO_AI_OCR_OVERLAY_SCHEMA,
    });

    const parsed = parseGeminiJson(out.text);
    if (!parsed || !Array.isArray(parsed.blocks)) {
      return {
        status: 422,
        body: { ok: false, reason: 'parse_error', detail: 'A IA não retornou blocos de texto válidos.' },
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        blocks: parsed.blocks,
        model: out.model,
        provider: 'gemini',
        detail: `${parsed.blocks.length} blocos de texto reconhecidos.`,
      },
    };
  } catch (err) {
    return {
      status: 503,
      body: { ok: false, reason: 'extract_error', detail: err.message },
    };
  }
}
