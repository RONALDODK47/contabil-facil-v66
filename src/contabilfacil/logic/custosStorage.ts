import { readManagerData, writeManagerData } from './companyWorkspace';
import { montarLinhaTxtDominio } from '../../lib/dominioTxtLinha';
import { normalizeExtratoContaParaGravacao } from './planoContasMapper';
import { parseISO, isValid, format } from 'date-fns';

export interface CustoPlanoContaOption {
  code: string;
  name?: string;
  codigoReduzido?: string;
}

export interface CustoMensal {
  mes: string;
  faturamento: number;
  porcentagem?: number;
  contaDebitoCode?: string;
  contaCreditoCode?: string;
  descricao?: string;
}

export interface CustosData {
  custos: CustoMensal[];
  dataAtualizacao: string;
}

export function loadCustos(company: string): CustoMensal[] {
  const data = readManagerData<CustoMensal>(company, 'custos');
  return data || [];
}

export function saveCustos(company: string, custos: CustoMensal[]) {
  writeManagerData(company, 'custos', custos);
}

export function exportCustosParaPDF(custos: CustoMensal[]): string {
  const dataAtual = new Date().toLocaleDateString('pt-BR');
  let pdf = `RELATÓRIO DE CUSTOS E FATURAMENTO\nData: ${dataAtual}\n\n`;
  pdf += 'MÊS | FATURAMENTO | DESCRIÇÃO\n';
  pdf += '---|---|---\n';

  let totalFaturamento = 0;
  custos.forEach(c => {
    pdf += `${c.mes} | R$ ${c.faturamento.toFixed(2)} | ${c.descricao || '-'}\n`;
    totalFaturamento += c.faturamento;
  });

  pdf += `\nTOTAL: R$ ${totalFaturamento.toFixed(2)}\n`;
  return pdf;
}

function parseDateForDominio(dateStr: string): Date {
  // Aceita DD/MM/YYYY ou YYYY-MM
  const t = String(dateStr ?? '').trim();

  // Trata DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) {
    const [day, month, year] = t.split('/');
    return parseISO(`${year}-${month}-${day}`);
  }

  // Trata YYYY-MM (mês cheio)
  if (/^\d{4}-\d{2}$/.test(t)) {
    return parseISO(`${t}-01`);
  }

  return new Date();
}

/**
 * Resolve o código gravado (pode ser reduzido OU classificação legada salva antes da
 * troca para o ExtratoContaPicker) para o código reduzido CANÔNICO do plano — exatamente
 * o que está cadastrado no Domínio. Sem isso, contas salvas como classificação (com pontos)
 * eram exportadas com os dígitos concatenados, gerando um código inexistente no Domínio.
 */
function resolveContaParaExportacao(
  code: string | undefined,
  plano: CustoPlanoContaOption[],
): string {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  if (!plano.length) return raw.replace(/\D/g, '');
  const resolved = normalizeExtratoContaParaGravacao(raw, plano);
  return resolved || raw.replace(/\D/g, '');
}

export function buildTxtPlusFromCustos(
  custos: CustoMensal[],
  planoOptions: CustoPlanoContaOption[] = [],
): { content: string; naoExportados: { mes: string; descricao: string; motivo: string }[] } {
  const lines: string[] = [];
  const naoExportados: { mes: string; descricao: string; motivo: string }[] = [];

  for (const custo of custos) {
    const descricao = custo.descricao || 'CUSTO';

    if (!custo.contaDebitoCode || !custo.contaCreditoCode) {
      naoExportados.push({ mes: custo.mes, descricao, motivo: 'Conta Débito ou Crédito não preenchida' });
      continue;
    }

    // Calcula o custo (faturamento × porcentagem)
    const custocalculado = custo.porcentagem
      ? custo.faturamento * (custo.porcentagem / 100)
      : custo.faturamento;

    if (custocalculado <= 0) continue;

    const debConta = resolveContaParaExportacao(custo.contaDebitoCode, planoOptions);
    const credConta = resolveContaParaExportacao(custo.contaCreditoCode, planoOptions);

    if (!debConta || !credConta) {
      naoExportados.push({ mes: custo.mes, descricao, motivo: 'Conta não encontrada no plano de contas atual' });
      continue;
    }

    lines.push(
      montarLinhaTxtDominio({
        date: parseDateForDominio(custo.mes),
        debContaStr: debConta,
        credContaStr: credConta,
        value: custocalculado,
        historico: descricao.toUpperCase(),
      }),
    );
  }

  return { content: lines.join('\r\n'), naoExportados };
}
