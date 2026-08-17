import { describe, it, expect } from 'vitest';
import {
  buildRazaoFromFolhaRelatorio,
  isFolhaRazaoRow,
  mergeFolhaRazaoComExistente,
} from '../folhaToRazao';
import { emptyFolhaContasAutomacao } from '../folhaContasAutomacao';
import type { FolhaRegra } from '../folhaContasAutomacaoStorage';
import type { FolhaRelatorioImportRow } from '../dominioTxtIO';

function linha(over: Partial<FolhaRelatorioImportRow>): FolhaRelatorioImportRow {
  return {
    id: 'l1',
    date: '30/04/2026',
    description: 'SALARIOS',
    debito: 0,
    credito: 1000,
    ...over,
  } as FolhaRelatorioImportRow;
}

describe('buildRazaoFromFolhaRelatorio', () => {
  it('usa a regra por histórico (subaba Contas) mesmo com o par fixo por rubrica vazio', () => {
    // Regressão: a subaba "Contas" da Folha só grava FolhaRegra (histórico → débito/crédito);
    // o par fixo por rubrica (FolhaContasAutomacaoConfig) nunca tinha UI para ser preenchido,
    // então antes da correção `postFolhaNoRazao` sempre falhava com "configure débito e
    // crédito" mesmo depois do usuário configurar a regra.
    const regras: FolhaRegra[] = [
      { id: 'r1', descricao: 'SALARIOS', contaDebito: '61', contaCredito: '22' },
    ];
    const { rows, gerados, pendencias } = buildRazaoFromFolhaRelatorio(
      [linha({})],
      emptyFolhaContasAutomacao(),
      regras,
    );
    expect(pendencias).toEqual([]);
    expect(gerados).toBe(1);
    expect(rows.length).toBe(2);
    const [debito, credito] = rows;
    expect(debito!.debito).toBe(1000);
    expect(debito!.codigo).toBe('61');
    expect(credito!.credito).toBe(1000);
    expect(credito!.codigo).toBe('22');
    expect(rows.every(isFolhaRazaoRow)).toBe(true);
  });

  it('nunca gera só uma perna: sem regra e sem par fixo configurado, fica pendente (não vai sem contrapartida)', () => {
    const { rows, gerados, pendencias } = buildRazaoFromFolhaRelatorio(
      [linha({})],
      emptyFolhaContasAutomacao(),
      [],
    );
    expect(rows).toEqual([]);
    expect(gerados).toBe(0);
    expect(pendencias.length).toBe(1);
  });

  it('histórico fora do vocabulário fixo de rubrica ainda encontra a regra do usuário', () => {
    const regras: FolhaRegra[] = [
      { id: 'r1', descricao: 'VALE TRANSPORTE', contaDebito: '61', contaCredito: '22' },
    ];
    const { rows, gerados, pendencias } = buildRazaoFromFolhaRelatorio(
      [linha({ description: 'VALE TRANSPORTE' })],
      emptyFolhaContasAutomacao(),
      regras,
    );
    expect(pendencias).toEqual([]);
    expect(gerados).toBe(1);
    expect(rows.length).toBe(2);
  });
});

describe('mergeFolhaRazaoComExistente', () => {
  it('substitui as linhas antigas da Folha em vez de duplicá-las a cada novo envio', () => {
    // Regressão: pushPartida gravava `classificacao` como o código da própria conta (não o
    // marcador FOLHA-AUTO), então `isFolhaRazaoRow` nunca reconhecia linhas antigas da Folha
    // e o merge acumulava duplicatas a cada "Mandar para o Balancete".
    const regras: FolhaRegra[] = [
      { id: 'r1', descricao: 'SALARIOS', contaDebito: '61', contaCredito: '22' },
    ];
    const primeiro = buildRazaoFromFolhaRelatorio([linha({})], emptyFolhaContasAutomacao(), regras);
    const merged1 = mergeFolhaRazaoComExistente([], primeiro.rows);
    expect(merged1.length).toBe(2);

    // Reenvio (mesmo lançamento) — não pode virar 4 linhas.
    const segundo = buildRazaoFromFolhaRelatorio([linha({})], emptyFolhaContasAutomacao(), regras);
    const merged2 = mergeFolhaRazaoComExistente(merged1, segundo.rows);
    expect(merged2.length).toBe(2);
  });
});
