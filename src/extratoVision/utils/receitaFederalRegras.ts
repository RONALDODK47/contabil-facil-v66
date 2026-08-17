import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import catalogoBase from '../data/receita-federal-regras-v1.json';
import { writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import { getClassificacao } from './demonstracoesContabeis';
import { isContaDisponibilidade } from './naturezaContabil';
import {
  detectFiscalImpostoKey,
  type FiscalImpostoChave,
  type FiscalContaMap,
} from './fiscalContaMapping';
import {
  type AutomacaoContaConfig,
  type AutomacaoContaPapel,
  resolverContaAutomacao,
  resolverDataAutomacao,
  resolverParAutomacao,
} from './automatizacaoContaConfig';
import { criarParLancamento } from './balanceteLancamentos';

export type ReceitaFederalEscopo = 'federal' | 'estadual' | 'municipal' | 'contabil' | 'folha';

export type ReceitaFederalLancamentoPapel =
  | 'despesa_tributaria'
  | 'despesa_encargo'
  | 'despesa_folha'
  | 'conta_imposto'
  | 'conta_folha'
  | 'conta_alvo'
  | 'contrapartida';

export type ReceitaFederalLancamentoRegra = {
  debito: ReceitaFederalLancamentoPapel;
  credito: ReceitaFederalLancamentoPapel;
};

export type ReceitaFederalRegra = {
  id: string;
  escopo: ReceitaFederalEscopo;
  categoria: string;
  impostoKey?: FiscalImpostoChave;
  titulo: string;
  fundamentoLegal: string;
  descricao: string;
  palavrasChave: string[];
  grupoPlanoEsperado?: string;
  naturezaSaldo?: 'D' | 'C';
  lancamentoCreditoLinha?: ReceitaFederalLancamentoRegra;
  lancamentoDebitoLinha?: ReceitaFederalLancamentoRegra;
  ativa?: boolean;
};

export type ReceitaFederalCatalogo = {
  versao: string;
  fonte: string;
  regras: ReceitaFederalRegra[];
};

export type ReceitaFederalEmpresaMeta = {
  cnpj?: string;
  razaoSocial?: string;
  naturezaJuridica?: string;
  regimeTributario?: string;
  uf?: string;
  municipio?: string;
  sincronizadoEm?: string;
  fonteConsulta?: string;
};

export type ReceitaFederalRegrasStore = {
  versaoCatalogo: string;
  empresaMeta?: ReceitaFederalEmpresaMeta;
  regras: ReceitaFederalRegra[];
  atualizadoEm: string;
};

const STORAGE_KEY = 'extratoVision_receita_federal_regras_v1';

type PersistPayload = Record<string, ReceitaFederalRegrasStore>;

function normEmpresa(empresa: string): string {
  const v = empresa.trim().toLowerCase();
  return v || '__default__';
}

function normTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

export function getCatalogoReceitaFederalBase(): ReceitaFederalCatalogo {
  return catalogoBase as ReceitaFederalCatalogo;
}

function readRaw(): PersistPayload {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as PersistPayload;
  } catch {
    return {};
  }
}

function writeRaw(all: PersistPayload): void {
  writePersistedLocalStorageJson(STORAGE_KEY, all);
}

export function readReceitaFederalRegras(empresa: string): ReceitaFederalRegrasStore {
  const saved = readRaw()[normEmpresa(empresa)];
  if (saved?.regras?.length) return saved;
  const base = getCatalogoReceitaFederalBase();
  return {
    versaoCatalogo: base.versao,
    regras: base.regras.map((r) => ({ ...r, ativa: true })),
    atualizadoEm: new Date().toISOString(),
  };
}

export function saveReceitaFederalRegras(empresa: string, store: ReceitaFederalRegrasStore): void {
  const all = readRaw();
  all[normEmpresa(empresa)] = store;
  writeRaw(all);
}

export function regrasAtivas(store: ReceitaFederalRegrasStore): ReceitaFederalRegra[] {
  return store.regras.filter((r) => r.ativa !== false);
}

/** Localiza regra por texto da linha (relatório fiscal/folha). */
export function encontrarRegraReceitaFederal(
  texto: string,
  store: ReceitaFederalRegrasStore,
  origem?: 'folha' | 'fiscal',
): ReceitaFederalRegra | null {
  const t = normTexto(texto);
  if (!t) return null;

  const candidatas = regrasAtivas(store).filter((r) => {
    if (origem === 'folha') {
      if (r.escopo === 'folha' || r.categoria === 'obrigacao_folha') return true;
      if (r.escopo === 'federal' && r.impostoKey === 'inss') return true;
      return false;
    }
    if (origem === 'fiscal') {
      return r.escopo !== 'folha' || !!r.impostoKey;
    }
    return true;
  });

  let melhor: ReceitaFederalRegra | null = null;
  let melhorScore = 0;

  for (const regra of candidatas) {
    let score = 0;
    for (const kw of regra.palavrasChave) {
      const k = normTexto(kw);
      if (k.length >= 3 && t.includes(k)) score += k.length >= 6 ? 3 : 2;
    }
    if (regra.impostoKey) {
      const det = detectFiscalImpostoKey(texto);
      if (det === regra.impostoKey) score += 5;
    }
    if (score > melhorScore) {
      melhorScore = score;
      melhor = regra;
    }
  }

  return melhorScore >= 2 ? melhor : null;
}

/** Regra RF de escopo contábil (ativo, banco, partidas) por nome/classificação da conta. */
export function encontrarRegraContaContabilRf(
  row: Pick<VisionBalanceteRow, 'nome' | 'classificacao' | 'codigo'>,
  store: ReceitaFederalRegrasStore,
): ReceitaFederalRegra | null {
  const texto = `${row.nome ?? ''} ${row.classificacao ?? ''} ${row.codigo ?? ''}`;
  const porNome = encontrarRegraReceitaFederal(texto, store);
  if (porNome?.escopo === 'contabil') return porNome;

  const cls = normCls(getClassificacao(row as VisionBalanceteRow));
  const root = cls[0] ?? '';
  const candidatas = regrasAtivas(store).filter(
    (r) => r.escopo === 'contabil' && r.categoria === 'ativo_disponibilidade',
  );
  if (isContaDisponibilidade(row)) {
    return candidatas.find((r) => r.id === 'rf-contabil-banco') ?? candidatas[0] ?? null;
  }

  for (const regra of candidatas) {
    if (regra.grupoPlanoEsperado && root === regra.grupoPlanoEsperado) {
      for (const kw of regra.palavrasChave) {
        if (normTexto(kw).length >= 3 && normTexto(texto).includes(normTexto(kw))) return regra;
      }
    }
  }
  return null;
}

export function impostoKeyComRegrasRf(
  texto: string,
  store: ReceitaFederalRegrasStore,
): FiscalImpostoChave {
  const regra = encontrarRegraReceitaFederal(texto, store, 'fiscal');
  if (regra?.impostoKey) return regra.impostoKey;
  return detectFiscalImpostoKey(texto);
}

function normCls(cls: string): string {
  return cls.replace(/\./g, '').replace(/\s/g, '').trim();
}

const CUSTO_PAPEIS_FALLBACK: AutomacaoContaPapel[] = ['custo_cmv', 'custo_cpv', 'custo_servicos', 'custos'];

function escolherDespesaPorOrigem(
  balanceteMes: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  origem: 'folha' | 'fiscal',
  contaConfig?: AutomacaoContaConfig,
  regra?: ReceitaFederalRegra | null,
): VisionBalanceteRow | null {
  for (const papel of CUSTO_PAPEIS_FALLBACK) {
    const cfgCusto = resolverContaAutomacao(papel, contaConfig ?? {}, planoRows, balanceteMes, 'debito');
    if (cfgCusto) return cfgCusto;
  }
  const cfg = resolverContaAutomacao('despesa_ajuste', contaConfig ?? {}, planoRows, balanceteMes, 'debito');
  if (cfg) return cfg;

  const predFolha = (r: VisionBalanceteRow) => {
    const cls = normCls(getClassificacao(r));
    const n = (r.nome ?? '').toLowerCase();
    return /^4/.test(cls) || /sal[aá]rio|folha|encargo|prov/i.test(n);
  };
  const predFiscal = (r: VisionBalanceteRow) => {
    const cls = normCls(getClassificacao(r));
    const n = (r.nome ?? '').toLowerCase();
    return /^4/.test(cls) || /imposto|tribut|despesa/i.test(n);
  };
  const predEncargo =
    regra?.lancamentoCreditoLinha?.debito === 'despesa_encargo' ? predFolha : predFiscal;
  const pred = origem === 'folha' ? predEncargo : predFiscal;

  const analiticas = balanceteMes.filter((r) => r.tipo !== 'S' && pred(r));
  if (analiticas.length) return analiticas[0];

  const p = planoRows.find((x) => x.tipo === 'A' && pred({
    codigo: x.codigoReduzido ?? x.codigo,
    classificacao: x.codigo,
    nome: x.nome,
    tipo: 'A',
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
  } as VisionBalanceteRow));
  if (!p) return null;
  return {
    codigo: p.codigoReduzido ?? p.codigo,
    classificacao: p.codigo,
    nome: p.nome,
    tipo: 'A',
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
  };
}

export type SugestaoLancamentoRf = {
  regra: ReceitaFederalRegra;
  fundamentoLegal: string;
  historico: string;
};

/** Monta par de lançamentos conforme regra RF + mapa fiscal/config. */
export function gerarLancamentosComRegraReceitaFederal(params: {
  linha: VisionBalanceteRow;
  contaAlvo: VisionBalanceteRow;
  balanceteMes: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  periodo: { ate: string };
  origem: 'folha' | 'fiscal';
  ordem: number;
  store: ReceitaFederalRegrasStore;
  fiscalContaMap?: FiscalContaMap;
  contaConfig?: AutomacaoContaConfig;
}): { lancamentos: VisionBalanceteRow[]; sugestao?: SugestaoLancamentoRf } {
  const { linha, contaAlvo, balanceteMes, planoRows, origem, ordem, store, fiscalContaMap, contaConfig } =
    params;
  const data =
    linha.data?.trim() ||
    resolverDataAutomacao(
      { label: '', de: params.periodo.ate, ate: params.periodo.ate },
      contaConfig,
    );
  const deb = linha.debito ?? 0;
  const cred = linha.credito ?? 0;
  const regra = encontrarRegraReceitaFederal(linha.nome ?? '', store, origem);
  const histBase = regra
    ? `[RF ${regra.id}] ${linha.nome}`
    : `[Auto ${origem}] ${linha.nome}`;

  const par = (conta: VisionBalanceteRow, contra: VisionBalanceteRow, debito: number, credito: number) => {
    const importId = `rf-auto:${(conta.codigo ?? '').trim()}|${(contra.codigo ?? '').trim()}|${histBase}|${data}`;
    return criarParLancamento({
      contaDeb: conta,
      contaCred: contra,
      valor: debito || credito,
      data,
      historico: histBase,
      ordem,
      importId,
    });
  };

  const parDespCfg = contaConfig
    ? resolverParAutomacao('despesa_ajuste', contaConfig, planoRows, balanceteMes)
    : { debito: null, credito: null };

  if (cred >= 0.05 && deb < 0.05) {
    const contaDeb = parDespCfg.debito ?? escolherDespesaPorOrigem(balanceteMes, planoRows, origem, contaConfig, regra);
    const contaCred = parDespCfg.credito ?? contaAlvo;
    if (!contaDeb || !contaCred) return { lancamentos: [] };
    return {
      lancamentos: par(contaDeb, contaCred, cred, cred),
      sugestao: regra
        ? { regra, fundamentoLegal: regra.fundamentoLegal, historico: histBase }
        : undefined,
    };
  }
  if (deb >= 0.05 && cred < 0.05) {
    const contaDeb = parDespCfg.debito ?? contaAlvo;
    const contaCred = parDespCfg.credito ?? escolherDespesaPorOrigem(balanceteMes, planoRows, origem, contaConfig, regra);
    if (!contaDeb || !contaCred) return { lancamentos: [] };
    return {
      lancamentos: par(contaDeb, contaCred, deb, deb),
      sugestao: regra
        ? { regra, fundamentoLegal: regra.fundamentoLegal, historico: histBase }
        : undefined,
    };
  }
  return { lancamentos: [] };
}

export function sugerirClassificacaoPorRegraRf(
  linha: VisionBalanceteRow,
  balanceteMes: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  fiscalMap: FiscalContaMap,
  store: ReceitaFederalRegrasStore,
): string | null {
  const imp = impostoKeyComRegrasRf(linha.nome ?? '', store);
  const clsMap = fiscalMap[imp];
  if (clsMap) return clsMap;

  const regra = encontrarRegraReceitaFederal(linha.nome ?? '', store, 'fiscal');
  if (!regra?.grupoPlanoEsperado) return null;

  const candidato = balanceteMes.find((r) => {
    if (r.tipo === 'S') return false;
    const root = normCls(getClassificacao(r))[0];
    if (root !== regra.grupoPlanoEsperado) return false;
    if (regra.impostoKey) {
      return detectFiscalImpostoKey(r.nome ?? '') === regra.impostoKey;
    }
    return true;
  });
  if (candidato) return getClassificacao(candidato);

  const p = planoRows.find((x) => {
    if (x.tipo !== 'A') return false;
    const root = normCls(x.codigo)[0];
    return root === regra.grupoPlanoEsperado;
  });
  return p?.codigo ?? null;
}
