import React, { useEffect, useState } from 'react';
import { BANK_FORMATS, BankCode } from '../../lib/extratoParser/bankFormats';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';

interface LayoutSelectorProps {
  bankCode: BankCode;
  onSelect: (layoutId: string) => void;
  onBack: () => void;
  selectedLayout?: string;
  onBankChange?: (bankCode: BankCode) => void;
}

// Prints reais dos extratos (dados sensíveis já ocultos/borrados na própria imagem)
const LAYOUT_IMAGES: Record<string, string> = {
  bdb_padrao: '/extratos/bb_extrato_padrao.png',
  bdb_comprovante: '/extratos/bb_extrato_comprovante.png',
  itau_completo: '/extratos/itau_extrato_completo.png',
  sicredi_completo: '/extratos/sicredi_extrato_completo.png',
  sicredi_texto: '/extratos/sicredi_extrato_texto.png',
  nubank_completo: '/extratos/nubank_extrato_completo.png',
  wise_completo: '/extratos/wise_extrato_completo.png',
  inter_completo: '/extratos/inter_extrato_completo.png',
  santander_completo: '/extratos/santander_extrato_completo.png',
  infinitepay_movimentacoes: '/infinitepay-layout.svg',
  bradesco_netempresa: '/extratos/bradesco_netempresa.png',
  caixa_extrato_periodo: '/extratos/caixa_extrato_periodo.png',
  caixa_app_periodo: '/extratos/caixa_app_extrato_periodo.png',
  cresol_extrato_periodo: '/extratos/cresol_extrato_periodo.png',
};

export function LayoutSelector({
  bankCode,
  onSelect,
  onBack,
  selectedLayout,
  onBankChange,
}: LayoutSelectorProps) {
  const bank = BANK_FORMATS[bankCode];
  const total = bank.layouts.length;

  // Um layout por vez, sempre na largura inteira: o print precisa ficar grande
  // o bastante para dar para ler as colunas e comparar com o PDF em mãos.
  // Quando o banco tem mais de um layout, as setas passam de um para o outro.
  const [indice, setIndice] = useState(0);

  useEffect(() => {
    const jaEscolhido = bank.layouts.findIndex((l) => l.id === selectedLayout);
    setIndice(jaEscolhido >= 0 ? jaEscolhido : 0);
  }, [bankCode, selectedLayout, bank.layouts]);

  const layout = bank.layouts[Math.min(indice, total - 1)];
  const imageUrl = LAYOUT_IMAGES[layout.id];
  const isSelected = selectedLayout === layout.id;
  const irPara = (i: number) => setIndice((i + total) % total);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={onBack}
          className="technical-button text-[9px] px-2 py-1"
        >
          ← Voltar
        </button>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-[11px] font-bold uppercase tracking-wide">{bank.displayName}</h3>
        </div>
        <p className="text-[11px] text-brand-text/60">
          Escolha o layout que corresponde ao seu extrato bancário
        </p>
      </div>

      <div
        className={`border bg-white overflow-hidden ${
          isSelected
            ? 'border-brand-border shadow-[3px_3px_0_0_#141414]'
            : 'border-brand-border/60 hover:border-brand-border'
        }`}
      >
        {/* Imagem do extrato — a altura acompanha a proporção do próprio print
            (cada banco tem um formato: o da InfinitePay é bem mais alto que
            largo), então nada é cortado e o texto fica no maior tamanho que
            couber na largura do card. */}
        <div className="relative bg-brand-sidebar overflow-hidden border-b border-brand-border flex items-start justify-center">
          {imageUrl ? (
            // object-contain sempre: object-cover preenchia o quadro cortando
            // justamente as colunas que o usuário precisa ver.
            <img
              src={imageUrl}
              alt={layout.name}
              className="w-full h-auto max-h-[560px] object-top object-contain bg-white p-1"
            />
          ) : (
            <div className="w-full h-40 flex items-center justify-center text-[10px] text-brand-text/50 text-center px-2 uppercase tracking-wide">
              Prévia não disponível
            </div>
          )}

          {isSelected && (
            <div className="absolute top-2 right-2 w-5 h-5 border border-brand-border bg-brand-border flex items-center justify-center">
              <Check className="w-3.5 h-3.5 text-brand-bg" />
            </div>
          )}

          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => irPara(indice - 1)}
                title="Layout anterior"
                aria-label="Layout anterior"
                className="absolute left-2 top-1/2 -translate-y-1/2 border border-brand-border bg-brand-bg/90 p-1.5 hover:bg-brand-border hover:text-brand-bg"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => irPara(indice + 1)}
                title="Próximo layout"
                aria-label="Próximo layout"
                className="absolute right-2 top-1/2 -translate-y-1/2 border border-brand-border bg-brand-bg/90 p-1.5 hover:bg-brand-border hover:text-brand-bg"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 border border-brand-border bg-brand-bg/90 px-2 py-0.5 text-[9px] font-mono font-bold">
                {indice + 1} / {total}
              </div>
            </>
          )}
        </div>

        {/* Botão de seleção */}
        <button
          onClick={() => onSelect(layout.id)}
          className={`w-full py-2 text-[10px] font-bold uppercase tracking-wide transition-colors ${
            isSelected
              ? 'bg-brand-border text-brand-bg'
              : 'bg-brand-sidebar text-brand-text hover:bg-brand-border hover:text-brand-bg'
          }`}
        >
          {layout.name}
        </button>
      </div>
    </div>
  );
}
