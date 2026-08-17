/**
 * Testes para normalização de texto em filtros e lançamentos
 * Cenários: maiúsculas, acentos, e combinações
 */

import { describe, it, expect } from 'vitest';

/**
 * Normaliza texto para comparação: remove acentos, maiúsculas, espaços extras.
 * Preserva o original, usado APENAS para matching em filtros/exclusões.
 */
function normalizeTextForMatching(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacríticos
    .toUpperCase()
    .replace(/\s+/g, ' ') // Colapsa espaços múltiplos
    .trim();
}

describe('normalizeTextForMatching', () => {
  describe('Maiúsculas e minúsculas', () => {
    it('deve converter minúsculas para maiúsculas', () => {
      expect(normalizeTextForMatching('saldo anterior')).toBe('SALDO ANTERIOR');
    });

    it('deve converter maiúsculas para maiúsculas (idempotente)', () => {
      expect(normalizeTextForMatching('SALDO ANTERIOR')).toBe('SALDO ANTERIOR');
    });

    it('deve normalizar mixed case', () => {
      expect(normalizeTextForMatching('SaLdO AnTeRiOr')).toBe('SALDO ANTERIOR');
    });
  });

  describe('Acentos e diacríticos', () => {
    it('deve remover acento agudo (é → E)', () => {
      expect(normalizeTextForMatching('salÉdo')).toBe('SALEDO');
    });

    it('deve remover acento grave (à → A)', () => {
      expect(normalizeTextForMatching('à vista')).toBe('A VISTA');
    });

    it('deve remover til (ã → A)', () => {
      expect(normalizeTextForMatching('são paulo')).toBe('SAO PAULO');
    });

    it('deve remover cedilha (ç → C)', () => {
      expect(normalizeTextForMatching('cobrança')).toBe('COBRANCA');
    });

    it('deve remover circunflexo (ô → O)', () => {
      expect(normalizeTextForMatching('saldo próximo')).toBe('SALDO PROXIMO');
    });

    it('deve remover múltiplos diacríticos simultaneamente', () => {
      expect(normalizeTextForMatching('São Pãçõ À')).toBe('SAO PACO A');
    });
  });

  describe('Espaços', () => {
    it('deve remover espaços extras', () => {
      expect(normalizeTextForMatching('  saldo   anterior  ')).toBe('SALDO ANTERIOR');
    });

    it('deve fazer trim', () => {
      expect(normalizeTextForMatching('   texto   ')).toBe('TEXTO');
    });
  });

  describe('Casos reais de lançamentos', () => {
    it('deve normalizar SALDO DO DIA', () => {
      expect(normalizeTextForMatching('SALDO DO DIA')).toBe('SALDO DO DIA');
    });

    it('deve normalizar saldo do dia (minúsculas)', () => {
      expect(normalizeTextForMatching('saldo do dia')).toBe('SALDO DO DIA');
    });

    it('deve normalizar Saldo Dó Día (com acentos)', () => {
      expect(normalizeTextForMatching('Saldo Dó Día')).toBe('SALDO DO DIA');
    });

    it('deve normalizar SALDÓ ANTERIOR (maiúscula + acento)', () => {
      expect(normalizeTextForMatching('SALDÓ ANTERIOR')).toBe('SALDO ANTERIOR');
    });

    it('deve normalizar pix recebido - empresa ltda', () => {
      expect(normalizeTextForMatching('PIX RECEBIDO - EMPRESA LTDA')).toBe('PIX RECEBIDO - EMPRESA LTDA');
    });

    it('deve normalizar pix recebido - EMPRESA LTDÁ (com acento)', () => {
      expect(normalizeTextForMatching('pix recebido - EMPRESA LTDÁ')).toBe('PIX RECEBIDO - EMPRESA LTDA');
    });
  });
});

describe('Filtros com exclusionRules', () => {
  const exclusionRules = [
    'SALDO ANTERIOR',
    'SALDO DO DIA',
    'SALDO ATUAL',
    'SALDO FINAL',
  ];

  it('deve filtrar SALDO ANTERIOR (exata)', () => {
    const historyNormalized = normalizeTextForMatching('SALDO ANTERIOR');
    const shouldFilter = exclusionRules
      .map((rule) => normalizeTextForMatching(rule))
      .some((rule) => historyNormalized === rule);
    expect(shouldFilter).toBe(true);
  });

  it('deve filtrar saldo anterior (minúsculas)', () => {
    const historyNormalized = normalizeTextForMatching('saldo anterior');
    const shouldFilter = exclusionRules
      .map((rule) => normalizeTextForMatching(rule))
      .some((rule) => historyNormalized === rule);
    expect(shouldFilter).toBe(true);
  });

  it('deve filtrar Saldó Antérior (com acentos)', () => {
    const historyNormalized = normalizeTextForMatching('Saldó Antérior');
    const shouldFilter = exclusionRules
      .map((rule) => normalizeTextForMatching(rule))
      .some((rule) => historyNormalized === rule);
    expect(shouldFilter).toBe(true);
  });

  it('deve filtrar SALDÓ ANTÉRIÓR (maiúscula + acentos)', () => {
    const historyNormalized = normalizeTextForMatching('SALDÓ ANTÉRIÓR');
    const shouldFilter = exclusionRules
      .map((rule) => normalizeTextForMatching(rule))
      .some((rule) => historyNormalized === rule);
    expect(shouldFilter).toBe(true);
  });

  it('NÃO deve filtrar PIX RECEBIDO (não está na lista)', () => {
    const historyNormalized = normalizeTextForMatching('PIX RECEBIDO');
    const shouldFilter = exclusionRules
      .map((rule) => normalizeTextForMatching(rule))
      .some((rule) => historyNormalized === rule);
    expect(shouldFilter).toBe(false);
  });

  it('NÃO deve filtrar pix recebido (não está na lista, mesmo normalizado)', () => {
    const historyNormalized = normalizeTextForMatching('pix recebido');
    const shouldFilter = exclusionRules
      .map((rule) => normalizeTextForMatching(rule))
      .some((rule) => historyNormalized === rule);
    expect(shouldFilter).toBe(false);
  });

  it('NÃO deve filtrar SALDO (palavra incompleta)', () => {
    const historyNormalized = normalizeTextForMatching('SALDO');
    const shouldFilter = exclusionRules
      .map((rule) => normalizeTextForMatching(rule))
      .some((rule) => historyNormalized === rule);
    expect(shouldFilter).toBe(false);
  });
});

describe('Limpeza com cleanupRules (remoção de termos)', () => {
  const cleanupRules = ['SALDO ANTERIOR', 'LO SALDO DIA'];

  function cleanHistoryText(history: string, rules: string[]): string {
    let clean = history || '';
    rules.forEach((rule) => {
      const trimmed = rule.trim();
      if (!trimmed) return;

      const normalized = normalizeTextForMatching(trimmed);
      const normalizedClean = normalizeTextForMatching(clean);

      if (normalizedClean.includes(normalized)) {
        // Remove pela normalização mantendo o original
        const cleanWords = clean.split(/\s+/);
        const normalizedWords = normalizedClean.split(/\s+/);
        const ruleWords = normalized.split(/\s+/).filter(Boolean);

        if (ruleWords.length > 0) {
          for (let i = 0; i <= normalizedWords.length - ruleWords.length; i++) {
            const segment = normalizedWords.slice(i, i + ruleWords.length).join(' ');
            if (segment === ruleWords.join(' ')) {
              cleanWords.splice(i, ruleWords.length);
              clean = cleanWords.join(' ');
              break;
            }
          }
        }
      }
    });
    return clean.replace(/\s+/g, ' ').trim();
  }

  it('deve remover SALDO ANTERIOR do histórico', () => {
    const result = cleanHistoryText('SALDO ANTERIOR 1.000,00', cleanupRules);
    expect(result).toBe('1.000,00');
  });

  it('deve remover saldo anterior (minúsculas)', () => {
    const result = cleanHistoryText('saldo anterior 1.000,00', cleanupRules);
    expect(result).toBe('1.000,00');
  });

  it('deve remover Saldó Antérior (com acentos)', () => {
    const result = cleanHistoryText('Saldó Antérior 1.000,00', cleanupRules);
    expect(result).toBe('1.000,00');
  });

  it('deve remover LO SALDO DIA de "PIX RECEBIDO LO SALDO DIA"', () => {
    const result = cleanHistoryText('PIX RECEBIDO LO SALDO DIA', cleanupRules);
    expect(result).toBe('PIX RECEBIDO');
  });

  it('deve remover "lo saldo dia" (minúsculas)', () => {
    const result = cleanHistoryText('pix recebido lo saldo dia', cleanupRules);
    expect(result).toBe('pix recebido');
  });

  it('deve remover "LÓ SÁLDO DÍA" (com acentos)', () => {
    const result = cleanHistoryText('PIX RECEBIDO LÓ SÁLDO DÍA', cleanupRules);
    expect(result).toBe('PIX RECEBIDO');
  });

  it('deve preservar lançamento se não contém termo para remover', () => {
    const result = cleanHistoryText('PIX RECEBIDO EMPRESA', cleanupRules);
    expect(result).toBe('PIX RECEBIDO EMPRESA');
  });

  it('deve remover múltiplos termos', () => {
    const result = cleanHistoryText('SALDO ANTERIOR 500 LO SALDO DIA', cleanupRules);
    expect(result).toBe('500');
  });
});

describe('Cenários reais com saldo', () => {
  it('Cenário 1: Saldo com lançamento em MAIÚSCULO puro', () => {
    const launch = 'SALDO ANTERIOR';
    const exclusionRules = ['SALDO ANTERIOR'];

    const normalized = normalizeTextForMatching(launch);
    const shouldExclude = exclusionRules
      .map((r) => normalizeTextForMatching(r))
      .some((r) => normalized === r);

    expect(shouldExclude).toBe(true);
    expect(launch).toBe('SALDO ANTERIOR'); // Original preservado
  });

  it('Cenário 2: Saldo com lançamento em minúscula com acento', () => {
    const launch = 'sáldo antérior';
    const exclusionRules = ['SALDO ANTERIOR'];

    const normalized = normalizeTextForMatching(launch);
    const shouldExclude = exclusionRules
      .map((r) => normalizeTextForMatching(r))
      .some((r) => normalized === r);

    expect(shouldExclude).toBe(true);
    expect(launch).toBe('sáldo antérior'); // Original preservado
  });

  it('Cenário 3: Saldo com lançamento misto (MAIÚSCULO + acento)', () => {
    const launch = 'SÁLDO ANTÉRIOR';
    const exclusionRules = ['SALDO ANTERIOR'];

    const normalized = normalizeTextForMatching(launch);
    const shouldExclude = exclusionRules
      .map((r) => normalizeTextForMatching(r))
      .some((r) => normalized === r);

    expect(shouldExclude).toBe(true);
    expect(launch).toBe('SÁLDO ANTÉRIOR'); // Original preservado
  });

  it('Cenário 4: Lançamento genuíno deve ser preservado (PIX)', () => {
    const launch = 'PIX RECÉBIDO - EMPRESA LTDÁ';
    const exclusionRules = ['SALDO ANTERIOR', 'SALDO DO DIA'];

    const normalized = normalizeTextForMatching(launch);
    const shouldExclude = exclusionRules
      .map((r) => normalizeTextForMatching(r))
      .some((r) => normalized === r);

    expect(shouldExclude).toBe(false);
    expect(launch).toBe('PIX RECÉBIDO - EMPRESA LTDÁ'); // Original preservado
  });

  it('Cenário 5: Cleanup com termo para remover em maiúscula/acento', () => {
    const cleanupRules = ['LO SALDO DIA'];
    let history = 'PIX RECÉBIDO LÓ SÁLDO DÍA';

    // Simular cleanHistoryText
    let clean = history;
    cleanupRules.forEach((rule) => {
      const normalized = normalizeTextForMatching(rule);
      const normalizedClean = normalizeTextForMatching(clean);

      if (normalizedClean.includes(normalized)) {
        const cleanWords = clean.split(/\s+/);
        const normalizedWords = normalizedClean.split(/\s+/);
        const ruleWords = normalized.split(/\s+/).filter(Boolean);

        if (ruleWords.length > 0) {
          for (let i = 0; i <= normalizedWords.length - ruleWords.length; i++) {
            const segment = normalizedWords.slice(i, i + ruleWords.length).join(' ');
            if (segment === ruleWords.join(' ')) {
              cleanWords.splice(i, ruleWords.length);
              clean = cleanWords.join(' ');
              break;
            }
          }
        }
      }
    });
    clean = clean.replace(/\s+/g, ' ').trim();

    expect(clean).toBe('PIX RECÉBIDO'); // Termo removido, original preservado
  });
});
