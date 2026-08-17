import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveExtratoRegrasContas,
  loadExtratoRegrasContas,
  replicateExtratoRegrasParaBanco,
  type ExtratoRegraConta,
} from '../extratoRegrasContasStorage';

const mockStorage: Record<string, string> = {};

if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, val: string) => {
      mockStorage[key] = val;
    },
    removeItem: (key: string) => {
      delete mockStorage[key];
    },
    clear: () => {
      for (const k of Object.keys(mockStorage)) delete mockStorage[k];
    },
    key: () => null,
    length: 0,
  };
}

const COMPANY = 'TEST_COMPANY_REPLICATE';

describe('replicateExtratoRegrasParaBanco', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('replica TODAS as regras do banco de origem para o banco destino sem perder nenhuma', () => {
    const initialRules: ExtratoRegraConta[] = [
      {
        id: 'r1',
        nome: 'PIX RECEBIDO JOAO',
        descricao: 'PIX RECEBIDO JOAO',
        nature: 'C',
        contaBanco: '1036',
        contaContrapartida: '1001',
      },
      {
        id: 'r2',
        nome: 'PIX RECEBIDO MARIA',
        descricao: 'PIX RECEBIDO MARIA',
        nature: 'C',
        contaBanco: '1036',
        contaContrapartida: '1002',
      },
      {
        id: 'r3',
        nome: 'PIX RECEBIDO PEDRO',
        descricao: 'PIX RECEBIDO PEDRO',
        nature: 'C',
        contaBanco: '1036',
        contaContrapartida: '1003',
      },
    ];

    saveExtratoRegrasContas(COMPANY, initialRules, undefined, { consolidate: false });

    const result = replicateExtratoRegrasParaBanco(COMPANY, '1036', '2001');

    expect(result.added).toBe(3);
    expect(result.skipped).toBe(0);

    const updated = loadExtratoRegrasContas(COMPANY);
    const destRules = updated.filter((r) => r.contaBanco === '2001');

    expect(destRules.length).toBe(3);
    expect(destRules.map((r) => r.descricao)).toEqual([
      'PIX RECEBIDO JOAO',
      'PIX RECEBIDO MARIA',
      'PIX RECEBIDO PEDRO',
    ]);
  });
});
