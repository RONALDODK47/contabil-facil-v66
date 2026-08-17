import type { VisionBalanceteRow } from '../types/accounting';
import { getClassificacao } from './demonstracoesContabeis';
import { analisarConformidadeNormativa } from './conformidadeNormativa';
import {
  analisarSaldoContabil,
  isContaDisponibilidade,
  listarContasInvertidas,
} from './naturezaContabil';
import {
  encontrarRegraContaContabilRf,
  readReceitaFederalRegras,
  type ReceitaFederalRegrasStore,
} from './receitaFederalRegras';
import { enriquecerAchadoAuditoria } from './auditoriaReferenciasNormativas';

export type AchadoAuditoriaBalancete = {
  id: string;
  severidade: 'critico' | 'alerta' | 'info';
  titulo: string;
  detalhe: string;
  norma: string;
  conta: string;
  mes?: string;
  /** Por que o achado configura erro ou alerta (texto para PDF). */
  explicacao?: string;
  /** Item, capítulo ou artigo da norma. */
  normaParagrafo?: string;
  /** Trecho sintético da norma citada. */
  normaTrecho?: string;
};

export type AuditoriaBalanceteResumo = {
  total: number;
  criticos: number;
  alertas: number;
  score: number;
  achados: AchadoAuditoriaBalancete[];
  /** Contas banco/caixa com saldo credor ou fora do grupo 1. */
  bancosComProblema: number;
};

function rotuloConta(row: VisionBalanceteRow): string {
  const cls = getClassificacao(row);
  const nome = (row.nome ?? '').trim();
  const cod = (row.codigo ?? '').trim();
  return [cls || cod, nome].filter(Boolean).join(' — ') || 'Conta sem identificação';
}

/** Valida balancete do período contra CPC + catálogo Receita Federal (regras contábeis). */
export function auditarBalanceteContinuo(params: {
  balanceteRows: VisionBalanceteRow[];
  empresaNome?: string;
  store?: ReceitaFederalRegrasStore;
  mesRef?: string;
}): AuditoriaBalanceteResumo {
  const rows = Array.isArray(params.balanceteRows) ? params.balanceteRows : [];
  const store = params.store ?? readReceitaFederalRegras(params.empresaNome ?? '');
  const mes = params.mesRef;
  const achados: AchadoAuditoriaBalancete[] = [];

  const conformidade = analisarConformidadeNormativa(rows, 'balancete');
  for (const a of conformidade.achados) {
    achados.push({
      id: a.id,
      severidade: a.severidade,
      titulo: a.titulo,
      detalhe: a.detalhe,
      norma: a.norma,
      conta: a.conta ?? '—',
      mes,
    });
  }

  const invertidas = listarContasInvertidas(rows);
  for (const row of invertidas) {
    if (achados.some((a) => a.conta === rotuloConta(row) && a.titulo.includes('invertida'))) continue;
    const analise = analisarSaldoContabil(row, rows);
    achados.push({
      id: `inv-${rotuloConta(row)}`,
      severidade: isContaDisponibilidade(row) ? 'critico' : 'alerta',
      titulo: isContaDisponibilidade(row)
        ? 'Banco/disponibilidade com saldo invertido'
        : 'Natureza invertida na conta',
      detalhe: `Saldo ${analise.natureza}, esperado ${analise.naturezaEsperada} (ativo devedor / passivo credor).`,
      norma: 'CPC 26 / NBC TG 26',
      conta: rotuloConta(row),
      mes,
    });
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.tipo === 'S') continue;

    const regra = encontrarRegraContaContabilRf(row, store);
    if (!regra) continue;

    const analise = analisarSaldoContabil(row, rows);
    const cls = getClassificacao(row);
    const root = cls.replace(/\./g, '')[0] ?? '';

    if (regra.grupoPlanoEsperado && root && root !== regra.grupoPlanoEsperado) {
      achados.push({
        id: `rf-grupo-${i}`,
        severidade: isContaDisponibilidade(row) ? 'critico' : 'alerta',
        titulo: `${regra.titulo}: grupo incorreto`,
        detalhe: `Classificação ${cls || '—'} deveria iniciar em ${regra.grupoPlanoEsperado} conforme ${regra.id}.`,
        norma: regra.fundamentoLegal,
        conta: rotuloConta(row),
        mes,
      });
    }

    if (regra.naturezaSaldo && analise.natureza !== regra.naturezaSaldo && analise.valor >= 0.01) {
      const jaTem = achados.some(
        (a) => a.conta === rotuloConta(row) && a.titulo.includes(regra.titulo),
      );
      if (!jaTem) {
        achados.push({
          id: `rf-nat-${regra.id}-${i}`,
          severidade: regra.categoria === 'ativo_disponibilidade' ? 'critico' : 'alerta',
          titulo: `${regra.titulo}: natureza divergente (RF)`,
          detalhe: `Saldo ${analise.natureza}, regra RF exige ${regra.naturezaSaldo}. ${regra.descricao}`,
          norma: regra.fundamentoLegal,
          conta: rotuloConta(row),
          mes,
        });
      }
    }
  }

  const criticos = achados.filter((a) => a.severidade === 'critico').length;
  const alertas = achados.filter((a) => a.severidade === 'alerta').length;
  const bancosComProblema = achados.filter(
    (a) => a.severidade === 'critico' && /banco|disponibilidade/i.test(a.titulo),
  ).length;
  const score = Math.max(0, Math.min(100, 100 - criticos * 20 - alertas * 5));

  const unicos = new Map<string, AchadoAuditoriaBalancete>();
  for (const a of achados) {
    const k = `${a.titulo}|${a.conta}|${a.mes ?? ''}`;
    if (!unicos.has(k)) unicos.set(k, a);
  }

  return {
    total: unicos.size,
    criticos,
    alertas,
    score,
    achados: [...unicos.values()].slice(0, 80).map(enriquecerAchadoAuditoria),
    bancosComProblema,
  };
}
