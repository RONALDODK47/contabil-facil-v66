import {
  detectFiscalImpostoKey,
  type FiscalContaMap,
  type FiscalImpostoChave,
} from '../../extratoVision/utils/fiscalContaMapping';
import {
  encontrarRegraReceitaFederal,
  type ReceitaFederalRegra,
  type ReceitaFederalLancamentoPapel,
  type ReceitaFederalRegrasStore,
} from '../../extratoVision/utils/receitaFederalRegras';
import { derivePlanoGroupFromCode } from './planoContasMapper';
import {
  contasParaImposto,
  emptyFiscalContasImposto,
  resolveFiscalImpostoId,
  type FiscalContasImpostoConfig,
} from './fiscalContasImposto';
import type { ExtratoContaPlanoLike } from './extratoContaResolver';
import { pickContaFornecedorExtrato } from './extratoContabilSenior';

export type ExtratoRfContrapartidaResult = {
  conta: string;
  regraId: string;
  fundamentoLegal: string;
};

function regraExtratoCompativelNatureza(
  regra: ReceitaFederalRegra,
  nature: 'D' | 'C',
): boolean {
  if (regra.categoria !== 'extrato_bancario') return true;
  if (regra.id.includes('recebimento')) return nature === 'C';
  if (regra.id.includes('pagamento') || regra.id.includes('tarifa')) return nature === 'D';
  return true;
}

function encontrarRegraReceitaFederalExtrato(
  texto: string,
  store: ReceitaFederalRegrasStore,
  nature: 'D' | 'C',
): ReceitaFederalRegra | null {
  const regra = encontrarRegraReceitaFederal(texto, store);
  if (!regra) return null;
  if (regra.categoria === 'extrato_bancario' && !regraExtratoCompativelNatureza(regra, nature)) {
    const extratoRules = store.regras.filter(
      (r) =>
        r.ativa !== false &&
        r.categoria === 'extrato_bancario' &&
        regraExtratoCompativelNatureza(r, nature),
    );
    let melhor: ReceitaFederalRegra | null = null;
    let melhorScore = 0;
    const t = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const r of extratoRules) {
      let score = 0;
      for (const kw of r.palavrasChave) {
        const k = kw.toLowerCase().trim();
        if (k.length >= 3 && t.includes(k)) score += k.length >= 6 ? 3 : 2;
      }
      if (score > melhorScore) {
        melhorScore = score;
        melhor = r;
      }
    }
    return melhorScore >= 2 ? melhor : null;
  }
  return regraExtratoCompativelNatureza(regra, nature) ? regra : null;
}

function normCls(code: string): string {
  return code.replace(/[^\d]/g, '').trim();
}

function normNome(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function isDisponibilidade(c: ExtratoContaPlanoLike): boolean {
  const n = normNome(c.name);
  const cls = normCls(c.code);
  if (/^11101|^1101|^11102|^1102|^11103|^1103/.test(cls)) return true;
  if (/BANCO|CONTA\s+MOV|CAIXA|COBRANCA/.test(n) && !/FORNEC|CLIENTE/.test(n)) {
    if (/CAIXA/.test(n) || /BANCO|CONTA\s+MOV/.test(n)) return true;
  }
  if (/APLIC|CDB|RDB|COMPROMISSADA/.test(n) && cls.startsWith('1')) return true;
  return false;
}

function pickConta(
  plano: ExtratoContaPlanoLike[],
  pred: (c: ExtratoContaPlanoLike) => boolean,
): string {
  const hit = plano.find((c) => c.tipo !== 'S' && pred(c) && !isDisponibilidade(c));
  return hit?.code?.trim() ?? '';
}

function contaImpostoPassivo(
  impKey: FiscalImpostoChave,
  fiscalMap: FiscalContaMap,
  fiscalContas: FiscalContasImpostoConfig,
): string {
  const mapped = fiscalMap[impKey]?.trim();
  if (mapped) return mapped;
  const labels: Record<FiscalImpostoChave, string> = {
    icms: 'ICMS',
    ipi: 'IPI',
    iss: 'ISS',
    pis: 'PIS',
    cofins: 'COFINS',
    inss: 'INSS',
    irrf: 'IRRF',
    irpj: 'IRPJ',
    csll: 'CSLL',
    outros: '',
  };
  const id = resolveFiscalImpostoId(labels[impKey] ?? '');
  if (!id) return '';
  return contasParaImposto(fiscalContas, labels[impKey] ?? '').credito.trim();
}

function resolvePapelNoPlano(
  papel: ReceitaFederalLancamentoPapel,
  plano: ExtratoContaPlanoLike[],
  regra: ReceitaFederalRegra | null,
  fiscalMap: FiscalContaMap,
  fiscalContas: FiscalContasImpostoConfig,
  texto: string,
): string {
  const impKey = regra?.impostoKey ?? detectFiscalImpostoKey(texto);

  switch (papel) {
    case 'conta_imposto':
      return contaImpostoPassivo(impKey, fiscalMap, fiscalContas) ||
        pickConta(plano, (c) => {
          const g = c.group ?? derivePlanoGroupFromCode(c.code);
          return g === 'PASSIVO' && detectFiscalImpostoKey(c.name) === impKey;
        });

    case 'conta_folha':
      if (regra?.categoria === 'extrato_bancario') {
        const tokens = texto
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toUpperCase()
          .replace(/[^A-Z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((t) => t.length >= 4);
        const fornecedor = pickContaFornecedorExtrato(plano, texto.toUpperCase(), tokens);
        if (fornecedor) return fornecedor;
      }
      return pickConta(plano, (c) => {
        const g = c.group ?? derivePlanoGroupFromCode(c.code);
        const n = normNome(c.name);
        if (g !== 'PASSIVO') return false;
        if (/FORNECEDOR|DUPLICATA|OBRIGAC|SALARIO|FOLHA|PRO LABORE/.test(n)) return true;
        return regra?.categoria === 'obrigacao_folha' && /SALARIO|FOLHA|ENCARGO/.test(n);
      });

    case 'despesa_tributaria':
      if (regra?.id.includes('tarifa')) {
        return pickConta(plano, (c) => {
          const g = c.group ?? derivePlanoGroupFromCode(c.code);
          const n = normNome(c.name);
          return g === 'DESPESA' && /TARIFA|DESPESA FINANCEIRA|ENCARGO|SERVICO BANC/.test(n);
        });
      }
      return pickConta(plano, (c) => {
        const g = c.group ?? derivePlanoGroupFromCode(c.code);
        const n = normNome(c.name);
        return (
          g === 'DESPESA' &&
          (/IMPOSTO|TRIBUTO|TARIFA|ENCARGO|IRPJ|CSLL|PIS|COFINS|ICMS|ISS/.test(n) ||
            detectFiscalImpostoKey(n) === impKey)
        );
      });

    case 'despesa_encargo':
    case 'despesa_folha':
      return pickConta(plano, (c) => {
        const g = c.group ?? derivePlanoGroupFromCode(c.code);
        const n = normNome(c.name);
        return g === 'DESPESA' && /SALARIO|FOLHA|ENCARGO|PRO LABORE|INSS|FGTS/.test(n);
      });

    case 'contrapartida':
      if (regra?.categoria === 'extrato_bancario') {
        if (regra.id.includes('recebimento')) {
          return (
            pickConta(plano, (c) => {
              const g = c.group ?? derivePlanoGroupFromCode(c.code);
              const n = normNome(c.name);
              return (g === 'ATIVO' || g === 'PASSIVO') && /CLIENTE|DUPLICATA|RECEBIVEL/.test(n);
            }) ||
            pickConta(plano, (c) => {
              const g = c.group ?? derivePlanoGroupFromCode(c.code);
              return g === 'RECEITA' && /RECEITA|VENDA|SERVICO/.test(normNome(c.name));
            })
          );
        }
        if (regra.id.includes('fornecedor') || regra.id.includes('pagamento')) {
          const tokens = texto
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/[^A-Z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length >= 4);
          return pickContaFornecedorExtrato(plano, texto.toUpperCase(), tokens);
        }
      }
      return pickConta(plano, (c) => {
        const g = c.group ?? derivePlanoGroupFromCode(c.code);
        return g === 'PASSIVO' || g === 'DESPESA' || g === 'RECEITA';
      });

    case 'conta_alvo':
      return '';

    default:
      return '';
  }
}

/** Contrapartida contábil do extrato bancário conforme catálogo Receita Federal. */
export function resolveContrapartidaExtratoReceitaFederal(input: {
  description: string;
  nature: 'D' | 'C';
  plano: ExtratoContaPlanoLike[];
  rfStore: ReceitaFederalRegrasStore;
  fiscalMap?: FiscalContaMap;
  fiscalContas?: FiscalContasImpostoConfig;
}): ExtratoRfContrapartidaResult | null {
  const texto = input.description.trim();
  if (!texto || input.plano.length === 0) return null;

  const fiscalMap = input.fiscalMap ?? {};
  const fiscalContas = input.fiscalContas ?? emptyFiscalContasImposto();

  const regra = encontrarRegraReceitaFederalExtrato(texto, input.rfStore, input.nature);
  if (!regra) return null;

  const tpl =
    input.nature === 'D' ? regra.lancamentoDebitoLinha : regra.lancamentoCreditoLinha;
  if (!tpl) {
    if (regra.categoria === 'ativo_disponibilidade') return null;
    if (regra.grupoPlanoEsperado === '2' && input.nature === 'D') {
      const passivo = pickConta(input.plano, (c) => {
        const root = normCls(c.code)[0];
        return root === '2' && !isDisponibilidade(c);
      });
      if (passivo) {
        return { conta: passivo, regraId: regra.id, fundamentoLegal: regra.fundamentoLegal };
      }
    }
    return null;
  }

  const papelContra: ReceitaFederalLancamentoPapel =
    input.nature === 'D' ? tpl.debito : tpl.credito;

  const conta = resolvePapelNoPlano(
    papelContra,
    input.plano,
    regra,
    fiscalMap,
    fiscalContas,
    texto,
  ).trim();

  if (!conta || isDisponibilidade({ code: conta, name: '', tipo: 'A' })) return null;

  return {
    conta,
    regraId: regra.id,
    fundamentoLegal: regra.fundamentoLegal,
  };
}
