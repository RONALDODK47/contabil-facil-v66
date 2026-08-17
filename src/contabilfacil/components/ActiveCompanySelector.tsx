import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ActiveCompanySelectorProps {
  selectedCompany: string;
  companyOptions: string[];
  onCompanyChange: (name: string) => void;
  onCreateCompany: (name: string) => string | null;
  onRenameCompany: (currentName: string, nextName: string) => boolean;
  onDeleteCompany?: (name: string) => boolean;
  /** Mensagem de confirmação ao excluir. */
  deleteConfirmMessage?: (companyName: string) => string;
  className?: string;
  /** Sidebar estreita — fonte um pouco menor. */
  compact?: boolean;
}

export function ActiveCompanySelector({
  selectedCompany,
  companyOptions,
  onCompanyChange,
  onCreateCompany,
  onRenameCompany,
  onDeleteCompany,
  deleteConfirmMessage,
  className,
  compact = false,
}: ActiveCompanySelectorProps) {
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [isEditingCompany, setIsEditingCompany] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState('');
  const [companySearch, setCompanySearch] = useState('');
  const companyMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!companyMenuOpen) setCompanySearch('');
  }, [companyMenuOpen]);

  const filteredCompanyOptions = useMemo(() => {
    const term = companySearch.trim().toUpperCase();
    if (!term) return companyOptions;
    return companyOptions.filter((company) => company.toUpperCase().includes(term));
  }, [companyOptions, companySearch]);

  useEffect(() => {
    setEditCompanyName(selectedCompany);
    setIsEditingCompany(false);
  }, [selectedCompany]);

  useEffect(() => {
    if (!companyMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (companyMenuRef.current && !companyMenuRef.current.contains(event.target as Node)) {
        setCompanyMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [companyMenuOpen]);

  return (
    <div className={cn('relative', className)} ref={companyMenuRef}>
      <span
        className={cn(
          'font-bold uppercase opacity-50 block mb-1',
          compact ? 'text-[8px] tracking-widest' : 'text-[10px]',
        )}
      >
        Empresa
      </span>
      {isEditingCompany ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            aria-label="Nome do sindicato"
            value={editCompanyName}
            onChange={(e) => setEditCompanyName(e.target.value.toUpperCase())}
            className={cn(
              'flex-1 min-w-0 px-2 py-1.5 border border-brand-border bg-white font-mono font-bold uppercase',
              compact ? 'text-[10px]' : 'text-xs',
            )}
            autoFocus
          />
          <button
            type="button"
            aria-label="Salvar nome do sindicato"
            onClick={() => {
              const ok = onRenameCompany(selectedCompany, editCompanyName.trim());
              if (ok) setIsEditingCompany(false);
            }}
            className="technical-button-primary p-1.5 shrink-0"
          >
            <Check size={12} />
          </button>
          <button
            type="button"
            aria-label="Cancelar edição"
            onClick={() => setIsEditingCompany(false)}
            className="technical-button p-1.5 shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCompanyMenuOpen((o) => !o)}
          className={cn(
            'w-full flex items-center justify-between px-2 py-1.5 border border-brand-border bg-brand-sidebar/30 text-left',
            compact ? 'text-[10px]' : 'text-xs',
          )}
        >
          <span className="font-mono font-bold truncate uppercase">
            {selectedCompany || 'SELECIONE…'}
          </span>
          <ChevronDown size={compact ? 12 : 14} className="opacity-60 shrink-0 ml-1" />
        </button>
      )}
      {companyMenuOpen && !isEditingCompany ? (
        <div className="absolute top-full left-0 right-0 mt-1 border border-brand-border bg-brand-bg shadow-[4px_4px_0_0_#141414] z-50 min-w-[12rem]">
          {companyOptions.length > 5 ? (
            <div className="p-2 border-b border-brand-border relative">
              <Search
                size={12}
                className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40 pointer-events-none"
              />
              <input
                type="text"
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="Pesquisar empresa..."
                aria-label="Pesquisar empresa"
                autoFocus
                className="w-full pl-6 pr-2 py-1.5 border border-brand-border text-[10px] font-mono uppercase outline-none focus:bg-brand-sidebar/10"
              />
            </div>
          ) : null}
          <div className="max-h-48 overflow-y-auto">
            {filteredCompanyOptions.length === 0 ? (
              <div className="px-3 py-3 text-center text-[10px] font-bold uppercase opacity-40">
                Nenhuma empresa encontrada
              </div>
            ) : null}
            {filteredCompanyOptions.map((company) => (
              <button
                key={company}
                type="button"
                onClick={() => {
                  onCompanyChange(company);
                  setCompanyMenuOpen(false);
                }}
                className={cn(
                  'w-full px-3 py-2 text-left font-mono font-bold border-b border-brand-border/10 hover:bg-brand-border hover:text-brand-bg uppercase',
                  compact ? 'text-[10px]' : 'text-[11px]',
                  company === selectedCompany && 'bg-brand-sidebar/40',
                )}
              >
                {company}
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-brand-border space-y-2">
            <input
              type="text"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value.toUpperCase())}
              placeholder="NOVO SINDICATO"
              className="w-full px-2 py-1.5 border border-brand-border text-[10px] font-mono uppercase"
            />
            <button
              type="button"
              onClick={() => {
                const c = onCreateCompany(newCompanyName);
                if (c) {
                  setNewCompanyName('');
                  setCompanyMenuOpen(false);
                }
              }}
              className="technical-button-primary w-full flex items-center justify-center gap-1 text-[10px]"
            >
              <Plus size={12} />
              CRIAR
            </button>
            {selectedCompany && onDeleteCompany ? (
              <button
                type="button"
                onClick={() => {
                  const message =
                    deleteConfirmMessage?.(selectedCompany) ??
                    `Excluir «${selectedCompany}»?`;
                  if (!confirm(message)) return;
                  if (onDeleteCompany(selectedCompany)) {
                    setCompanyMenuOpen(false);
                  }
                }}
                className="technical-button w-full flex items-center justify-center gap-1 text-[10px] text-red-800 border-red-300 hover:bg-red-50"
              >
                <Trash2 size={12} />
                EXCLUIR
              </button>
            ) : null}
            {selectedCompany ? (
              <button
                type="button"
                onClick={() => {
                  setIsEditingCompany(true);
                  setCompanyMenuOpen(false);
                }}
                className="technical-button w-full flex items-center justify-center gap-1 text-[10px]"
              >
                <Pencil size={12} />
                RENOMEAR
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
