import { Loader2 } from 'lucide-react';

type Props = {
  progressMsg: string;
  /** Título da tela de carregamento. Default: extração por IA. */
  title?: string;
  /** Mensagem padrão exibida quando progressMsg ainda está vazio. */
  fallbackMessage?: string;
};

/** Tela de carregamento durante a extração automática (IA ou motor local) — mesmo conceito
 * visual do software de referência (spinner + mensagem de progresso), redesenhada com bordas
 * quadradas e cores padrão do Contabil Fácil. Reaproveitada tanto pelo engine 'ia' quanto pelo
 * engine 'local' (OCR local + leitura nativa do PDF), só muda o título/mensagem. */
export function AIExtractLoadingView({
  progressMsg,
  title = 'Analisando documento com IA...',
  fallbackMessage = 'Isso pode levar alguns segundos dependendo do tamanho do PDF.',
}: Props) {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-6">
      <div className="technical-panel px-8 py-10 flex flex-col items-center gap-4 max-w-md text-center">
        <Loader2 size={36} className="animate-spin text-brand-text" />
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide">{title}</p>
          <p className="text-[9px] text-brand-text/60 mt-1">
            {progressMsg || fallbackMessage}
          </p>
        </div>
      </div>
    </div>
  );
}
