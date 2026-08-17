import { resolveCpcsParaEmpresa, cpcCatalogo } from './notaExplicativaCpc';
import { NOTA_EXPLICATIVA_SECOES, buildTemplateContext } from './notaExplicativaTemplates';
import type {
  NotaExplicativaEmpresaDados,
  NotaExplicativaProfile,
  NotaExplicativaSecaoGerada,
} from './notaExplicativaTypes';
import { empresaEhImuneOuIsenta } from './notaExplicativaTypes';

function renderMustacheLike(template: string, ctx: Record<string, string>): string {
  let out = template;

  out = out.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key: string, block: string) => {
    const val = ctx[key]?.trim();
    return val ? block : '';
  });

  out = out.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key: string, block: string) => {
    const val = ctx[key]?.trim();
    return val ? '' : block;
  });

  out = out.replace(/\{\{(\w+)\}\}/g, (_, key: string) => ctx[key] ?? `{{${key}}}`);

  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export function gerarNotaExplicativa(profile: NotaExplicativaProfile): {
  secoes: NotaExplicativaSecaoGerada[];
  cpcsAplicaveis: ReturnType<typeof resolveCpcsParaEmpresa>;
} {
  const ctx = buildTemplateContext(profile.dados);
  const catalog = new Map(cpcCatalogo().map((c) => [c.codigo, c]));

  const secoes: NotaExplicativaSecaoGerada[] = NOTA_EXPLICATIVA_SECOES.filter((s) =>
    s.aplicaQuando(profile.dados),
  ).map((s) => {
    const override = profile.overrides[s.id]?.trim();
    const corpoBase = override || s.corpo;
    return {
      id: s.id,
      ordem: s.ordem,
      titulo: s.titulo,
      cpcs: s.cpcs.map((c) => catalog.get(c)).filter(Boolean) as NotaExplicativaSecaoGerada['cpcs'],
      corpo: renderMustacheLike(corpoBase, ctx),
    };
  });

  return {
    secoes,
    cpcsAplicaveis: resolveCpcsParaEmpresa(profile.dados),
  };
}

export function notaExplicativaTextoCompleto(secoes: NotaExplicativaSecaoGerada[]): string {
  return secoes
    .map((s) => {
      const refs = s.cpcs.map((c) => c.codigo).join(', ');
      return `${s.titulo}\n${'─'.repeat(48)}\nNormas: ${refs}\n\n${s.corpo}`;
    })
    .join('\n\n\n');
}

export function validarDadosMinimos(dados: NotaExplicativaEmpresaDados): string[] {
  const avisos: string[] = [];
  if (!dados.razaoSocial.trim()) avisos.push('Informe a razão social.');
  if (!dados.cnpj.trim()) avisos.push('Informe o CNPJ.');
  if (dados.atividades.length === 0) avisos.push('Selecione ao menos uma atividade econômica.');
  if (empresaEhImuneOuIsenta(dados) && !dados.fundamentoImunidadeIsencao.trim()) {
    avisos.push('Informe o fundamento legal da imunidade ou isenção.');
  }
  if (
    (dados.possuiEmprestimos || dados.possuiFinanciamentos) &&
    (dados.tiposEndividamento?.length ?? 0) === 0
  ) {
    avisos.push('Marque as modalidades de empréstimo/financiamento para aplicar os CPCs corretos.');
  }
  return avisos;
}
