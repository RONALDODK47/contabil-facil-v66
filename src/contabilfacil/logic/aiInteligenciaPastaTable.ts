/**
 * Tabela — somente dados extraídos pela IA de cada documento enviado.
 */
import {
  iaMarkersForPasta,
  isNomeColigadaInvalido,
  isNomeSocioInvalido,
  parseIaMarkerNomes,
  type AiInteligenciaDoc,
  type AiInteligenciaPasta,
  type AiInteligenciaPastaConfig,
} from './aiInteligenciaStorage';

export type PastaTableColumn = { key: string; label: string };
export type PastaTableRow = Record<string, string>;

export function getPastaTableColumns(pasta: AiInteligenciaPasta): PastaTableColumn[] {
  switch (pasta) {
    case 'coligadas':
      return [
        { key: 'documento', label: 'Documento' },
        { key: 'nome', label: 'Empresa coligada' },
        { key: 'aliases', label: 'Aliases' },
      ];
    case 'contratos':
      return [
        { key: 'documento', label: 'Documento' },
        { key: 'nome', label: 'Sócio / parte' },
        { key: 'aliases', label: 'Aliases' },
      ];
    case 'honorarios':
      return [
        { key: 'documento', label: 'Documento' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'nome', label: 'Descrição' },
        { key: 'aliases', label: 'Aliases' },
      ];
    case 'funcionarios':
      return [
        { key: 'documento', label: 'Documento' },
        { key: 'nome', label: 'Funcionário' },
        { key: 'aliases', label: 'Aliases' },
      ];
    case 'despesas':
    case 'receitas':
      return [
        { key: 'documento', label: 'Documento' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'nome', label: 'Descrição' },
        { key: 'aliases', label: 'Aliases' },
      ];
    default:
      return [];
  }
}

export function getPastaGrupoTableColumns(): PastaTableColumn[] {
  return [
    { key: 'sentido', label: 'Sentido' },
    { key: 'grupo', label: 'Grupo sintético' },
  ];
}

export function buildPastaGrupoTableRows(
  config?: AiInteligenciaPastaConfig | null,
): PastaTableRow[] {
  const rows: PastaTableRow[] = [];
  if (config?.contaGrupoSaida?.trim()) {
    rows.push({ sentido: 'Saída (D no banco)', grupo: config.contaGrupoSaida.trim() });
  }
  if (config?.contaGrupoEntrada?.trim()) {
    rows.push({ sentido: 'Entrada (C no banco)', grupo: config.contaGrupoEntrada.trim() });
  }
  return rows;
}

function tipoLinhaPasta(pasta: AiInteligenciaPasta, nome: string): string | undefined {
  if (pasta === 'honorarios') return 'Honorário';
  if (pasta === 'despesas') return 'Despesa';
  if (pasta === 'receitas') return 'Receita';
  return undefined;
}

function isLinhaTabelaInvalida(pasta: AiInteligenciaPasta, nome: string): boolean {
  if (pasta === 'coligadas' && isNomeColigadaInvalido(nome)) return true;
  if (
    (pasta === 'contratos' || pasta === 'honorarios' || pasta === 'funcionarios') &&
    isNomeSocioInvalido(nome)
  ) {
    return true;
  }
  if (/\b\d+\.\d+\.\d+\b/.test(nome)) return true;
  if (/\d+[.,]\d{2}\s*[DC]\b/i.test(nome)) return true;
  return false;
}

/** Apenas linhas vindas de `[IA …]` no texto do documento enviado. */
export function buildPastaTableRows(
  pasta: AiInteligenciaPasta,
  docs: AiInteligenciaDoc[],
): PastaTableRow[] {
  const rows: PastaTableRow[] = [];
  const seen = new Set<string>();
  const markers = iaMarkersForPasta(pasta);

  for (const doc of docs) {
    const texto = String(doc.textoExtraido || '').trim();
    if (!texto || texto.startsWith('[arquivo]')) continue;

    const items = parseIaMarkerNomes(texto, markers);
    for (const item of items) {
      if (isLinhaTabelaInvalida(pasta, item.nome)) continue;
      const row: PastaTableRow = {
        documento: doc.nome,
        nome: item.nome,
        aliases: item.aliases.join(' · '),
      };
      const tipo = tipoLinhaPasta(pasta, item.nome);
      if (tipo) row.tipo = tipo;
      const key = `${row.documento}|${row.nome}`.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }

  return rows.slice(0, 200);
}
