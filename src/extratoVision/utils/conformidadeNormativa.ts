import type { VisionBalanceteRow } from '../types/accounting';
import { analisarSaldoContabil, isContaDisponibilidade } from './naturezaContabil';

export type ConformidadeSeveridade = 'critico' | 'alerta' | 'info';
export type ConformidadeContexto = 'fiscal' | 'folha' | 'balancete';

export type ConformidadeAchado = {
  id: string;
  severidade: ConformidadeSeveridade;
  titulo: string;
  detalhe: string;
  norma: string;
  conta?: string;
};

export type ConformidadeResumo = {
  total: number;
  criticos: number;
  alertas: number;
  infos: number;
  score: number;
  normasReferenciadas: string[];
  achados: ConformidadeAchado[];
};

export function analisarConformidadeNormativa(
  rows: VisionBalanceteRow[],
  contexto: ConformidadeContexto,
): ConformidadeResumo {
  const achados: ConformidadeAchado[] = [];
  const safeRows = Array.isArray(rows) ? rows : [];

  if (safeRows.length === 0) {
    return {
      total: 0,
      criticos: 0,
      alertas: 0,
      infos: 0,
      score: 100,
      normasReferenciadas: [],
      achados: [],
    };
  }

  const totalDeb = safeRows.reduce((sum, r) => sum + (r.debito ?? 0), 0);
  const totalCred = safeRows.reduce((sum, r) => sum + (r.credito ?? 0), 0);
  const diff = totalDeb - totalCred;
  if (Math.abs(diff) > 0.1) {
    achados.push({
      id: 'partida-dobrada',
      severidade: 'critico',
      titulo: 'Diferença entre débitos e créditos',
      detalhe: `Diferença atual: ${diff.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
      norma: 'ITG 2000 (R1) / método das partidas dobradas',
    });
  }

  for (let i = 0; i < safeRows.length; i += 1) {
    const row = safeRows[i];
    const conta = row.classificacao || row.codigo || row.nome || `linha ${i + 1}`;
    const nome = (row.nome ?? '').toLowerCase();
    const cls = String(row.classificacao ?? row.codigo ?? '');
    const root = cls.replace(/\./g, '')[0] ?? '';
    const analise = analisarSaldoContabil(row, safeRows);

    if (analise.invertido) {
      const disponibilidade = isContaDisponibilidade(row);
      achados.push({
        id: `inv-${i}`,
        severidade: disponibilidade ? 'critico' : 'alerta',
        titulo: disponibilidade
          ? 'Banco ou disponibilidade com saldo invertido'
          : 'Natureza invertida na conta',
        detalhe: `Conta com natureza ${analise.natureza} e esperada ${analise.naturezaEsperada}.`,
        norma: disponibilidade
          ? 'CPC 26 / NBC TG 03 (caixa e equivalentes) — ITG 2000'
          : 'CPC 26 / NBC TG 26 (apresentação por natureza e grupo)',
        conta,
      });
    }

    if (contexto === 'balancete' && isContaDisponibilidade(row) && analise.valor >= 0.01) {
      const root = cls.replace(/\./g, '')[0] ?? '';
      if (root !== '1') {
        achados.push({
          id: `banco-grupo-${i}`,
          severidade: 'critico',
          titulo: 'Conta bancária fora do ativo (grupo 1)',
          detalhe: `“${row.nome ?? conta}” deve estar em 1.1.1 / 1.1.2 (disponibilidades), não no grupo ${root || '?'}.`,
          norma: 'Receita Federal / ECD — estrutura do ativo circulante',
          conta,
        });
      }
    }

    if (!row.classificacao && !row.codigo) {
      achados.push({
        id: `sem-class-${i}`,
        severidade: contexto === 'balancete' ? 'alerta' : 'info',
        titulo: 'Conta sem código/classificação',
        detalhe:
          contexto === 'balancete'
            ? 'A linha não possui identificação contábil estruturada.'
            : 'Layout simplificado aceito (data + descrição + valor), mas recomenda-se mapear conta contábil.',
        norma: 'ITG 2000 (R1) / escrituração contábil regular',
        conta,
      });
    }

    if (contexto === 'fiscal') {
      if (/(imposto|tribut|icms|ipi|iss|pis|cofins|csll|irpj|inss|fgts|irrf)/i.test(nome) && root === '2') {
        if (analise.natureza !== 'C') {
          achados.push({
            id: `fiscal-passivo-${i}`,
            severidade: 'critico',
            titulo: 'Imposto no passivo com natureza inconsistente',
            detalhe: 'Conta de obrigação tributária no grupo 2 deveria estar com natureza credora.',
            norma: 'CTN + CPC 26 (passivo exigível)',
            conta,
          });
        }
      }
    }

    if (contexto === 'folha') {
      const passivoFolhaNome =
        /(sal[aá]rio|pro[- ]?labore|f[eé]rias|13[oº]|d[ée]cimo|rescis[aã]o|consignad|inss|fgts|irrf).*(a\s+pagar|a\s+recolher|provis)/i.test(
          nome,
        );
      if (passivoFolhaNome && analise.natureza !== 'C') {
        achados.push({
          id: `folha-passivo-${i}`,
          severidade: 'critico',
          titulo: 'Provisão/obrigação de folha com natureza inconsistente',
          detalhe:
            'Salários, pró-labore, férias, 13º, consignados e impostos a pagar/recolher devem estar em passivo credor.',
          norma: 'eSocial / legislação previdenciária e tributária',
          conta,
        });
      }
      if (passivoFolhaNome && root && root !== '2') {
        achados.push({
          id: `folha-grupo-${i}`,
          severidade: 'alerta',
          titulo: 'Conta de obrigação de folha fora do grupo de passivo',
          detalhe: 'Revise o plano para classificar esta provisão/obrigação no grupo de passivo.',
          norma: 'CPC 26 / estrutura do passivo exigível',
          conta,
        });
      }
    }
  }

  const criticos = achados.filter((a) => a.severidade === 'critico').length;
  const alertas = achados.filter((a) => a.severidade === 'alerta').length;
  const infos = achados.filter((a) => a.severidade === 'info').length;

  const score = Math.max(0, Math.min(100, 100 - criticos * 18 - alertas * 6 - infos * 2));
  const normasReferenciadas = [...new Set(achados.map((a) => a.norma))];

  return {
    total: achados.length,
    criticos,
    alertas,
    infos,
    score,
    normasReferenciadas,
    achados: achados.slice(0, 60),
  };
}
