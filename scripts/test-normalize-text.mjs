#!/usr/bin/env node
/**
 * Script de validação: normalização de texto para filtros
 * Testa cenários reais: maiúsculas, acentos e combinações
 */

/**
 * Normaliza texto para comparação: remove acentos, maiúsculas, espaços extras.
 */
function normalizeTextForMatching(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacríticos
    .replace(/[^\w\s]/g, ' ')        // Remove sinais, mantém apenas letras/números/espaço
    .replace(/\s+/g, ' ')             // Normaliza espaços múltiplos
    .toUpperCase()
    .trim();
}

const tests = [];

function test(name, fn) {
  try {
    fn();
    tests.push({ name, status: '✓', error: null });
  } catch (err) {
    tests.push({ name, status: '✗', error: err.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
  }
}

// ============================================================================
// TESTES
// ============================================================================

test('Normalizar maiúsculas: saldo anterior', () => {
  assertEqual(normalizeTextForMatching('saldo anterior'), 'SALDO ANTERIOR', 'Deve converter para maiúsculas');
});

test('Normalizar maiúsculas: idempotente', () => {
  assertEqual(normalizeTextForMatching('SALDO ANTERIOR'), 'SALDO ANTERIOR', 'Já em maiúsculas');
});

test('Remover acento: SALDÓ', () => {
  assertEqual(normalizeTextForMatching('SALDÓ'), 'SALDO', 'Deve remover acento agudo');
});

test('Remover til: São Paulo', () => {
  assertEqual(normalizeTextForMatching('são paulo'), 'SAO PAULO', 'Deve remover til');
});

test('Remover cedilha: cobrança', () => {
  assertEqual(normalizeTextForMatching('cobrança'), 'COBRANCA', 'Deve remover cedilha');
});

test('Remover circunflexo: próximo', () => {
  assertEqual(normalizeTextForMatching('próximo'), 'PROXIMO', 'Deve remover circunflexo');
});

test('Remover espaços extras', () => {
  assertEqual(normalizeTextForMatching('  saldo   anterior  '), 'SALDO ANTERIOR', 'Deve remover espaços extras');
});

test('Remover dois pontos', () => {
  assertEqual(normalizeTextForMatching('SALDO: ANTERIOR'), 'SALDO ANTERIOR', 'Deve remover dois pontos');
});

test('Remover hífen', () => {
  assertEqual(normalizeTextForMatching('SALDO - ANTERIOR'), 'SALDO ANTERIOR', 'Deve remover hífen');
});

test('Remover ponto', () => {
  assertEqual(normalizeTextForMatching('SALDO. ANTERIOR'), 'SALDO ANTERIOR', 'Deve remover ponto');
});

test('Remover múltiplos sinais', () => {
  assertEqual(normalizeTextForMatching('SALDO:.-ANTERIOR'), 'SALDO ANTERIOR', 'Deve remover múltiplos sinais');
});

test('Remover sinais em acentos', () => {
  assertEqual(normalizeTextForMatching('SÁLDO: ANTÉRIOR'), 'SALDO ANTERIOR', 'Deve remover acentos e sinais');
});

test('Caso real: Saldó Antérior (misto)', () => {
  assertEqual(normalizeTextForMatching('Saldó Antérior'), 'SALDO ANTERIOR', 'Deve normalizar completamente');
});

test('Caso real: SÁLDO ANTÉRIÓR', () => {
  assertEqual(normalizeTextForMatching('SÁLDO ANTÉRIÓR'), 'SALDO ANTERIOR', 'Deve remover acentos mesmo em maiúsculas');
});

// ============================================================================
// TESTES DE FILTRO (exclusionRules)
// ============================================================================

test('Filtro: deve filtrar SALDO ANTERIOR', () => {
  const rules = ['SALDO ANTERIOR'];
  const history = 'SALDO ANTERIOR';
  const normalized = normalizeTextForMatching(history);
  const shouldFilter = rules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(shouldFilter, 'Deve filtrar SALDO ANTERIOR');
});

test('Filtro: deve filtrar saldo anterior (minúsculas)', () => {
  const rules = ['SALDO ANTERIOR'];
  const history = 'saldo anterior';
  const normalized = normalizeTextForMatching(history);
  const shouldFilter = rules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(shouldFilter, 'Deve filtrar "saldo anterior" (minúsculas)');
});

test('Filtro: deve filtrar Saldó Antérior (com acentos)', () => {
  const rules = ['SALDO ANTERIOR'];
  const history = 'Saldó Antérior';
  const normalized = normalizeTextForMatching(history);
  const shouldFilter = rules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(shouldFilter, 'Deve filtrar "Saldó Antérior" (com acentos)');
});

test('Filtro: NÃO deve filtrar PIX RECEBIDO', () => {
  const rules = ['SALDO ANTERIOR'];
  const history = 'PIX RECEBIDO';
  const normalized = normalizeTextForMatching(history);
  const shouldFilter = rules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(!shouldFilter, 'Não deve filtrar PIX RECEBIDO');
});

test('Filtro: NÃO deve filtrar SALDO (incompleto)', () => {
  const rules = ['SALDO ANTERIOR'];
  const history = 'SALDO';
  const normalized = normalizeTextForMatching(history);
  const shouldFilter = rules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(!shouldFilter, 'Não deve filtrar apenas "SALDO"');
});

test('Filtro: deve filtrar SALDO: ANTERIOR (com dois pontos)', () => {
  const rules = ['SALDO ANTERIOR'];
  const history = 'SALDO: ANTERIOR';
  const normalized = normalizeTextForMatching(history);
  const shouldFilter = rules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(shouldFilter, 'Deve filtrar "SALDO: ANTERIOR"');
});

test('Filtro: deve filtrar SALDO - ANTERIOR (com hífen)', () => {
  const rules = ['SALDO ANTERIOR'];
  const history = 'SALDO - ANTERIOR';
  const normalized = normalizeTextForMatching(history);
  const shouldFilter = rules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(shouldFilter, 'Deve filtrar "SALDO - ANTERIOR"');
});

test('Filtro: deve filtrar SALDO. ANTERIOR (com ponto)', () => {
  const rules = ['SALDO ANTERIOR'];
  const history = 'SALDO. ANTERIOR';
  const normalized = normalizeTextForMatching(history);
  const shouldFilter = rules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(shouldFilter, 'Deve filtrar "SALDO. ANTERIOR"');
});

test('Filtro: deve filtrar SÁLDO:.-ANTÉRIOR (acentos + sinais)', () => {
  const rules = ['SALDO ANTERIOR'];
  const history = 'SÁLDO:.-ANTÉRIOR';
  const normalized = normalizeTextForMatching(history);
  const shouldFilter = rules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(shouldFilter, 'Deve filtrar mesmo com acentos e múltiplos sinais');
});

// ============================================================================
// TESTES DE LIMPEZA (cleanupRules)
// ============================================================================

function cleanHistoryText(history, rules) {
  let clean = history || '';
  rules.forEach((rule) => {
    const trimmed = rule.trim();
    if (!trimmed) return;

    const normalized = normalizeTextForMatching(trimmed);
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
  return clean.replace(/\s+/g, ' ').trim();
}

test('Cleanup: remover SALDO ANTERIOR', () => {
  const result = cleanHistoryText('SALDO ANTERIOR 1.000,00', ['SALDO ANTERIOR']);
  assertEqual(result, '1.000,00', 'Deve remover SALDO ANTERIOR');
});

test('Cleanup: remover saldo anterior (minúsculas)', () => {
  const result = cleanHistoryText('saldo anterior 1.000,00', ['SALDO ANTERIOR']);
  assertEqual(result, '1.000,00', 'Deve remover mesmo em minúsculas');
});

test('Cleanup: remover Saldó Antérior (com acentos)', () => {
  const result = cleanHistoryText('Saldó Antérior 1.000,00', ['SALDO ANTERIOR']);
  assertEqual(result, '1.000,00', 'Deve remover mesmo com acentos');
});

test('Cleanup: remover LO SALDO DIA', () => {
  const result = cleanHistoryText('PIX RECEBIDO LO SALDO DIA', ['LO SALDO DIA']);
  assertEqual(result, 'PIX RECEBIDO', 'Deve remover LO SALDO DIA');
});

test('Cleanup: remover lo saldo dia (minúsculas)', () => {
  const result = cleanHistoryText('pix recebido lo saldo dia', ['LO SALDO DIA']);
  assertEqual(result, 'pix recebido', 'Deve remover mesmo em minúsculas');
});

test('Cleanup: remover LÓ SÁLDO DÍA (com acentos)', () => {
  const result = cleanHistoryText('PIX RECEBIDO LÓ SÁLDO DÍA', ['LO SALDO DIA']);
  assertEqual(result, 'PIX RECEBIDO', 'Deve remover mesmo com acentos');
});

test('Cleanup: preservar se não contém termo', () => {
  const result = cleanHistoryText('PIX RECEBIDO EMPRESA', ['SALDO ANTERIOR']);
  assertEqual(result, 'PIX RECEBIDO EMPRESA', 'Deve preservar se não contém termo');
});

// ============================================================================
// CENÁRIOS REAIS COM SALDO
// ============================================================================

test('Cenário real 1: Lançamento em MAIÚSCULO puro', () => {
  const launch = 'SALDO ANTERIOR';
  const exclusionRules = ['SALDO ANTERIOR'];
  const normalized = normalizeTextForMatching(launch);
  const shouldExclude = exclusionRules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(shouldExclude && launch === 'SALDO ANTERIOR', 'Original preservado e filtrado corretamente');
});

test('Cenário real 2: Lançamento em minúscula com acento', () => {
  const launch = 'sáldo antérior';
  const exclusionRules = ['SALDO ANTERIOR'];
  const normalized = normalizeTextForMatching(launch);
  const shouldExclude = exclusionRules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(shouldExclude && launch === 'sáldo antérior', 'Original preservado e filtrado corretamente');
});

test('Cenário real 3: Lançamento misto (MAIÚSCULA + acento)', () => {
  const launch = 'SÁLDO ANTÉRIOR';
  const exclusionRules = ['SALDO ANTERIOR'];
  const normalized = normalizeTextForMatching(launch);
  const shouldExclude = exclusionRules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(shouldExclude && launch === 'SÁLDO ANTÉRIOR', 'Original preservado e filtrado corretamente');
});

test('Cenário real 4: PIX deve ser preservado', () => {
  const launch = 'PIX RECÉBIDO - EMPRESA LTDÁ';
  const exclusionRules = ['SALDO ANTERIOR', 'SALDO DO DIA'];
  const normalized = normalizeTextForMatching(launch);
  const shouldExclude = exclusionRules.map((r) => normalizeTextForMatching(r)).some((r) => normalized === r);
  assert(!shouldExclude && launch === 'PIX RECÉBIDO - EMPRESA LTDÁ', 'Original preservado e não filtrado');
});

test('Cenário real 5: Cleanup com termo em maiúscula/acento', () => {
  const history = 'PIX RECÉBIDO LÓ SÁLDO DÍA';
  const result = cleanHistoryText(history, ['LO SALDO DIA']);
  assert(result === 'PIX RECÉBIDO', 'Termo removido, original preservado');
});

// ============================================================================
// RELATÓRIO
// ============================================================================

console.log('\n📋 TESTE: Normalização de Texto para Filtros de Lançamentos\n');
console.log('═'.repeat(70));

let passed = 0;
let failed = 0;

tests.forEach((test) => {
  if (test.status === '✓') {
    console.log(`${test.status} ${test.name}`);
    passed++;
  } else {
    console.log(`${test.status} ${test.name}`);
    console.log(`  ❌ ${test.error}`);
    failed++;
  }
});

console.log('═'.repeat(70));
console.log(`\n✅ Testes passados: ${passed}/${tests.length}`);
if (failed > 0) {
  console.log(`❌ Testes falhados: ${failed}/${tests.length}`);
  process.exit(1);
} else {
  console.log('🎉 Todos os testes passaram!\n');
  process.exit(0);
}
