import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Save, Trash2, X, Settings, LayoutGrid, CalendarRange, Search } from 'lucide-react';
import { cn, formatDate } from '../lib/utils';
import { CF_FIELD_COL, CF_FORM_INPUT_DATE, CF_FORM_INPUT_MED, CF_LABEL } from '../lib/formFieldClasses';
import {
  createTarefaColuna,
  createTarefaItem,
  loadGestaoTarefas,
  saveGestaoTarefas,
  type GestaoTarefasBoard,
  type TarefaColuna,
} from '../logic/gestaoTarefasStorage';

const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase();
}

export default function GestaoTarefasTab() {
  const [board, setBoard] = useState<GestaoTarefasBoard>({ colunas: [], tarefas: [] });
  const [configOpen, setConfigOpen] = useState(false);
  const [novaColuna, setNovaColuna] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [dataErrorId, setDataErrorId] = useState<string | null>(null);
  const [filtroDe, setFiltroDe] = useState('');
  const [filtroAte, setFiltroAte] = useState('');
  const [filtroHistorico, setFiltroHistorico] = useState('');

  useEffect(() => {
    try {
      setBoard(loadGestaoTarefas());
      setEditingTaskId(null);
      setDataErrorId(null);
      setConfigOpen(false);
      setFiltroDe('');
      setFiltroAte('');
      setFiltroHistorico('');
    } catch (error) {
      console.error('Erro ao carregar gestão de tarefas:', error);
      // Fallback para board vazio com colunas padrão
      setBoard({
        colunas: [
          { id: crypto.randomUUID(), nome: 'A Fazer' },
          { id: crypto.randomUUID(), nome: 'Em Andamento' },
          { id: crypto.randomUUID(), nome: 'Concluído' },
        ],
        tarefas: [],
      });
    }
  }, []);

  const persist = (next: GestaoTarefasBoard) => {
    try {
      setBoard(next);
      saveGestaoTarefas(next);
    } catch (error) {
      console.error('Erro ao salvar gestão de tarefas:', error);
      // Pelo menos atualiza o estado local
      setBoard(next);
    }
  };

  const handleAddColuna = () => {
    const nome = novaColuna.trim();
    if (!nome) return;
    persist({ ...board, colunas: [...board.colunas, createTarefaColuna(nome)] });
    setNovaColuna('');
  };

  const handleRenameColuna = (id: string, nome: string) => {
    setBoard((prev) => ({
      ...prev,
      colunas: prev.colunas.map((c) => (c.id === id ? { ...c, nome } : c)),
    }));
  };

  const handleColunaBlur = () => {
    saveGestaoTarefas(board);
  };

  const handleDeleteColuna = (col: TarefaColuna) => {
    const temTarefas = board.tarefas.some((t) => t.colunaId === col.id);
    if (temTarefas && !window.confirm(`A coluna "${col.nome}" possui tarefas. Excluir a coluna e todas as tarefas dela?`)) {
      return;
    }
    persist({
      colunas: board.colunas.filter((c) => c.id !== col.id),
      tarefas: board.tarefas.filter((t) => t.colunaId !== col.id),
    });
  };

  const handleAddTarefa = (colunaId: string) => {
    const nova = createTarefaItem(colunaId);
    persist({ ...board, tarefas: [nova, ...board.tarefas] });
    setEditingTaskId(nova.id);
    setDataErrorId(null);
  };

  const handlePatchTarefa = (id: string, patch: Partial<GestaoTarefasBoard['tarefas'][number]>) => {
    setBoard((prev) => ({
      ...prev,
      tarefas: prev.tarefas.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
    if ('data' in patch && patch.data?.trim()) setDataErrorId(null);
  };

  const handleSaveTarefa = (id: string) => {
    const tarefa = board.tarefas.find((t) => t.id === id);
    if (!tarefa?.data?.trim()) {
      setDataErrorId(id);
      return;
    }
    setDataErrorId(null);
    saveGestaoTarefas(board);
    setEditingTaskId(null);
  };

  const handleDeleteTarefa = (id: string) => {
    if (!window.confirm('Excluir esta tarefa?')) return;
    persist({ ...board, tarefas: board.tarefas.filter((t) => t.id !== id) });
    if (editingTaskId === id) setEditingTaskId(null);
    if (dataErrorId === id) setDataErrorId(null);
  };

  const handleMoveTarefa = (id: string, colunaId: string) => {
    persist({ ...board, tarefas: board.tarefas.map((t) => (t.id === id ? { ...t, colunaId } : t)) });
  };

  const tarefasFiltradas = useMemo(() => {
    try {
      const termo = normalizeSearch(filtroHistorico.trim());
      const tarefas = Array.isArray(board?.tarefas) ? board.tarefas : [];
      return tarefas.filter((t) => {
        if (!t || typeof t !== 'object') return false;
        const dataTarefa = (t.data ?? '') || (t.createdAt?.slice(0, 10) ?? '');
        if (filtroDe && dataTarefa < filtroDe) return false;
        if (filtroAte && dataTarefa > filtroAte) return false;
        if (termo) {
          const titulo = String(t.titulo ?? '');
          const descricao = String(t.descricao ?? '');
          const alvo = normalizeSearch(`${titulo} ${descricao}`);
          if (!alvo.includes(termo)) return false;
        }
        return true;
      });
    } catch (error) {
      console.error('Erro ao filtrar tarefas:', error);
      return Array.isArray(board?.tarefas) ? board.tarefas : [];
    }
  }, [board?.tarefas, filtroDe, filtroAte, filtroHistorico]);

  const filtroAtivo = Boolean(filtroDe || filtroAte || filtroHistorico);

  return (
    <div className="space-y-4">
      <div className="p-4 bg-brand-sidebar/20 border border-brand-border text-xs space-y-2">
        <span className="font-bold uppercase tracking-widest">Gestão de Tarefas</span>
        <p className="opacity-60 text-[9px] leading-relaxed">
          Defina as colunas do quadro, crie tarefas com data obrigatória e filtre por data ou por histórico
          (título/descrição).
        </p>
        <div className="flex flex-wrap items-end gap-3 pt-1">
          <button
            type="button"
            onClick={() => setConfigOpen((v) => !v)}
            className="technical-button flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5"
          >
            <Settings size={12} />
            {configOpen ? 'Fechar configuração' : 'Configurar colunas'}
          </button>

          <div className={CF_FIELD_COL}>
            <label htmlFor="gt-filtro-de" className={CF_LABEL}>
              <CalendarRange size={10} className="inline mr-1" />
              Data de
            </label>
            <input
              id="gt-filtro-de"
              type="date"
              aria-label="Filtrar tarefas a partir da data"
              className={CF_FORM_INPUT_DATE}
              value={filtroDe}
              onChange={(e) => setFiltroDe(e.target.value)}
            />
          </div>
          <div className={CF_FIELD_COL}>
            <label htmlFor="gt-filtro-ate" className={CF_LABEL}>
              até
            </label>
            <input
              id="gt-filtro-ate"
              type="date"
              aria-label="Filtrar tarefas até a data"
              className={CF_FORM_INPUT_DATE}
              value={filtroAte}
              onChange={(e) => setFiltroAte(e.target.value)}
            />
          </div>
          <div className={CF_FIELD_COL}>
            <label htmlFor="gt-filtro-historico" className={CF_LABEL}>
              <Search size={10} className="inline mr-1" />
              Histórico (título/descrição)
            </label>
            <input
              id="gt-filtro-historico"
              type="text"
              aria-label="Filtrar tarefas por histórico"
              className={CF_FORM_INPUT_MED}
              value={filtroHistorico}
              onChange={(e) => setFiltroHistorico(e.target.value)}
              placeholder="Buscar por texto..."
            />
          </div>
          {filtroAtivo && (
            <button
              type="button"
              onClick={() => {
                setFiltroDe('');
                setFiltroAte('');
                setFiltroHistorico('');
              }}
              className="technical-button flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1.5 self-end"
            >
              <X size={11} />
              Limpar filtro
            </button>
          )}
        </div>
      </div>

      {configOpen && (
        <div className="technical-panel p-4 space-y-3">
          <h4 className="text-[10px] font-black uppercase tracking-widest border-b border-brand-border pb-2">
            Colunas do quadro
          </h4>
          <div className="space-y-2">
            {board.colunas.map((col) => (
              <div key={col.id} className="flex items-center gap-2">
                <input
                  aria-label={`Nome da coluna ${col.nome}`}
                  className={CF_FORM_INPUT_MED}
                  value={col.nome}
                  onChange={(e) => handleRenameColuna(col.id, e.target.value)}
                  onBlur={handleColunaBlur}
                />
                <button
                  type="button"
                  onClick={() => handleDeleteColuna(col)}
                  aria-label={`Excluir coluna ${col.nome}`}
                  className="technical-button flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1 text-red-700"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-2 border-t border-brand-border/20">
            <input
              aria-label="Nome da nova coluna"
              className={CF_FORM_INPUT_MED}
              value={novaColuna}
              onChange={(e) => setNovaColuna(e.target.value)}
              placeholder="Nome da nova coluna"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddColuna();
              }}
            />
            <button
              type="button"
              onClick={handleAddColuna}
              className="technical-button-primary flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1.5"
            >
              <Plus size={11} />
              Adicionar coluna
            </button>
          </div>
        </div>
      )}

      {board.colunas.length === 0 ? (
        <div className="border border-dashed border-brand-border p-8 text-center text-[10px] font-bold uppercase opacity-50 flex flex-col items-center gap-2">
          <LayoutGrid size={20} />
          Nenhuma coluna configurada. Clique em "Configurar colunas" para começar.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {board.colunas.map((col) => {
            const tarefasColuna = tarefasFiltradas.filter((t) => t.colunaId === col.id);
            return (
              <div key={col.id} className="technical-panel flex flex-col shadow-[3px_3px_0_0_#141414]">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-brand-border bg-brand-sidebar/20">
                  <h4 className="text-[10px] font-black uppercase tracking-widest truncate">{col.nome}</h4>
                  <button
                    type="button"
                    onClick={() => handleAddTarefa(col.id)}
                    aria-label={`Nova tarefa em ${col.nome}`}
                    className="technical-button-primary flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1 shrink-0"
                  >
                    <Plus size={11} />
                    Tarefa
                  </button>
                </div>
                <div className="p-2 space-y-2 min-h-[80px]">
                  {tarefasColuna.length === 0 ? (
                    <p className="text-[9px] font-bold uppercase opacity-40 text-center py-4">
                      {filtroAtivo ? 'Nenhuma tarefa encontrada com esse filtro' : 'Sem tarefas'}
                    </p>
                  ) : (
                    tarefasColuna.map((tarefa) => {
                      const editing = editingTaskId === tarefa.id;
                      const dataInvalida = dataErrorId === tarefa.id;
                      return (
                        <div
                          key={tarefa.id}
                          className="border border-brand-border/40 bg-white p-2 space-y-1.5 h-48 flex flex-col"
                        >
                          {editing ? (
                            <>
                              <input
                                aria-label="Título da tarefa"
                                className="w-full h-[24px] border border-brand-border bg-white px-1.5 text-[10px] font-bold outline-none focus:bg-brand-sidebar/10 shrink-0"
                                value={tarefa.titulo}
                                onChange={(e) => handlePatchTarefa(tarefa.id, { titulo: e.target.value })}
                                placeholder="Título da tarefa"
                              />
                              <textarea
                                aria-label="Descrição da tarefa"
                                className="flex-1 w-full border border-brand-border bg-white px-1.5 py-1 text-[9px] leading-relaxed outline-none focus:bg-brand-sidebar/10 resize-none overflow-y-auto"
                                value={tarefa.descricao}
                                onChange={(e) => handlePatchTarefa(tarefa.id, { descricao: e.target.value })}
                                placeholder="Descrição..."
                              />
                              <div className="shrink-0">
                                <input
                                  type="date"
                                  required
                                  aria-label="Data da tarefa (obrigatória)"
                                  aria-invalid={dataInvalida}
                                  className={cn(
                                    'w-full h-[22px] border bg-white px-1.5 text-[9px] font-bold outline-none focus:bg-brand-sidebar/10',
                                    dataInvalida ? 'border-red-600' : 'border-brand-border',
                                  )}
                                  value={tarefa.data}
                                  onChange={(e) => handlePatchTarefa(tarefa.id, { data: e.target.value })}
                                />
                                {dataInvalida && (
                                  <p className="text-[7px] font-bold uppercase text-red-600 mt-0.5">
                                    Data obrigatória
                                  </p>
                                )}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="text-[10px] font-bold leading-tight shrink-0 truncate" title={tarefa.titulo}>
                                {tarefa.titulo || <span className="opacity-40 font-normal">Sem título</span>}
                              </div>
                              <div className="flex-1 w-full text-[9px] leading-relaxed overflow-y-auto whitespace-pre-wrap opacity-80">
                                {tarefa.descricao || <span className="opacity-40">Sem descrição.</span>}
                              </div>
                            </>
                          )}
                          <div className="flex items-center justify-between gap-1 shrink-0 pt-1 border-t border-brand-border/20">
                            <span className="text-[7px] font-mono opacity-45">{formatDate(tarefa.data)}</span>
                            <div className="flex items-center gap-1">
                              {board.colunas.length > 1 && !editing && (
                                <select
                                  aria-label="Mover tarefa para outra coluna"
                                  className="cf-select h-[20px] text-[8px] font-bold border border-brand-border bg-white px-1"
                                  value={tarefa.colunaId}
                                  onChange={(e) => handleMoveTarefa(tarefa.id, e.target.value)}
                                >
                                  {board.colunas.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.nome}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {editing ? (
                                <button
                                  type="button"
                                  onClick={() => handleSaveTarefa(tarefa.id)}
                                  className="technical-button-primary flex items-center gap-1 text-[8px] font-black uppercase px-1.5 py-0.5"
                                >
                                  <Save size={9} />
                                  Salvar
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setEditingTaskId(tarefa.id)}
                                  className="technical-button flex items-center gap-1 text-[8px] font-black uppercase px-1.5 py-0.5"
                                >
                                  <Pencil size={9} />
                                  Editar
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteTarefa(tarefa.id)}
                                aria-label="Excluir tarefa"
                                className="technical-button flex items-center gap-1 text-[8px] font-black uppercase px-1.5 py-0.5 text-red-700"
                              >
                                <Trash2 size={9} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
