import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BANKS_LIST, BankCode } from '../../lib/extratoParser/bankFormats';
import { Search, X } from 'lucide-react';

interface BankSelectorProps {
  onSelect: (bankCode: BankCode) => void;
  selectedBank?: BankCode;
}

/** "Itaú Empresas" → "itau empresas": busca funciona com ou sem acento. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function BankSelector({ onSelect, selectedBank }: BankSelectorProps) {
  const [busca, setBusca] = useState('');
  const [destaque, setDestaque] = useState(0);
  const listaRef = useRef<HTMLDivElement>(null);

  const selectedBankData = selectedBank
    ? BANKS_LIST.find((b) => b.code === selectedBank)
    : null;

  const bancosFiltrados = useMemo(() => {
    const termo = normalizar(busca);
    if (!termo) return BANKS_LIST;
    // Busca por nome de exibição e por nome curto (ex.: "cef" não acha Caixa,
    // mas "caixa" acha tanto por name quanto por displayName).
    return BANKS_LIST.filter(
      (bank) =>
        normalizar(bank.displayName).includes(termo) || normalizar(bank.name).includes(termo)
    );
  }, [busca]);

  // Ao filtrar, o destaque volta para o primeiro resultado — senão o Enter
  // selecionaria um banco que nem está mais na lista.
  useEffect(() => {
    setDestaque(0);
  }, [busca]);

  // Mantém a opção destacada visível ao navegar com as setas.
  useEffect(() => {
    const item = listaRef.current?.querySelector<HTMLElement>(`[data-idx="${destaque}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [destaque]);

  const selecionar = (bankCode: BankCode) => {
    setBusca('');
    onSelect(bankCode);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDestaque((i) => Math.min(i + 1, bancosFiltrados.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDestaque((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const bank = bancosFiltrados[destaque];
      if (bank) selecionar(bank.code);
    } else if (e.key === 'Escape') {
      setBusca('');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-brand-text mb-1">
          Selecione o Banco
        </h3>
        <p className="text-[11px] text-brand-text/60">
          Escolha o banco emissor do extrato PDF que deseja converter
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-text/50 pointer-events-none" />
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pesquisar banco..."
          aria-label="Pesquisar banco"
          className="w-full pl-9 pr-9 py-2.5 border border-brand-border bg-white text-brand-text text-[11px] font-mono font-bold outline-none focus:bg-brand-sidebar/20"
        />
        {busca && (
          <button
            type="button"
            onClick={() => setBusca('')}
            title="Limpar busca"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-brand-text/50 hover:text-brand-text"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div
        ref={listaRef}
        className="border border-brand-border bg-white max-h-64 overflow-y-auto divide-y divide-brand-border/20"
      >
        {bancosFiltrados.length === 0 ? (
          <p className="px-3 py-3 text-[11px] font-mono text-brand-text/50">
            Nenhum banco encontrado para "{busca}".
          </p>
        ) : (
          bancosFiltrados.map((bank, idx) => {
            const isSelected = bank.code === selectedBank;
            const isDestaque = idx === destaque;
            return (
              <button
                key={bank.code}
                type="button"
                data-idx={idx}
                onMouseEnter={() => setDestaque(idx)}
                onClick={() => selecionar(bank.code)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[11px] font-mono transition-colors ${
                  isSelected
                    ? 'bg-brand-border text-brand-bg font-bold'
                    : isDestaque
                      ? 'bg-brand-sidebar text-brand-text'
                      : 'text-brand-text hover:bg-brand-sidebar'
                }`}
              >
                <span className="font-bold">{bank.displayName}</span>
                <span className={isSelected ? 'text-brand-bg/70' : 'text-brand-text/50'}>
                  {bank.layouts.length} layout{bank.layouts.length !== 1 ? 's' : ''}
                </span>
              </button>
            );
          })
        )}
      </div>

      {selectedBankData && (
        <div className="border border-brand-border bg-brand-sidebar px-3 py-2">
          <p className="text-[11px] text-brand-text">
            <span className="font-bold">{selectedBankData.displayName}</span> selecionado com sucesso
          </p>
        </div>
      )}
    </div>
  );
}
