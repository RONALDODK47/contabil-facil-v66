import { KeyRound } from 'lucide-react';

/** Mostrado no motor "OCR IA" quando ainda não há chave de API validada — nunca mostra a tela de
 * "carregando" nesse caso, porque a extração nem chega a começar. */
export function AIKeyRequiredView() {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-6">
      <div className="technical-panel px-8 py-10 flex flex-col items-center gap-3 max-w-md text-center">
        <KeyRound size={28} className="text-brand-text" />
        <p className="text-[11px] font-black uppercase tracking-wide">Chave de IA não configurada</p>
        <p className="text-[9px] text-brand-text/60">
          Configure e valide sua chave do Gemini em <strong>Custos &amp; Faturamento → Configuração IA</strong> antes
          de usar o OCR IA. Sem uma chave válida, a extração automática não roda.
        </p>
      </div>
    </div>
  );
}
