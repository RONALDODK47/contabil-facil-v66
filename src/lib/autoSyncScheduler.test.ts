/**
 * Teste do Agendador de Sincronização Automática
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { startAutoSync, stopAutoSync, syncNow, saveNow } from './autoSyncScheduler';

describe('autoSyncScheduler', () => {
  // `performSave` faz `await import(...)` de dois módulos pesados. Em teste, o
  // primeiro import paga o custo de transformar toda a árvore de dependências e
  // estourava o timeout padrão de 5s no primeiro `it` que chamasse saveNow/syncNow
  // — quem rodasse depois passava, porque o módulo já estava em cache.
  // Aquecer o cache aqui torna o custo previsível e tira a corrida entre testes.
  beforeAll(async () => {
    await Promise.all([
      import('../contabilfacil/logic/eyeVisionOperationalSave'),
      import('../contabilfacil/logic/eyeVisionCloudSync'),
    ]);
  }, 60000);

  beforeEach(() => {
    // Simula ambiente browser (window deve existir para startAutoSync funcionar)
    vi.stubGlobal('window', globalThis);
    // Evita que fetch real seja chamado — rejeita imediatamente
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch not available in tests')));
    stopAutoSync();
    vi.clearAllTimers();
  });

  afterEach(() => {
    stopAutoSync();
    vi.unstubAllGlobals();
  });

  it('deve iniciar os timers de salvamento e sincronização', () => {
    vi.useFakeTimers();

    startAutoSync();

    // Timers devem estar ativos
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it('deve parar os timers quando stopAutoSync é chamado', () => {
    vi.useFakeTimers();

    startAutoSync();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    stopAutoSync();
    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
  });

  it('deve permitir sincronização manual', async () => {
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => 'TEST_TOKEN'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });

    // Deve executar sem erro
    await expect(syncNow()).resolves.toBeUndefined();
  }, 15000);

  it('deve permitir salvamento manual', async () => {
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => 'TEST_TOKEN'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(() => null),
      },
      writable: true,
    });

    // Deve executar sem erro
    await expect(saveNow()).resolves.toBeUndefined();
  }, 15000); // aumenta timeout — o import dinâmico pode demorar em CI

  it('deve ter logs de inicialização', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    startAutoSync();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Iniciando sincronização automática'));

    logSpy.mockRestore();
  });
});
