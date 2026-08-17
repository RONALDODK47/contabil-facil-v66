/** Descrições oficiais resumidas de CFOP (SPED / tabela CONFAZ). */
const CFOP_NOMES: Record<string, string> = {
  '1101': 'Compra p/ industrialização ou produção rural',
  '1102': 'Compra p/ comercialização',
  '1201': 'Devolução de venda de produção do estabelecimento',
  '1202': 'Devolução de venda de mercadoria adquirida',
  '1401': 'Compra p/ industrialização em operação com ST',
  '1403': 'Compra p/ comercialização em operação com ST',
  '1551': 'Compra de bem p/ ativo imobilizado',
  '1556': 'Compra de material p/ uso ou consumo',
  '2101': 'Compra p/ industrialização ou produção rural',
  '2102': 'Compra p/ comercialização',
  '2201': 'Devolução de venda de produção do estabelecimento',
  '2202': 'Devolução de venda de mercadoria adquirida',
  '2401': 'Compra p/ industrialização em operação com ST',
  '2403': 'Compra p/ comercialização em operação com ST',
  '2551': 'Compra de bem p/ ativo imobilizado',
  '2556': 'Compra de material p/ uso ou consumo',
  '5101': 'Venda de produção do estabelecimento',
  '5102': 'Venda de mercadoria adquirida de terceiros',
  '5103': 'Venda de produção do estabelecimento fora do estabelecimento',
  '5104': 'Venda de mercadoria adquirida fora do estabelecimento',
  '5401': 'Venda de produção do estabelecimento em operação com ST',
  '5403': 'Venda de mercadoria adquirida em operação com ST',
  '5405': 'Venda de mercadoria adquirida p/ consumidor final com ST',
  '5929': 'Lançamento relativo a cupom fiscal',
  '6101': 'Venda de produção do estabelecimento',
  '6102': 'Venda de mercadoria adquirida de terceiros',
  '6103': 'Venda de produção fora do estabelecimento',
  '6104': 'Venda de mercadoria adquirida fora do estabelecimento',
  '6108': 'Venda de mercadoria adquirida a não contribuinte',
  '6120': 'Venda de mercadoria com substituição tributária (contrib. substituído)',
  '6401': 'Venda de produção em operação com ST',
  '6403': 'Venda de mercadoria adquirida em operação com ST',
  '6923': 'Outra saída de mercadoria ou prestação de serviço',
  '6949': 'Outra saída de mercadoria ou prestação não especificada',
};

const CST_ICMS_NOMES: Record<string, string> = {
  '00': 'Tributada integralmente',
  '10': 'Tributada com ST',
  '20': 'Com redução de base de cálculo',
  '30': 'Isenta ou não tributada com ST',
  '40': 'Isenta',
  '41': 'Não tributada',
  '50': 'Suspensão',
  '51': 'Diferimento',
  '60': 'ICMS cobrado anteriormente por ST',
  '70': 'Com redução de BC e ST',
  '90': 'Outras',
  '101': 'Simples Nacional — tributada com permissão de crédito',
  '102': 'Simples Nacional — sem permissão de crédito',
  '103': 'Simples Nacional — isenção do ICMS p/ faixa de receita',
  '201': 'Simples Nacional — com ST e crédito',
  '202': 'Simples Nacional — com ST sem crédito',
  '500': 'ICMS cobrado anteriormente por ST ou antecipação',
};

export function cfopFamilia(cfop: string): string | null {
  const c = cfop.replace(/\D/g, '');
  if (c.length !== 4) return null;
  const d = c[0];
  // Convenção oficial CFOP: 1/5 = mesmo estado; 2/6 = outros estados (interestadual); 3/7 = exterior.
  if (d === '1') return 'Entrada (estado)';
  if (d === '2') return 'Entrada (interestadual)';
  if (d === '3') return 'Entrada (exterior)';
  if (d === '5') return 'Saída (estado)';
  if (d === '6') return 'Saída (interestadual)';
  if (d === '7') return 'Saída (exterior)';
  return null;
}

export function descricaoCfop(cfop: string): string {
  const c = normalizarCfop(cfop);
  if (!c) return cfop || '—';
  return CFOP_NOMES[c] ?? cfopFamilia(c) ?? `CFOP ${c}`;
}

export function normalizarCfop(cfop?: string): string {
  const c = (cfop ?? '').replace(/\D/g, '');
  if (c.length < 4) return '';
  return c.padStart(4, '0').slice(-4);
}

/** CFOPs de bonificação — não confundir com remessa. */
export function cfopEhBonificacao(cfop: string): boolean {
  const c = normalizarCfop(cfop);
  if (!c) return false;
  if (/^[1235679]91[0-9]$/.test(c)) return true;
  return ['3910', '3911', '3912', '3913', '7910', '7911'].includes(c);
}

/** Material de uso e consumo (entrada e saída). */
export function cfopEhUsoConsumo(cfop: string): boolean {
  const c = normalizarCfop(cfop);
  if (!c) return false;
  return c.endsWith('556') || c.endsWith('557');
}

/** Compra de mercadoria para revenda / comercialização (entradas 1/2/3). */
export function cfopEhCompraRevenda(cfop: string): boolean {
  const c = normalizarCfop(cfop);
  if (!c || !cfopEhEntrada(c)) return false;
  if (cfopEhUsoConsumo(c) || cfopEhRemessa(c)) return false;
  if (c.endsWith('551') || c.endsWith('552')) return false;

  const meio = c.slice(1, 3);
  if (meio === '10' || meio === '11' || meio === '12' || meio === '40' || meio === '41') {
    return true;
  }
  return (
    c.endsWith('102') ||
    c.endsWith('101') ||
    c.endsWith('103') ||
    c.endsWith('104') ||
    c.endsWith('120') ||
    c.endsWith('403') ||
    c.endsWith('405')
  );
}

/**
 * Remessa, consignação, demonstração, retorno e transferência entre filiais.
 * Entrada (1/2/3) e saída (5/6/7) — não entram nos acumuladores.
 */
export function cfopEhRemessa(cfop: string): boolean {
  const c = normalizarCfop(cfop);
  if (!c) return false;
  if (cfopEhBonificacao(c)) return false;
  if (cfopEhUsoConsumo(c)) return false;

  const raiz = c[0];
  if (raiz !== '1' && raiz !== '2' && raiz !== '3' && raiz !== '5' && raiz !== '6' && raiz !== '7') {
    return false;
  }

  const meio = c.slice(1, 3);
  // x.901 a x.929 — remessa, retorno, industrialização por encomenda, demonstração etc.
  if (meio >= '90' && meio <= '92') return true;
  // Outras entradas/saídas de remessa operacional
  if (c.endsWith('949')) return true;
  // Transferência entre estabelecimentos (x.151 a x.154)
  if (/^15[1-4]$/.test(c.slice(1))) return true;

  return false;
}

export function cfopEhRemessaEntrada(cfop: string): boolean {
  return cfopEhRemessa(cfop) && cfopEhEntrada(cfop);
}

export function cfopEhRemessaSaida(cfop: string): boolean {
  return cfopEhRemessa(cfop) && cfopEhSaida(cfop);
}

/** CFOP 1/2/3 — entrada (compra, devolução de venda, importação). */
export function cfopEhEntrada(cfop: string): boolean {
  const raiz = cfop.replace(/\D/g, '').padStart(4, '0').slice(-4)[0];
  return raiz === '1' || raiz === '2' || raiz === '3';
}

/** CFOP 5/6/7 — saída (venda, devolução de compra, exportação). */
export function cfopEhSaida(cfop: string): boolean {
  const raiz = cfop.replace(/\D/g, '').padStart(4, '0').slice(-4)[0];
  return raiz === '5' || raiz === '6' || raiz === '7';
}

function extrairCfopDeCodigoAcumulador(codigo: string): string | null {
  const partes = codigo.split('-');
  const ultima = partes[partes.length - 1]?.replace(/\D/g, '') ?? '';
  if (ultima.length === 4) return ultima.padStart(4, '0').slice(-4);
  return null;
}

/** Natureza contábil do acumulador: entrada/compra → débito; saída/venda → crédito. */
export function inferNaturezaAcumuladorPorOperacao(item: {
  codigo: string;
  descricao: string;
  nome?: string;
  registro?: string;
}): 'devedora' | 'credora' | null {
  const cfopCodigo = extrairCfopDeCodigoAcumulador(item.codigo);
  if (cfopCodigo) {
    if (cfopEhEntrada(cfopCodigo)) return 'devedora';
    if (cfopEhSaida(cfopCodigo)) return 'credora';
  }

  const cfopDesc = item.descricao.match(/CFOP\s+(\d{4})/i)?.[1];
  if (cfopDesc) {
    if (cfopEhEntrada(cfopDesc)) return 'devedora';
    if (cfopEhSaida(cfopDesc)) return 'credora';
  }

  const texto = `${item.nome ?? ''} ${item.descricao ?? ''}`.toLowerCase();
  if (
    (/\bcompra\b|\bentrada\b|aquisi/i.test(texto) || texto.includes('entrada (')) &&
    !/devolu[cç][aã]o de venda/i.test(texto)
  ) {
    return 'devedora';
  }
  if (/\bvenda\b|\bsa[ií]da\b/i.test(texto) || /sa[ií]da\s*\(/i.test(texto)) {
    return 'credora';
  }

  return null;
}

export function descricaoCstIcms(cst: string): string {
  const t = cst.replace(/\D/g, '').padStart(3, '0').slice(-3);
  return CST_ICMS_NOMES[t] ?? `CST ${t}`;
}

/** CSOSN do Simples Nacional (3 dígitos: 101–199, 201–299, …, 900–999). */
export function isSimplesNacionalCsosn(cst: string): boolean {
  const digits = cst.replace(/\D/g, '');
  if (digits.length < 3) return false;
  const n = Number.parseInt(digits.slice(-3).padStart(3, '0'), 10);
  if (!Number.isFinite(n)) return false;
  return (
    (n >= 101 && n <= 199) ||
    (n >= 201 && n <= 299) ||
    (n >= 300 && n <= 399) ||
    (n >= 400 && n <= 499) ||
    (n >= 500 && n <= 599) ||
    (n >= 900 && n <= 999)
  );
}

/** Nome amigável para acumulador C190 (CST + CFOP). */
export function nomeAcumuladorC190(cst: string, cfop: string, itemHint?: string): string {
  const cfopNome = descricaoCfop(cfop);
  const cstNome = descricaoCstIcms(cst);
  if (itemHint?.trim()) {
    return `${itemHint.trim()} · ${cfopNome}`;
  }
  return `${cfopNome} · ${cstNome}`;
}
