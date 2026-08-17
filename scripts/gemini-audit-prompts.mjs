/**
 * Prompts Gemini — relatórios claros de inconsistência com ONDE e COMO corrigir.
 */

export const OCR_PIPELINE_MAP = {
  arquivos: [
    'src/lib/ocrExtratoPositional.ts — extração posicional Itaú, enrich TEDs/SISPAG/saldo',
    'src/lib/pdfNativeTextItems.ts — leitura de texto nativo do PDF',
    'src/lib/parcelamentoColunasExtract.ts — mapeamento de colunas OCR',
    'src/contabilfacil/logic/ocrImportMapper.ts — conversão para lançamentos e log de descartados',
    'src/contabilfacil/components/DocumentColunasModal.tsx — modal OCR (fluxo real da UI)',
    'src/contabilfacil/components/DataIngestionBox.tsx — importação e disparo do diagnóstico IA',
    'src/contabilfacil/components/ManagerModule.tsx — tabela extrato e botão LOG',
  ],
  categoriasLog: {
    rejeitado: 'linha descartada (cabeçalho, rodapé, saldo, resumo do período)',
    sem_historico: 'valor detectado sem histórico operacional correspondente na mesma linha',
  },
  problemasConhecidosItau: [
    'TED colada ao rodapé (ex.: R$ 1.030 Ribeirão Pinhal na pág. 2)',
    'SISPAG: valor bruto na coluna vs débito real na linha SALDO DIA (ex.: 17.225 vs 9.999,11)',
    'Linha "Lançamentos do período" importada como R$ 10.000 fantasma',
    'Histórico desalinhado da coluna valor — TED Ourinhos R$ 6.905,92 sem histórico',
  ],
  uiUsuario: [
    'Gerencial → Extrato → importar PDF → modal colunas → confirmar OCR',
    'Botão LOG — relatório IA + linhas descartadas',
    'Conferir saldo anterior, totais C/D e saldo final na tabela',
  ],
};

export const EXTRATO_GEMINI_SYSTEM = [
  'Você é o auditor de qualidade OCR do Eye Vision / ContabilFacil.',
  'Sua função: produzir RELATÓRIO CLARO de inconsistências e erros, informando ONDE está o problema e COMO corrigir.',
  '',
  'Responda SOMENTE JSON válido com esta estrutura:',
  '{',
  '  "relatorio": "parágrafo claro em português BR resumindo a situação geral",',
  '  "summary": "1 frase executiva",',
  '  "saldoCoerente": boolean|null,',
  '  "lancamentosEsperados": number|null,',
  '  "acoesRecomendadas": ["ação 1", "ação 2"],',
  '  "issues": [{',
  '    "severity": "error|warning|info",',
  '    "title": "título curto do problema",',
  '    "detail": "o que está errado e impacto (saldo, lançamento faltando, etc.)",',
  '    "onde": "local exato: linha OCR N, página PDF, célula da tabela, módulo da UI ou arquivo src/…",',
  '    "moduloOuArquivo": "caminho do arquivo ou tela onde corrigir (ex.: src/lib/ocrExtratoPositional.ts)",',
  '    "tipoCorrecao": "usuario|codigo|reimportar",',
  '    "comoCorrigir": "instrução direta e objetiva",',
  '    "passos": ["passo 1", "passo 2"]',
  '  }],',
  '  "diagnosticoTecnico": "causa raiz no pipeline OCR/importação"',
  '}',
  '',
  'Regras:',
  '- Para cada inconsistência, SEMPRE preencha onde, comoCorrigir e passos.',
  '- tipoCorrecao=usuario: usuário ajusta colunas, reimporta ou confere manualmente na UI.',
  '- tipoCorrecao=codigo: indique arquivo .ts exato e função/lógica a revisar.',
  '- tipoCorrecao=reimportar: peça nova importação após correção no código.',
  '- Priorize divergência de saldo, lançamentos ausentes, crédito/débito invertido.',
  '- Use valores R$ e datas quando disponíveis nos dados.',
].join('\n');

export const DEBUG_GEMINI_SYSTEM = [
  'Você audita erros do software Eye Vision / ContabilFacil.',
  'Produza RELATÓRIO CLARO informando ONDE está o erro e COMO corrigir.',
  '',
  'Responda SOMENTE JSON:',
  '{',
  '  "relatorio": "parágrafo claro",',
  '  "summary": "1 frase",',
  '  "acoesRecomendadas": ["..."],',
  '  "issues": [{',
  '    "severity": "error|warning|info",',
  '    "title": "...",',
  '    "detail": "...",',
  '    "onde": "arquivo:linha, componente React, rota API ou ação do usuário",',
  '    "moduloOuArquivo": "src/…",',
  '    "tipoCorrecao": "usuario|codigo",',
  '    "comoCorrigir": "...",',
  '    "passos": ["..."]',
  '  }]',
  '}',
  '',
  'Mapeamento comum: src/contabilfacil/, src/lib/, scripts/agent-api-routes.mjs, API :8790, API fiscal :8780.',
].join('\n');

/** @param {unknown} issue */
export function normalizeGeminiIssue(issue) {
  if (!issue || typeof issue !== 'object') return null;
  const i = /** @type {Record<string, unknown>} */ (issue);
  const severity = ['error', 'warning', 'info'].includes(String(i.severity))
    ? String(i.severity)
    : 'warning';
  const passos = Array.isArray(i.passos)
    ? i.passos.map((p) => String(p ?? '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const comoCorrigir = String(i.comoCorrigir ?? i.suggestion ?? '').trim();
  const title = String(i.title ?? '').trim();
  if (!title) return null;
  return {
    severity,
    title: title.slice(0, 200),
    detail: String(i.detail ?? '').slice(0, 800),
    onde: i.onde ? String(i.onde).slice(0, 400) : undefined,
    moduloOuArquivo: i.moduloOuArquivo ? String(i.moduloOuArquivo).slice(0, 200) : undefined,
    tipoCorrecao: ['usuario', 'codigo', 'reimportar'].includes(String(i.tipoCorrecao))
      ? String(i.tipoCorrecao)
      : undefined,
    comoCorrigir: comoCorrigir ? comoCorrigir.slice(0, 600) : undefined,
    passos,
    suggestion: comoCorrigir ? comoCorrigir.slice(0, 400) : undefined,
  };
}

/** @param {unknown} parsed */
export function normalizeGeminiAuditResponse(parsed, fallbackText = '') {
  if (!parsed || typeof parsed !== 'object') {
    return {
      relatorio: fallbackText.slice(0, 1200),
      summary: fallbackText.slice(0, 300),
      issues: [],
      diagnosticoTecnico: fallbackText.slice(0, 1500),
    };
  }
  const p = /** @type {Record<string, unknown>} */ (parsed);
  const issues = Array.isArray(p.issues)
    ? p.issues.map(normalizeGeminiIssue).filter(Boolean).slice(0, 15)
    : [];
  const acoes = Array.isArray(p.acoesRecomendadas)
    ? p.acoesRecomendadas.map((a) => String(a ?? '').trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    relatorio: p.relatorio ? String(p.relatorio).slice(0, 2000) : undefined,
    summary: String(p.summary ?? p.relatorio ?? '').slice(0, 600),
    saldoCoerente: typeof p.saldoCoerente === 'boolean' ? p.saldoCoerente : null,
    lancamentosEsperados:
      typeof p.lancamentosEsperados === 'number' ? p.lancamentosEsperados : null,
    acoesRecomendadas: acoes,
    issues,
    diagnosticoTecnico: p.diagnosticoTecnico ? String(p.diagnosticoTecnico).slice(0, 2000) : undefined,
  };
}
