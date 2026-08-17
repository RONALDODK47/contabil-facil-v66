/**
 * Catálogo e helpers de regras Receita Federal (usado pela API fiscal local).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

let _catalogo = null;

export function loadCatalogoReceitaFederal() {
  if (_catalogo) return _catalogo;
  const path = join(__dir, '../src/extratoVision/data/receita-federal-regras-v1.json');
  _catalogo = JSON.parse(readFileSync(path, 'utf8'));
  return _catalogo;
}

function normTexto(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

const IMPOSTO_PATTERNS = [
  ['icms', /\bicms\b/],
  ['ipi', /\bipi\b/],
  ['iss', /\biss\b|\bissqn\b/],
  ['pis', /\bpis\b|\bpasep\b/],
  ['cofins', /\bcofins\b/],
  ['inss', /\binss\b|\bgps\b|\bfgts\b/],
  ['irrf', /\birrf\b|imposto de renda retido/],
  ['irpj', /\birpj\b/],
  ['csll', /\bcsll\b/],
];

export function detectImpostoKey(text) {
  const t = normTexto(text);
  for (const [key, re] of IMPOSTO_PATTERNS) {
    if (re.test(t)) return key;
  }
  return 'outros';
}

export function encontrarRegra(texto, catalogo, origem) {
  const t = normTexto(texto);
  if (!t) return null;
  let melhor = null;
  let melhorScore = 0;
  for (const regra of catalogo.regras) {
    if (regra.ativa === false) continue;
    if (origem === 'folha' && regra.escopo !== 'folha' && regra.categoria !== 'obrigacao_folha') {
      if (!(regra.escopo === 'federal' && regra.impostoKey === 'inss')) continue;
    }
    let score = 0;
    for (const kw of regra.palavrasChave || []) {
      const k = normTexto(kw);
      if (k.length >= 3 && t.includes(k)) score += k.length >= 6 ? 3 : 2;
    }
    if (regra.impostoKey && detectImpostoKey(texto) === regra.impostoKey) score += 5;
    if (score > melhorScore) {
      melhorScore = score;
      melhor = regra;
    }
  }
  return melhorScore >= 2 ? melhor : null;
}

export async function consultarCnpjBrasilApi(cnpj) {
  const clean = String(cnpj).replace(/\D/g, '');
  if (clean.length !== 14) return null;
  const url = `https://brasilapi.com.br/api/cnpj/v1/${clean}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'EmprestimosSim-RF-Regras/1.0' },
  });
  if (!res.ok) return null;
  return res.json();
}

export function buildStoreFromSync({ catalogo, cnpjData, uf, municipio }) {
  const regras = catalogo.regras.map((r) => ({ ...r, ativa: true }));
  const regime =
    cnpjData?.opcao_pelo_simples || cnpjData?.opcao_pelo_mei
      ? 'Simples Nacional'
      : 'Regime normal (Lucro Real/Presumido — conferir ECF)';
  const meta = {
    cnpj: cnpjData?.cnpj ?? undefined,
    razaoSocial: cnpjData?.razao_social ?? cnpjData?.nome_fantasia,
    naturezaJuridica: cnpjData?.natureza_juridica,
    regimeTributario: regime,
    uf: uf || cnpjData?.uf || undefined,
    municipio: municipio || cnpjData?.municipio || undefined,
    sincronizadoEm: new Date().toISOString(),
    fonteConsulta: 'BrasilAPI CNPJ + catálogo RFB/SPED',
  };

  if (meta.regimeTributario?.includes('Simples')) {
    regras.push({
      id: 'rf-sync-simples',
      escopo: 'federal',
      categoria: 'regime',
      titulo: 'Simples Nacional',
      fundamentoLegal: 'LC 123/2006; PGDAS-D',
      descricao: 'Empresa optante pelo Simples — priorizar contas unificadas e DAS.',
      palavrasChave: ['simples', 'das', 'pgdas'],
      ativa: true,
    });
  }

  return {
    versaoCatalogo: catalogo.versao,
    empresaMeta: meta,
    regras,
    atualizadoEm: new Date().toISOString(),
  };
}
