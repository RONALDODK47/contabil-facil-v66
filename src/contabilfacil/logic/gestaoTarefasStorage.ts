import { generateUUID } from '../../lib/uuid';
import { readPersistedLocalStorageJson, writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';

export interface TarefaColuna {
  id: string;
  nome: string;
}

export interface TarefaItem {
  id: string;
  colunaId: string;
  titulo: string;
  descricao: string;
  /** Data da tarefa (YYYY-MM-DD) — obrigatória, escolhida pelo usuário; usada no filtro por data. */
  data: string;
  createdAt: string;
}

export interface GestaoTarefasBoard {
  colunas: TarefaColuna[];
  tarefas: TarefaItem[];
}

// Ferramentas não é escopada por empresa — um único quadro global compartilhado.
const STORAGE_KEY = 'contabilfacil_ferramentas_gestao_tarefas_v1';

function defaultBoard(): GestaoTarefasBoard {
  try {
    return {
      colunas: [
        { id: generateUUID(), nome: 'A Fazer' },
        { id: generateUUID(), nome: 'Em Andamento' },
        { id: generateUUID(), nome: 'Concluído' },
      ],
      tarefas: [],
    };
  } catch (error) {
    console.error('Erro ao criar board padrão:', error);
    // Fallback com IDs baseados em timestamp
    const now = Date.now();
    return {
      colunas: [
        { id: `${now}_1`, nome: 'A Fazer' },
        { id: `${now}_2`, nome: 'Em Andamento' },
        { id: `${now}_3`, nome: 'Concluído' },
      ],
      tarefas: [],
    };
  }
}

export function loadGestaoTarefas(): GestaoTarefasBoard {
  try {
    const board = readPersistedLocalStorageJson<GestaoTarefasBoard | null>(STORAGE_KEY, null);
    if (board && Array.isArray(board.colunas) && Array.isArray(board.tarefas)) {
      return board;
    }
  } catch (error) {
    console.error('Erro ao carregar dados de gestão de tarefas:', error);
  }
  return defaultBoard();
}

export function saveGestaoTarefas(board: GestaoTarefasBoard): void {
  try {
    writePersistedLocalStorageJson(STORAGE_KEY, board);
  } catch (error) {
    console.error('Erro ao salvar dados de gestão de tarefas:', error);
    throw error; // Re-throw para o componente tratar
  }
}

export function createTarefaColuna(nome: string): TarefaColuna {
  try {
    return { id: generateUUID(), nome };
  } catch (error) {
    console.error('Erro ao criar coluna de tarefa:', error);
    // Fallback com timestamp como ID
    return { id: Date.now().toString(), nome };
  }
}

export function createTarefaItem(colunaId: string): TarefaItem {
  try {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const hojeIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return {
      id: generateUUID(),
      colunaId,
      titulo: '',
      descricao: '',
      data: hojeIso,
      createdAt: now.toISOString(),
    };
  } catch (error) {
    console.error('Erro ao criar item de tarefa:', error);
    // Fallback com valores seguros
    return {
      id: Date.now().toString(), // Fallback se generateUUID falhar
      colunaId,
      titulo: '',
      descricao: '',
      data: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
    };
  }
}
