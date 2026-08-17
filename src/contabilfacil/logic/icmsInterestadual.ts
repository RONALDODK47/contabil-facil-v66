import catalogoBase from '../data/icms-uf-aliquotas-v2026.json';

export type IcmsRegiao = 'NORTE' | 'NORDESTE' | 'CENTRO-OESTE' | 'SUDESTE' | 'SUL';

export type IcmsUfInfo = {
  uf: string;
  nome: string;
  regiao: IcmsRegiao;
  aliquotaInterna: number;
};

export type IcmsCatalogo = {
  versao: string;
  atualizadoEm: string;
  fontes: string[];
  portalDifalUrl: string;
  confazUrl: string;
  ufs: IcmsUfInfo[];
};

export type IcmsComparacaoParams = {
  ufOrigem: string;
  ufDestino: string;
  valorBase?: number;
  produtoImportado?: boolean;
  consumidorFinalNaoContribuinte?: boolean;
};

export type IcmsComparacaoResult = {
  ufOrigem: string;
  ufDestino: string;
  nomeOrigem: string;
  nomeDestino: string;
  operacaoInterestadual: boolean;
  aliquotaInternaOrigem: number;
  aliquotaInternaDestino: number;
  aliquotaInterestadual: number;
  diferencaAliquotas: number;
  diferencaPercentualPontos: number;
  difalAplicavel: boolean;
  difalPercentual: number;
  valorBase: number;
  valorIcmsInterestadual: number;
  valorDifalEstimado: number;
  custoIcmsExtraEstimado: number;
  fundamentoInterestadual: string;
  fundamentoDifal: string;
  avisos: string[];
};

const UFS: IcmsUfInfo[] = catalogoBase.ufs as IcmsUfInfo[];
const UF_MAP = new Map(UFS.map((u) => [u.uf, u]));

export function getIcmsCatalogo(): IcmsCatalogo {
  return catalogoBase as IcmsCatalogo;
}

export function listarUfsIcms(): IcmsUfInfo[] {
  return [...UFS];
}

export function normalizarUf(uf: string): string {
  return String(uf ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
}

export function getUfIcms(uf: string): IcmsUfInfo | null {
  return UF_MAP.get(normalizarUf(uf)) ?? null;
}

/** Resolução Senado 13/2012 — alíquota interestadual padrão (mercadoria nacional). */
export function calcularAliquotaInterestadual(
  ufOrigem: string,
  ufDestino: string,
  produtoImportado = false,
): { aliquota: number; fundamento: string } {
  const origem = getUfIcms(ufOrigem);
  const destino = getUfIcms(ufDestino);
  if (!origem || !destino) {
    return { aliquota: 0, fundamento: 'UF inválida.' };
  }
  if (origem.uf === destino.uf) {
    return {
      aliquota: origem.aliquotaInterna,
      fundamento: 'Operação interna — aplica alíquota interna do estado.',
    };
  }
  if (produtoImportado) {
    return {
      aliquota: 4,
      fundamento:
        'Resolução do Senado Federal nº 13/2012 — 4% (importado ou conteúdo de importação > 40%).',
    };
  }

  const origemSulSudesteSemEs =
    origem.regiao === 'SUL' || (origem.regiao === 'SUDESTE' && origem.uf !== 'ES');
  const destinoNorteNordesteCoOuEs =
    destino.regiao === 'NORTE' ||
    destino.regiao === 'NORDESTE' ||
    destino.regiao === 'CENTRO-OESTE' ||
    destino.uf === 'ES';

  if (origemSulSudesteSemEs && destinoNorteNordesteCoOuEs) {
    return {
      aliquota: 7,
      fundamento:
        'Resolução do Senado Federal nº 13/2012 — 7% (origem Sul/Sudeste exc. ES → Norte, Nordeste, CO ou ES).',
    };
  }

  return {
    aliquota: 12,
    fundamento:
      'Resolução do Senado Federal nº 13/2012 — 12% (demais operações interestaduais entre contribuintes).',
  };
}

/** DIFAL — Convênio ICMS 235/2021 (consumidor final não contribuinte em outra UF). */
export function compararIcmsInterestadual(params: IcmsComparacaoParams): IcmsComparacaoResult {
  const ufOrigem = normalizarUf(params.ufOrigem);
  const ufDestino = normalizarUf(params.ufDestino);
  const valorBase = Math.max(0, params.valorBase ?? 0);
  const avisos: string[] = [];

  const origem = getUfIcms(ufOrigem);
  const destino = getUfIcms(ufDestino);

  if (!origem || !destino) {
    throw new Error('Informe UFs válidas (sigla de 2 letras).');
  }

  const { aliquota: aliquotaInterestadual, fundamento: fundamentoInterestadual } =
    calcularAliquotaInterestadual(ufOrigem, ufDestino, params.produtoImportado === true);

  const operacaoInterestadual = origem.uf !== destino.uf;
  const aliquotaInternaOrigem = origem.aliquotaInterna;
  const aliquotaInternaDestino = destino.aliquotaInterna;

  const diferencaPercentualPontos = operacaoInterestadual
    ? Math.max(0, aliquotaInternaDestino - aliquotaInterestadual)
    : 0;

  const difalAplicavel =
    operacaoInterestadual && params.consumidorFinalNaoContribuinte === true;
  const difalPercentual = difalAplicavel ? diferencaPercentualPontos : 0;

  const valorIcmsInterestadual = (valorBase * aliquotaInterestadual) / 100;
  const valorDifalEstimado = difalAplicavel ? (valorBase * difalPercentual) / 100 : 0;

  /** Para precificação de mercadoria comprada de outro estado: destaque do gap interno × interestadual. */
  const custoIcmsExtraEstimado = operacaoInterestadual
    ? (valorBase * diferencaPercentualPontos) / 100
    : 0;

  if (operacaoInterestadual && !params.consumidorFinalNaoContribuinte) {
    avisos.push(
      'Sem DIFAL na simulação: marque “consumidor final não contribuinte” se a compra for para revenda com IE, o ICMS-ST ou crédito podem alterar o valor.',
    );
  }
  if (aliquotaInternaDestino > 22) {
    avisos.push(
      `${destino.nome}: alíquota interna elevada (${aliquotaInternaDestino}%) — confira exceções por NCM no Portal da DIFAL da UF.`,
    );
  }

  return {
    ufOrigem: origem.uf,
    ufDestino: destino.uf,
    nomeOrigem: origem.nome,
    nomeDestino: destino.nome,
    operacaoInterestadual,
    aliquotaInternaOrigem,
    aliquotaInternaDestino,
    aliquotaInterestadual,
    diferencaAliquotas: diferencaPercentualPontos,
    diferencaPercentualPontos,
    difalAplicavel,
    difalPercentual,
    valorBase,
    valorIcmsInterestadual,
    valorDifalEstimado,
    custoIcmsExtraEstimado,
    fundamentoInterestadual,
    fundamentoDifal:
      'Convênio ICMS nº 235/2021 — Portal Nacional da DIFAL (SEFAZ Virtual RS / SVRS). DIFAL = base × (alíquota interna UF destino − alíquota interestadual).',
    avisos,
  };
}

export function matrizDiferencasPorOrigem(ufOrigem: string): IcmsComparacaoResult[] {
  const origem = normalizarUf(ufOrigem);
  return UFS.filter((d) => d.uf !== origem).map((destino) =>
    compararIcmsInterestadual({
      ufOrigem: origem,
      ufDestino: destino.uf,
      valorBase: 1000,
      consumidorFinalNaoContribuinte: true,
    }),
  );
}
