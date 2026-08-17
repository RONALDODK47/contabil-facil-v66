import { useEffect, useState } from 'react';
import { Plus, Pencil, Save, Trash2, MessageSquare } from 'lucide-react';
import { cn, formatDate } from '../lib/utils';
import {
  createRecadoPendenciaItem,
  loadRecadosPendencias,
  saveRecadosPendencias,
  type RecadoPendenciaCor,
  type RecadoPendenciaItem,
  type RecadoPendenciaTipo,
} from '../logic/recadosPendenciasStorage';

const CORES: { id: RecadoPendenciaCor; label: string; dot: string }[] = [
  { id: 'amarelo', label: 'Atenção', dot: 'bg-amber-400' },
  { id: 'vermelho', label: 'Urgente', dot: 'bg-red-600' },
  { id: 'verde', label: 'Resolvido', dot: 'bg-emerald-500' },
];

const TIPOS: RecadoPendenciaTipo[] = ['PENDENCIA', 'RECADO'];

function corInfo(cor: RecadoPendenciaCor) {
  return CORES.find((c) => c.id === cor) ?? CORES[0];
}

export default function RecadosPendenciasTab() {
  const [items, setItems] = useState<RecadoPendenciaItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const loaded = loadRecadosPendencias();
      setItems(Array.isArray(loaded) ? loaded : []);
    } catch (error) {
      console.error('Erro ao carregar recados/pendências:', error);
      setItems([]);
    }
    setEditingId(null);
  }, []);

  const persist = (next: RecadoPendenciaItem[]) => {
    setItems(next);
    saveRecadosPendencias(next);
  };

  const handleAdd = (tipo: RecadoPendenciaTipo) => {
    const novo = createRecadoPendenciaItem(tipo);
    persist([novo, ...items]);
    setEditingId(novo.id);
  };

  const handlePatch = (id: string, patch: Partial<RecadoPendenciaItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const handleSave = (id: string) => {
    const next = items.map((it) =>
      it.id === id ? { ...it, updatedAt: new Date().toISOString() } : it,
    );
    persist(next);
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('Excluir este card?')) return;
    persist(items.filter((it) => it.id !== id));
    if (editingId === id) setEditingId(null);
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-brand-sidebar/20 border border-brand-border text-xs space-y-2">
        <span className="font-bold uppercase tracking-widest">Recados & Pendências</span>
        <p className="opacity-60 text-[9px] leading-relaxed">
          Crie quantos cards precisar. Marque a cor conforme a prioridade: amarelo = atenção, vermelho = urgente,
          verde = resolvido.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {TIPOS.map((tipo) => (
            <button
              key={tipo}
              type="button"
              onClick={() => handleAdd(tipo)}
              className="technical-button-primary flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5"
            >
              <Plus size={12} />
              Novo {tipo === 'PENDENCIA' ? 'card de pendência' : 'card de recado'}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="border border-dashed border-brand-border p-8 text-center text-[10px] font-bold uppercase opacity-50 flex flex-col items-center gap-2">
          <MessageSquare size={20} />
          Nenhum recado ou pendência cadastrado.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((item) => {
            const editing = editingId === item.id;
            const cor = corInfo(item.cor);
            return (
              <div
                key={item.id}
                className="technical-panel w-full h-64 flex flex-col p-3 gap-2 shadow-[3px_3px_0_0_#141414] shrink-0"
              >
                <div className="flex items-start justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={cn(
                        'text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 border border-brand-border shrink-0',
                        item.tipo === 'PENDENCIA' ? 'bg-brand-border text-brand-bg' : 'bg-brand-bg',
                      )}
                    >
                      {item.tipo === 'PENDENCIA' ? 'Pendência' : 'Recado'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {CORES.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        title={c.label}
                        aria-label={`Marcar como ${c.label}`}
                        onClick={() => {
                          handlePatch(item.id, { cor: c.id });
                          if (!editing) {
                            persist(items.map((it) => (it.id === item.id ? { ...it, cor: c.id } : it)));
                          }
                        }}
                        className={cn(
                          'w-4 h-4 rounded-full border border-brand-border/60 transition-transform',
                          c.dot,
                          item.cor === c.id ? 'ring-2 ring-offset-1 ring-brand-border scale-110' : 'opacity-40 hover:opacity-80',
                        )}
                      />
                    ))}
                  </div>
                </div>

                {editing ? (
                  <input
                    type="text"
                    value={item.complemento}
                    onChange={(e) => handlePatch(item.id, { complemento: e.target.value })}
                    placeholder="Complemento do título (ex.: Enviar NF cliente X)"
                    aria-label="Complemento do título"
                    className="w-full h-[26px] border border-brand-border bg-white px-2 text-[11px] font-bold outline-none focus:bg-brand-sidebar/10 shrink-0"
                  />
                ) : (
                  <div className="text-[11px] font-bold leading-tight shrink-0 min-h-[14px] truncate" title={item.complemento}>
                    {item.complemento || <span className="opacity-40 font-normal">Sem título complementar</span>}
                  </div>
                )}

                {editing ? (
                  <textarea
                    value={item.texto}
                    onChange={(e) => handlePatch(item.id, { texto: e.target.value })}
                    placeholder="Descreva o recado ou pendência..."
                    aria-label="Texto do recado ou pendência"
                    className="flex-1 w-full border border-brand-border bg-white px-2 py-1.5 text-[10px] leading-relaxed outline-none focus:bg-brand-sidebar/10 resize-none overflow-y-auto"
                  />
                ) : (
                  <div className="flex-1 w-full border border-brand-border/30 bg-brand-sidebar/5 px-2 py-1.5 text-[10px] leading-relaxed overflow-y-auto whitespace-pre-wrap">
                    {item.texto || <span className="opacity-40">Sem conteúdo.</span>}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 shrink-0 pt-1 border-t border-brand-border/20">
                  <span className="text-[8px] font-mono opacity-45">
                    {formatDate(item.updatedAt) || formatDate(item.createdAt)}
                  </span>
                  <div className="flex items-center gap-1">
                    {editing ? (
                      <button
                        type="button"
                        onClick={() => handleSave(item.id)}
                        className="technical-button-primary flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1"
                      >
                        <Save size={11} />
                        Salvar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingId(item.id)}
                        className="technical-button flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1"
                      >
                        <Pencil size={11} />
                        Editar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      aria-label="Excluir card"
                      className="technical-button flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1 text-red-700"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
