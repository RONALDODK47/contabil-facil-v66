import { useMemo, useState } from 'react';
import {
  PLANO_GROUP_LABELS,
  type PlanoGroup,
  derivePlanoGroupFromCode,
  gerarProximaClassificacaoDoGrupo,
  gerarProximaClassificacaoSobPai,
  sanitizeCodigoReduzido,
} from '../logic/planoContasMapper';

export type ContaPendenteRenomear = {
  code: string;
  name: string;
  codigoReduzido?: string;
  group?: PlanoGroup;
};

type PlanoRef = {
  code: string;
  name?: string;
  group?: string;
  tipo?: string;
};

const GROUPS = Object.keys(PLANO_GROUP_LABELS) as PlanoGroup[];

function initialClassificacao(conta: ContaPendenteRenomear): string {
  const code = (conta.code || '').trim();
  if (/^\d+(\.\d+)+$/.test(code)) return code;
  return '';
}

function initialGroup(conta: ContaPendenteRenomear): PlanoGroup | '' {
  if (conta.group) return conta.group;
  const cls = initialClassificacao(conta);
  if (cls) return derivePlanoGroupFromCode(cls);
  return '';
}

function displayReduzido(conta: ContaPendenteRenomear): string {
  return (
    sanitizeCodigoReduzido(conta.codigoReduzido) ||
    sanitizeCodigoReduzido(conta.code) ||
    conta.code
  );
}

export type ContaPendenteRenomearRowProps = {
  conta: ContaPendenteRenomear;
  planoContas: PlanoRef[];
  onConfirm: (payload: {
    contaKey: string;
    nome: string;
    classificacao: string;
    group: PlanoGroup;
  }) => void;
};

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Selecionar…',
}: {
  options: Array<{ value: string; label: string; searchKey: string }>;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = options.filter((o) =>
    o.searchKey.toLowerCase().includes(search.toLowerCase())
  );
  const selectedOpt = options.find((o) => o.value === value);

  return (
    <div className="relative w-full text-[10px] font-mono">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full h-8 border border-brand-border bg-brand-bg px-2 text-left truncate hover:bg-brand-sidebar/20 focus:outline-none focus:ring-1 focus:ring-brand-primary/50 flex justify-between items-center"
      >
        <span className="truncate">{selectedOpt ? selectedOpt.label : placeholder}</span>
        <span className="opacity-50 text-[8px]">▼</span>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute z-50 mt-1 w-full max-w-sm max-h-64 flex flex-col bg-brand-bg border border-brand-border shadow-xl shadow-black/50 overflow-hidden">
            <div className="p-1 border-b border-brand-border/50 shrink-0 bg-brand-sidebar/30">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-brand-bg border border-brand-border px-2 py-1.5 outline-none text-[10px] placeholder-brand-primary/30"
                placeholder="Pesquisar conta..."
              />
            </div>
            <div className="overflow-auto flex-1 p-1">
              {filtered.length === 0 ? (
                <div className="p-2 opacity-50 text-center">Nenhuma conta encontrada</div>
              ) : (
                filtered.map((opt) => (
                  <div
                    key={opt.value}
                    className={`p-1.5 px-2 cursor-pointer truncate rounded-sm hover:bg-brand-primary/20 ${
                      value === opt.value ? 'bg-brand-primary/30 text-brand-primary font-bold' : ''
                    }`}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    {opt.label}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function ContaPendenteRenomearRow({
  conta,
  planoContas,
  onConfirm,
}: ContaPendenteRenomearRowProps) {
  const contaKey = conta.code;
  const reduzido = useMemo(() => displayReduzido(conta), [conta]);
  const [nome, setNome] = useState(() => {
    const n = (conta.name || '').trim();
    return /^CONTA NOVA\s*[—-]/i.test(n) ? '' : n;
  });
  const [classificacao, setClassificacao] = useState(() => initialClassificacao(conta));
  const [group, setGroup] = useState<PlanoGroup | ''>(() => initialGroup(conta));
  const [parentAccount, setParentAccount] = useState<string>('');

  const syntheticOptions = useMemo(() => {
    return planoContas
      .filter((p) => p.tipo === 'S' || (!p.tipo && p.code.split('.').length <= 3))
      .map((p) => {
        const label = `${p.code} - ${p.name || 'Conta Sintética'}`;
        return {
          value: p.code,
          label: label,
          searchKey: label,
        };
      });
  }, [planoContas]);

  const handleParentChange = (parentCode: string) => {
    setParentAccount(parentCode);
    if (!parentCode) return;
    setGroup(derivePlanoGroupFromCode(parentCode));
    const planoSemEsta = planoContas.filter((p) => p.code !== contaKey);
    setClassificacao(gerarProximaClassificacaoSobPai(planoSemEsta, parentCode));
  };

  const handleSalvar = () => {
    const g = group || (classificacao.trim() ? derivePlanoGroupFromCode(classificacao) : '');
    if (!nome.trim()) {
      window.alert('Informe o nome correto da conta.');
      return;
    }
    if (!classificacao.trim() || !g) {
      window.alert('Informe uma classificação válida ou escolha o grupo de contas.');
      return;
    }
    onConfirm({
      contaKey,
      nome,
      classificacao,
      group: g,
    });
  };

  return (
    <div className="p-2.5 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="shrink-0">
          <label className="block text-[8px] font-bold uppercase opacity-50 mb-0.5">Reduzido</label>
          <span className="inline-flex h-8 items-center text-[10px] font-mono font-bold min-w-[5.5rem]">
            {reduzido}
          </span>
        </div>
        <div className="w-56 shrink-0 z-20">
          <label className="block text-[8px] font-bold uppercase opacity-50 mb-0.5">
            Conta Sintética (Pai)
          </label>
          <SearchableSelect
            options={syntheticOptions}
            value={parentAccount}
            onChange={handleParentChange}
            placeholder="Escolha a conta sintética..."
          />
        </div>
        <div className="flex-1 min-w-[10rem]">
          <label className="block text-[8px] font-bold uppercase opacity-50 mb-0.5">
            Classificação
          </label>
          <input
            type="text"
            aria-label="Classificação"
            value={classificacao}
            onChange={(e) => {
              const v = e.target.value.trim();
              setClassificacao(e.target.value);
              if (/^\d+(\.\d+)+$/.test(v)) {
                setGroup(derivePlanoGroupFromCode(v));
              }
            }}
            placeholder="1.1.1.01.00001"
            className="w-full h-8 border border-brand-border bg-brand-bg px-2 text-[10px] font-mono"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-[8px] font-bold uppercase opacity-50 mb-0.5">
            Nome da conta
          </label>
          <input
            type="text"
            aria-label="Nome da conta"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSalvar();
            }}
            placeholder="Nome correto da conta..."
            className="w-full h-8 border border-brand-border bg-brand-bg px-2 text-[10px] font-mono"
          />
        </div>
        <button
          type="button"
          onClick={handleSalvar}
          className="technical-button-primary text-[9px] px-3 h-8"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}
