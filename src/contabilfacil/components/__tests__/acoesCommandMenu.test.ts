import { describe, it, expect } from 'vitest';
import { filtrarAcoes, pontuarAcao, type AcaoMenuItem } from '../AcoesCommandMenu';

const acao = (id: string, label: string, descricao = '', palavras: string[] = []): AcaoMenuItem => ({
  id,
  label,
  descricao,
  palavras,
  onSelect: () => {},
});

const ITENS: AcaoMenuItem[] = [
  acao('aplicar', 'Aplicar regras na conciliação', 'Aplica as contas das regras', ['reaplicar']),
  acao('salvar', 'Salvar extrato (autosave)', 'Salva o extrato conciliado + PDF', ['gravar']),
  acao('pdf', 'PDF conciliado', 'Exporta a conciliação em PDF', ['imprimir']),
  acao('png', 'Imagem (PNG)', 'Exporta a conciliação como imagem', ['print', 'captura']),
  acao('balancete', 'Importar para o balancete', 'Leva os conciliados ao balancete', ['contabilizar']),
  acao('pastas', 'Pastas de extratos', 'Extratos salvos por conta banco', ['abrir']),
  acao('regras', 'Regras de contas', 'Regras por histórico, valor e documento', ['folha']),
  acao('debug', 'Debug logs', 'Painel de diagnóstico', ['suporte']),
];

const ids = (termo: string) => filtrarAcoes(ITENS, termo).map((i) => i.id);

describe('Busca do menu de ações', () => {
  it('sem termo, devolve tudo na ordem original', () => {
    expect(ids('')).toEqual(ITENS.map((i) => i.id));
  });

  it('ignora acento e maiúscula', () => {
    expect(ids('conciliacao')[0]).toBe('aplicar');
    expect(ids('CONCILIAÇÃO')).toContain('pdf');
  });

  it('aceita as palavras em qualquer ordem', () => {
    expect(ids('balancete importar')[0]).toBe('balancete');
  });

  it('acha pelo sinônimo, não só pelo nome', () => {
    expect(ids('imprimir')).toEqual(['pdf']);
    expect(ids('folha')).toEqual(['regras']);
    expect(ids('gravar')).toEqual(['salvar']);
  });

  it('acha por abreviação (subsequência)', () => {
    expect(ids('pdfcon')).toContain('pdf');
    expect(ids('dbg')).toContain('debug');
  });

  it('prioriza quem começa com o termo', () => {
    expect(ids('regras')[0]).toBe('regras');
    expect(ids('pdf')[0]).toBe('pdf');
  });

  it('devolve vazio quando nada casa', () => {
    expect(ids('xyzw')).toEqual([]);
  });

  it('pontua match exato acima de match parcial', () => {
    const exato = pontuarAcao(acao('a', 'PDF conciliado'), 'pdf conciliado');
    const parcial = pontuarAcao(acao('b', 'Exportar tudo em PDF'), 'pdf conciliado');
    expect(exato).toBeGreaterThan(parcial);
  });
});
