export type AiOcrDocumentType =
  | 'extrato'
  | 'parcelamento'
  | 'plano_contas'
  | 'balancete'
  | 'folha'
  | 'generic';

export const AI_OCR_DOC_LABELS: Record<AiOcrDocumentType, string> = {
  extrato: 'extrato bancário brasileiro',
  parcelamento: 'cronograma de parcelamento / dívidas',
  plano_contas: 'plano de contas contábil',
  balancete: 'balancete contábil',
  folha: 'folha de pagamento / holerite',
  generic: 'documento contábil/financeiro',
};
