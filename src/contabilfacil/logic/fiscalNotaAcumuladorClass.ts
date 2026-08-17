import type { SpedNotaFiscal } from '../../extratoVision/utils/spedNotasFiscaisParser';
import {
  cfopEhBonificacao,
  cfopEhCompraRevenda,
  cfopEhEntrada,
  cfopEhRemessa,
  cfopEhSaida,
  cfopEhUsoConsumo,
  normalizarCfop,
} from './fiscalCfopCatalog';

export type FiscalNotaAcumuladorSentido = 'entrada' | 'saida';

export type FiscalNotaAcumuladorFamilia =
  | 'revenda'
  | 'mercadoria'
  | 'devolucao'
  | 'imobilizado'
  | 'uso_consumo'
  | 'servicos'
  | 'bonificacao'
  | 'compensacao'
  | 'remessa'
  | 'outros';

export type FiscalNotaAcumuladorClassificacao = {
  sentido: FiscalNotaAcumuladorSentido;
  familia: FiscalNotaAcumuladorFamilia;
  titulo: string;
  subtitulo: string;
  bucketKey: string;
  cfop: string;
};

type MetaFamilia = { titulo: string; subtitulo: string };

const META_ENTRADA: Record<FiscalNotaAcumuladorFamilia, MetaFamilia> = {
  revenda: {
    titulo: 'Compras para revenda',
    subtitulo: 'Mercadorias adquiridas para comercialização (CFOP 1.102, 2.102, 1.403…)',
  },
  mercadoria: {
    titulo: 'Compras para revenda',
    subtitulo: 'Mercadorias adquiridas para comercialização',
  },
  devolucao: {
    titulo: 'Devolução de vendas',
    subtitulo: 'Retorno de mercadorias vendidas pelo estabelecimento',
  },
  imobilizado: {
    titulo: 'Ativo imobilizado',
    subtitulo: 'Compra de bens para o ativo imobilizado',
  },
  uso_consumo: {
    titulo: 'Material de uso e consumo',
    subtitulo: 'Materiais de consumo — CFOP 1.556 / 2.556 (não é revenda)',
  },
  servicos: {
    titulo: 'Serviços tomados',
    subtitulo: 'Aquisição de serviços de terceiros',
  },
  bonificacao: {
    titulo: 'Bonificação (entrada)',
    subtitulo: 'Doações, brindes e bonificações recebidas',
  },
  compensacao: {
    titulo: 'Compensação e ajustes de crédito',
    subtitulo: 'Transferência, ressarcimento e ajustes de crédito fiscal',
  },
  remessa: {
    titulo: 'NF de remessa (entrada)',
    subtitulo: 'Retorno de remessa — bloqueada, não importada',
  },
  outros: {
    titulo: 'Outras entradas',
    subtitulo: 'CFOP não identificado no SPED — verifique o arquivo ou bloqueie manualmente',
  },
};

const META_SAIDA: Record<FiscalNotaAcumuladorFamilia, MetaFamilia> = {
  revenda: {
    titulo: 'Receita de vendas',
    subtitulo: 'Venda de mercadorias',
  },
  mercadoria: {
    titulo: 'Receita de vendas',
    subtitulo: 'Venda de mercadorias e produtos — receita operacional',
  },
  devolucao: {
    titulo: 'Devolução de compras',
    subtitulo: 'Devolução de mercadorias adquiridas de fornecedores',
  },
  imobilizado: {
    titulo: 'Alienação de imobilizado',
    subtitulo: 'Venda ou baixa de bens do ativo imobilizado',
  },
  uso_consumo: {
    titulo: 'Saída de uso e consumo',
    subtitulo: 'Baixa de materiais de uso e consumo (CFOP 5.556 / 6.556)',
  },
  servicos: {
    titulo: 'Receita de serviços prestados',
    subtitulo: 'Prestação de serviços — receita operacional',
  },
  bonificacao: {
    titulo: 'Bonificação (saída)',
    subtitulo: 'Doações, brindes e bonificações concedidas',
  },
  compensacao: {
    titulo: 'Compensação e ajustes de débito',
    subtitulo: 'Transferência, ressarcimento e ajustes de débito fiscal',
  },
  remessa: {
    titulo: 'NF de remessa (saída)',
    subtitulo: 'Remessa — bloqueada, não importada',
  },
  outros: {
    titulo: 'Outras saídas',
    subtitulo: 'Saídas sem CFOP identificado',
  },
};

export const FAMILIA_ORDEM: FiscalNotaAcumuladorFamilia[] = [
  'revenda',
  'mercadoria',
  'uso_consumo',
  'servicos',
  'devolucao',
  'imobilizado',
  'bonificacao',
  'compensacao',
  'remessa',
  'outros',
];

export function tituloSecaoNotas(sentido: FiscalNotaAcumuladorSentido): string {
  return sentido === 'entrada' ? 'Entradas' : 'Saídas';
}

export function subtituloSecaoNotas(sentido: FiscalNotaAcumuladorSentido): string {
  return sentido === 'entrada'
    ? 'Compras para revenda, uso e consumo, serviços — remessas de entrada não são importadas'
    : 'Receitas, devoluções e uso/consumo — remessas de saída não são importadas';
}

function cfopImobilizado(c: string): boolean {
  return c.endsWith('551') || c.endsWith('552');
}

function cfopServico(c: string): boolean {
  if (c.endsWith('933') || c.endsWith('932')) return true;
  const meio = c.slice(1, 3);
  return meio === '93' || meio === '94' || meio === '95';
}

function cfopDevolucao(c: string): boolean {
  const sufixo = c.slice(1);
  if (/^20[1-9]$/.test(sufixo) || /^41[01]$/.test(sufixo)) return true;
  if (/^21[0-9]$/.test(sufixo)) return true;
  return false;
}

function cfopCompensacao(c: string): boolean {
  const sufixo = c.slice(1);
  return /^60[1-5]$/.test(sufixo) || /^61[0-5]$/.test(sufixo);
}

function inferSentido(nota: SpedNotaFiscal, cfop: string): FiscalNotaAcumuladorSentido {
  if (nota.indOper === '0') return 'entrada';
  if (nota.indOper === '1') return 'saida';
  if (cfop) {
    if (cfopEhEntrada(cfop)) return 'entrada';
    if (cfopEhSaida(cfop)) return 'saida';
  }
  return 'entrada';
}

function inferFamilia(cfop: string, sentido: FiscalNotaAcumuladorSentido): FiscalNotaAcumuladorFamilia {
  if (!cfop) {
    return sentido === 'entrada' ? 'outros' : 'mercadoria';
  }

  if (cfopEhBonificacao(cfop)) return 'bonificacao';
  if (cfopDevolucao(cfop)) return 'devolucao';
  if (cfopCompensacao(cfop)) return 'compensacao';
  if (cfopEhRemessa(cfop)) return 'remessa';
  if (cfopImobilizado(cfop)) return 'imobilizado';
  if (cfopEhUsoConsumo(cfop)) return 'uso_consumo';
  if (cfopServico(cfop)) return 'servicos';
  if (sentido === 'entrada' && cfopEhCompraRevenda(cfop)) return 'revenda';
  if (sentido === 'saida') return 'mercadoria';
  if (sentido === 'entrada') return 'outros';
  return 'mercadoria';
}

export function classificarNotaFiscal(nota: SpedNotaFiscal): FiscalNotaAcumuladorClassificacao {
  const cfop = normalizarCfop(nota.cfop);
  const sentido = inferSentido(nota, cfop);
  const familia = inferFamilia(cfop, sentido);

  const meta = (sentido === 'entrada' ? META_ENTRADA : META_SAIDA)[familia];
  const bucketKey = `NF|${sentido.toUpperCase()}|${familia.toUpperCase()}`;
  return {
    sentido,
    familia,
    titulo: meta.titulo,
    subtitulo: meta.subtitulo,
    bucketKey,
    cfop,
  };
}
