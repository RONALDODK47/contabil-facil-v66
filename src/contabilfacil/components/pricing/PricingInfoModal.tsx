import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface PricingInfoModalProps {
  open: boolean;
  title: string;
  body: string;
  onClose: () => void;
}

function renderMarkdownish(text: string) {
  return text.split('\n').map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={i} className="h-2" />;
    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      return (
        <p key={i} className="text-[11px] font-black uppercase tracking-wide mt-3 mb-1">
          {trimmed.slice(2, -2)}
        </p>
      );
    }
    if (trimmed.startsWith('• ')) {
      return (
        <p key={i} className="text-[10px] leading-relaxed pl-3 border-l-2 border-brand-border/30 ml-1">
          {trimmed.slice(2)}
        </p>
      );
    }
    return (
      <p key={i} className="text-[10px] leading-relaxed opacity-90">
        {trimmed}
      </p>
    );
  });
}

export default function PricingInfoModal({ open, title, body, onClose }: PricingInfoModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className={cn(
          'technical-panel max-w-lg w-full max-h-[80vh] overflow-auto shadow-[8px_8px_0_0_#141414] bg-brand-bg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-brand-border bg-brand-sidebar/30">
          <h3 className="text-sm font-black uppercase tracking-widest">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 border border-brand-border hover:bg-brand-sidebar/50">
            <X size={14} />
          </button>
        </div>
        <div className="p-5 space-y-1">{renderMarkdownish(body)}</div>
      </div>
    </div>
  );
}
