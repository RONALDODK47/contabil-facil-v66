import type { GenericOcrRow } from '../parcelamentoColunasExtract';
import { inferPlanoTipoSa } from '../../contabilfacil/logic/planoContasMapper';
import {
  parseDataFlexivel,
  parseMoedaPt,
  type ParcelamentoColunaImportId,
  type ParcelamentoPlanilhaImport,
  type ParcelaPlanilhaRow,
} from '../parcelamentoPlanilha';
import type { ExtractedRow, GenericExtractedRow } from './types';

/** Preenche coluna Tipo (S/A) nas linhas do plano quando o PDF Domínio deixa analíticas em branco. */
export function applyPlanoTipoInferenceToRows(rows: GenericExtractedRow[]): GenericExtractedRow[] {
  return rows.map((row) => {
    const tipoAtual = (row.fields.tipo ?? '').trim().toUpperCase();
    if (tipoAtual === 'S' || tipoAtual === 'A') return row;
    if (tipoAtual.startsWith('SINT')) {
      return { ...row, fields: { ...row.fields, tipo: 'S' } };
    }
    if (tipoAtual.startsWith('ANAL')) {
      return { ...row, fields: { ...row.fields, tipo: 'A' } };
    }

    const code = (
      row.fields.codigoClassificacao ||
      row.fields.classificacao ||
      row.fields.codigoConta ||
      ''
    )
      .trim()
      .replace(/\s/g, '');
    const codigoReduzido = row.fields.codigoReduzido?.trim();
    const nivelRaw = row.fields.nivel?.trim();
    const nivel = nivelRaw && /^[1-6]$/.test(nivelRaw) ? parseInt(nivelRaw, 10) : undefined;

    if (!code) return row;

    const tipo = inferPlanoTipoSa({ code, codigoReduzido, nivel, tipoHint: tipoAtual });
    return { ...row, fields: { ...row.fields, tipo } };
  });
}

/**
 * Campos que NÃO são coluna do PDF, mas que o parser de linha enxerta na linha
 * a partir do cabeçalho do bloco ("Conta: 1065 - 1.1.1.02.00003 BANCO SICREDI").
 *
 * `columnIds` só lista as colunas visuais recortadas do documento, então esses
 * campos derivados eram descartados aqui. No razão do Domínio isso significava
 * perder o código REDUZIDO da conta do lançamento: a linha chegava no razão só
 * com a contrapartida (`contaContrapartida`) e sem o próprio lado, e o export
 * TXT+ Domínio — que exige conta de débito E de crédito — não achava nenhuma
 * partida dobrada válida ("Nenhuma partida dobrada válida entre X e Y").
 */
const CAMPOS_DERIVADOS_DA_LINHA = ['codigo', 'classificacao'] as const;

export function mapGenericRowsToOcrRows(
  rows: GenericExtractedRow[],
  columnIds: string[],
): GenericOcrRow[] {
  return rows.map((row, idx) => {
    const out: GenericOcrRow = {
      _extratoOrdem: String(idx + 1),
      _pagina: row.pageNumber != null ? String(row.pageNumber) : '',
      _linhaOcr:
        row.fields._linhaOcr?.trim() ||
        columnIds.map((id) => row.fields[id] || '').filter(Boolean).join(' '),
    };
    for (const id of columnIds) {
      out[id] = row.fields[id] || '';
    }
    // Só preenche o que a coluna mapeada não trouxe — a coluna do documento,
    // quando existe, continua mandando.
    for (const id of CAMPOS_DERIVADOS_DA_LINHA) {
      if (out[id]?.trim()) continue;
      const derivado = row.fields[id]?.trim();
      if (derivado) out[id] = derivado;
    }
    return out;
  });
}

function field(row: GenericExtractedRow, ...ids: string[]): string {
  for (const id of ids) {
    const v = row.fields[id];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

export function mapGenericRowsToParcelamento(rows: GenericExtractedRow[]): ParcelamentoPlanilhaImport {
  const colunasMapeadas = new Set<ParcelamentoColunaImportId>();
  const linhas: ParcelaPlanilhaRow[] = [];

  rows.forEach((row, idx) => {
    const nRaw = field(row, 'numero', 'n', 'parcela');
    const n = Number(String(nRaw).replace(/\D/g, '')) || idx + 1;
    const date =
      parseDataFlexivel(field(row, 'vencimento', 'data', 'date')) ?? new Date(NaN);
    const valor = parseMoedaPt(field(row, 'valor', 'principal'));
    const pagamentoRaw = field(row, 'pagamento');
    const pagamento = pagamentoRaw ? parseMoedaPt(pagamentoRaw) : undefined;
    const juros = parseMoedaPt(field(row, 'juros'));
    const multa = parseMoedaPt(field(row, 'multa'));
    const encargos = parseMoedaPt(field(row, 'encargos', 'encargosHonorarios'));
    const honorarios = parseMoedaPt(field(row, 'honorarios'));
    const contaDebito = field(row, 'contaDebito', 'debito').replace(/\D/g, '');
    const contaCredito = field(row, 'contaCredito', 'credito').replace(/\D/g, '');

    if (field(row, 'numero', 'n', 'parcela')) colunasMapeadas.add('numero');
    if (field(row, 'vencimento', 'data', 'date')) colunasMapeadas.add('vencimento');
    if (field(row, 'valor', 'principal')) colunasMapeadas.add('valor');
    if (pagamentoRaw) colunasMapeadas.add('pagamento');
    if (field(row, 'juros')) colunasMapeadas.add('juros');
    if (field(row, 'multa')) colunasMapeadas.add('multa');
    if (field(row, 'encargos')) colunasMapeadas.add('encargos');
    if (field(row, 'honorarios')) colunasMapeadas.add('honorarios');
    if (field(row, 'encargosHonorarios')) colunasMapeadas.add('encargosHonorarios');

    linhas.push({
      n,
      date,
      valor,
      juros,
      multa,
      pagamento: pagamento != null && pagamento > 0 ? pagamento : undefined,
      encargos,
      honorarios,
      contaDebito,
      contaCredito,
    });
  });

  return {
    nomeParcelamento: '',
    clienteNome: '',
    numeroParcelamento: '',
    linhas,
    colunasMapeadas: [...colunasMapeadas],
    calcularJurosPorPagamento: colunasMapeadas.has('pagamento'),
  };
}

export function genericToExtratoRow(row: GenericExtractedRow): ExtractedRow {
  const valueText = row.fields.value || row.fields.valorMisto || row.fields.valor || '';
  return {
    id: row.id,
    dateText: row.fields.date || row.fields.data || '',
    historyText: row.fields.history || row.fields.descricao || '',
    valueText,
    dateCropUrl: row.cropUrls.date || row.cropUrls.data || '',
    historyCropUrl: row.cropUrls.history || row.cropUrls.descricao || '',
    valueCropUrl: row.cropUrls.value || row.cropUrls.valorMisto || row.cropUrls.valor || '',
    isNegative: false,
    parsedValue: null,
    y: row.y,
    height: row.height,
    pageNumber: row.pageNumber,
  };
}
