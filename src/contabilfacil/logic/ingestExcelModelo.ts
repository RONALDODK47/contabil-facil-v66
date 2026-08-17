import { downloadParcelamentoPlanilhaModelo } from '../../lib/parcelamentoPlanilha';
import {
  downloadAplicacoesModelo,
  downloadEmprestimosModelo,
  downloadExtratoModelo,
  downloadPlanoContasModelo,
  downloadRazaoModelo,
} from '../../extratoVision/utils/planilhaModelo';
import type { DataIngestionType } from './ocrColunasConfig';

/** Módulos com importação Excel estruturada (planilha modelo). */
export const EXCEL_IMPORT_DATA_TYPES: DataIngestionType[] = [
  'extrato',
  'plano',
  'balancete',
  'installments',
  'loans',
  'apps',
];

export function dataTypeSupportsExcelImport(dataType: string): dataType is DataIngestionType {
  return (EXCEL_IMPORT_DATA_TYPES as string[]).includes(dataType);
}

export function downloadExcelModeloForDataType(dataType: DataIngestionType): void {
  switch (dataType) {
    case 'plano':
      downloadPlanoContasModelo();
      return;
    case 'balancete':
      downloadRazaoModelo();
      return;
    case 'extrato':
      downloadExtratoModelo();
      return;
    case 'installments':
      downloadParcelamentoPlanilhaModelo();
      return;
    case 'loans':
      downloadEmprestimosModelo();
      return;
    case 'apps':
      downloadAplicacoesModelo();
      return;
    default:
      throw new Error('Este módulo não possui planilha modelo Excel.');
  }
}

export function excelModeloFilenameForDataType(dataType: DataIngestionType): string {
  switch (dataType) {
    case 'plano':
      return 'modelo_plano_contas.xlsx';
    case 'balancete':
      return 'modelo_razao.xlsx';
    case 'extrato':
      return 'modelo_extrato.xlsx';
    case 'installments':
      return 'parcelamento_modelo.xlsx';
    case 'loans':
      return 'modelo_emprestimos.xlsx';
    case 'apps':
      return 'modelo_aplicacoes.xlsx';
    default:
      return 'modelo.xlsx';
  }
}
