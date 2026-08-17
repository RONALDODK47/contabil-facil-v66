import React from 'react';
import type { VisionBalanceteRow, VisionPlanoRow } from '../../extratoVision/types/accounting';
import { BalanceteComparativoMensal } from '../../extratoVision/components/BalanceteComparativoMensal';

export interface ContabilBalanceteComparativoProps {
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  onRazaoRowsChange: (rows: VisionBalanceteRow[]) => void;
  periodoDe: string;
  periodoAte: string;
  folhaRows?: VisionBalanceteRow[];
  fiscalRows?: VisionBalanceteRow[];
  empresaNome?: string;
  setPeriodToolbar?: (node: React.ReactNode | null) => void;
  docsImportadosCount?: number;
  onAbrirDocsImportados?: () => void;
  importedLogs?: string[];
  onAbrirLogs?: () => void;
}

/** Motor comparativo + automatização (lógica Extrato Vision) com visual ContabilFacil. */
export default function ContabilBalanceteComparativo(props: ContabilBalanceteComparativoProps) {
  return <BalanceteComparativoMensal {...props} surface="contabilfacil" />;
}
