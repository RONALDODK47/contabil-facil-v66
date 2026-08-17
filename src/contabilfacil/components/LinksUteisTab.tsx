import { useEffect, useState } from 'react';
import { Plus, Pencil, Save, Trash2, ExternalLink, Link2 } from 'lucide-react';
import { CF_FORM_INPUT_LONG, CF_FORM_INPUT_MED, CF_LABEL, CF_FIELD_COL } from '../lib/formFieldClasses';
import {
  createLinkUtilItem,
  loadLinksUteis,
  normalizeLinkUrl,
  saveLinksUteis,
  type LinkUtilItem,
} from '../logic/linksUteisStorage';

export default function LinksUteisTab() {
  const [items, setItems] = useState<LinkUtilItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const loaded = loadLinksUteis();
      setItems(Array.isArray(loaded) ? loaded : []);
    } catch (error) {
      console.error('Erro ao carregar links úteis:', error);
      setItems([]);
    }
    setEditingId(null);
  }, []);

  const persist = (next: LinkUtilItem[]) => {
    setItems(next);
    saveLinksUteis(next);
  };

  const handleAdd = () => {
    const novo = createLinkUtilItem();
    persist([novo, ...items]);
    setEditingId(novo.id);
  };

  const handlePatch = (id: string, patch: Partial<LinkUtilItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const handleSave = (id: string) => {
    try {
      const next = items.map((it) =>
        it.id === id
          ? { ...it, url: normalizeLinkUrl(it.url ?? ''), updatedAt: new Date().toISOString() }
          : it,
      );
      persist(next);
      setEditingId(null);
    } catch (error) {
      console.error('Erro ao salvar link:', error);
    }
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('Excluir este link?')) return;
    persist(items.filter((it) => it.id !== id));
    if (editingId === id) setEditingId(null);
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-brand-sidebar/20 border border-brand-border text-xs space-y-2">
        <span className="font-bold uppercase tracking-widest">Links Úteis</span>
        <p className="opacity-60 text-[9px] leading-relaxed">
          Cadastre a descrição do link e o endereço correspondente para acesso rápido.
        </p>
        <button
          type="button"
          onClick={handleAdd}
          className="technical-button-primary flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5"
        >
          <Plus size={12} />
          Novo link
        </button>
      </div>

      {items.length === 0 ? (
        <div className="border border-dashed border-brand-border p-8 text-center text-[10px] font-bold uppercase opacity-50 flex flex-col items-center gap-2">
          <Link2 size={20} />
          Nenhum link cadastrado.
        </div>
      ) : (
        <div className="technical-panel divide-y divide-brand-border/30">
          {items.map((item) => {
            const editing = editingId === item.id;
            return (
              <div key={item.id} className="p-3 flex flex-col gap-2">
                {editing ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className={CF_FIELD_COL}>
                      <label htmlFor={`link-desc-${item.id}`} className={CF_LABEL}>
                        Descrição
                      </label>
                      <input
                        id={`link-desc-${item.id}`}
                        aria-label="Descrição do link"
                        className={CF_FORM_INPUT_MED}
                        value={item.descricao}
                        onChange={(e) => handlePatch(item.id, { descricao: e.target.value })}
                        placeholder="Ex.: Portal e-CAC"
                      />
                    </div>
                    <div className={CF_FIELD_COL}>
                      <label htmlFor={`link-url-${item.id}`} className={CF_LABEL}>
                        Link
                      </label>
                      <input
                        id={`link-url-${item.id}`}
                        aria-label="Endereço do link"
                        className={CF_FORM_INPUT_LONG}
                        value={item.url}
                        onChange={(e) => handlePatch(item.id, { url: e.target.value })}
                        placeholder="https://..."
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSave(item.id)}
                      className="technical-button-primary flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1.5"
                    >
                      <Save size={11} />
                      Salvar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      aria-label="Excluir link"
                      className="technical-button flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1.5 text-red-700"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold truncate">
                        {item.descricao || <span className="opacity-40 font-normal">Sem descrição</span>}
                      </div>
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[9px] font-mono text-blue-700 hover:underline flex items-center gap-1 truncate"
                        >
                          <ExternalLink size={10} />
                          {item.url}
                        </a>
                      ) : (
                        <span className="text-[9px] font-mono opacity-40">Sem link</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditingId(item.id)}
                        className="technical-button flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1"
                      >
                        <Pencil size={11} />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        aria-label="Excluir link"
                        className="technical-button flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1 text-red-700"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
