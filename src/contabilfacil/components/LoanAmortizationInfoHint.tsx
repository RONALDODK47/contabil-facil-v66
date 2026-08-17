import { useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '../lib/utils';
import PricingInfoModal from './pricing/PricingInfoModal';

const AMORTIZATION_HELP_BODY = [
  '**Amortização ≠ parcela líquida**',
  '• **Amortização:** abatimento de capital (coluna Amortização na tabela).',
  '• **Parcela líquida:** amortização + juros + custos do período.',
  'No SAC a amortização pode ser **constante** e a parcela líquida **ainda diminui** mês a mês, porque os juros caem com o saldo.',
  '',
  '**SAC — ajuste pelos parâmetros**',
  'Use **Base amortização SAC**, **Juros SAC**, **Arredondamento** e **Pró-rata** até a tabela coincidir com o carnê do contrato (qualquer instituição).',
  '',
  '**Base amortização SAC**',
  '• **Saldo após carência ÷ parcelas:** amortização = saldo na 1ª parcela pós-carência ÷ parcelas restantes (inclui juros capitalizados na carência).',
  '• **Principal do contrato ÷ parcelas:** amortização = valor financiado do contrato ÷ prazo de amortização; juros continuam sobre o saldo devedor de cada mês.',
  '',
  '**PRONAMPE (Banco do Brasil)**',
  'Com carência capitalizada, o BB costuma manter amortização fixa sobre o **principal original** (ex.: 150.000 ÷ 37 ≈ 4.054,05), não sobre o saldo incorporado. Com Selic Over / PRONAMPE, selecione **Principal do contrato ÷ parcelas** em **Base amortização SAC**.',
  '',
  '**PRICE**',
  '• Prestação fixa via PMT (taxa do período + número de parcelas), não divisão simples do principal.',
  '• Com carência capitalizada, combine com as opções de recálculo e preservação de prestação do painel.',
].join('\n');

/**
 * Botão (i) no padrão Contábil Fácil (borda brand + modal técnico).
 * Explica SAC × PRICE e por que não dividir só o principal pelo prazo.
 */
export function LoanAmortizationInfoHint() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'h-7 w-7 shrink-0 border border-brand-border flex items-center justify-center text-brand-text',
          open ? 'bg-brand-border text-brand-bg' : 'bg-transparent hover:bg-brand-sidebar/20',
        )}
        title="SAC, PRICE e amortização com carência"
        aria-label="SAC, PRICE e amortização com carência"
        aria-haspopup="dialog"
      >
        <Info size={12} strokeWidth={2.25} aria-hidden />
      </button>
      <PricingInfoModal
        open={open}
        title="Amortização SAC e PRICE"
        body={AMORTIZATION_HELP_BODY}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
