import type { SpedFiscalItem, ParsedSpedFiscal, SpedNotaFiscal } from '../../extratoVision/utils/spedFiscalParser';
import type { NfeCreditoSugerido, NfeNotaResumo, PricingNfeCache } from './pricingTypes';
import type { FiscalSpedArquivoSalvo } from './fiscalSpedAutomation';
import { readManagerData, writeManagerData } from './companyWorkspace';

/**
 * Converte dados de NFs importadas da SEFAZ em um arquivo SPED virtual
 * que pode ser visualizado na aba de Acumuladores e Impostos.
 */
export function createSpedFromNfeCache(
  cache: PricingNfeCache,
  companyName: string,
  cnpj: string,
): ParsedSpedFiscal | null {
  if (!cache.notas?.length && !cache.creditosSugeridos?.length) {
    return null;
  }

  const lastSyncAt = cache.lastSyncAt || new Date().toISOString();
  const syncDate = new Date(lastSyncAt);
  const dd = String(syncDate.getDate()).padStart(2, '0');
  const mm = String(syncDate.getMonth() + 1).padStart(2, '0');
  const yyyy = String(syncDate.getFullYear());
  const dtFin = `${dd}${mm}${yyyy}`;
  const dtIni = dtFin; // Use mesma data para importação SEFAZ

  const itens: SpedFiscalItem[] = [];

  // Agrupar créditos por tipo para criar acumuladores
  const creditosPorTipo = new Map<string, NfeCreditoSugerido[]>();
  for (const credito of cache.creditosSugeridos ?? []) {
    const tipo = credito.tipo.toUpperCase();
    const list = creditosPorTipo.get(tipo) ?? [];
    list.push(credito);
    creditosPorTipo.set(tipo, list);
  }

  // Criar item de acumulador para cada tipo de imposto
  let linha = 1;
  for (const [tipoKey, creditos] of creditosPorTipo.entries()) {
    const totalValor = creditos.reduce((s, c) => s + c.valor, 0);

    // Determinar registro e código baseado no tipo
    let registro = 'C190';
    let codigo = '';
    let imposto = tipoKey;

    if (tipoKey.includes('ICMS')) {
      registro = 'C190';
      codigo = '00-1949'; // CFOP genérico
      imposto = 'ICMS';
    } else if (tipoKey.includes('IPI')) {
      registro = 'E250';
      codigo = 'IPI-ENTRADA';
      imposto = 'IPI';
    } else if (tipoKey.includes('PIS')) {
      registro = 'M210';
      codigo = 'PIS-REC';
      imposto = 'PIS';
    } else if (tipoKey.includes('COFINS')) {
      registro = 'M610';
      codigo = 'COFINS-REC';
      imposto = 'COFINS';
    }

    itens.push({
      kind: 'acumulador',
      natureza: totalValor >= 0 ? 'devedora' : 'credora',
      registro,
      codigo,
      nome: `${imposto} · NFe SEFAZ · ${creditos.length} operação(ões)`,
      descricao: `${imposto} a recuperar · importado de NF-e SEFAZ · total ${creditos.length} operação(ões)`,
      imposto,
      valor: totalValor,
      linha: linha++,
      data: dtFin,
    });
  }

  // Criar items de impostos agrupados
  if (cache.creditosSugeridos?.length) {
    const totalPorTipo = new Map<string, number>();
    for (const c of cache.creditosSugeridos) {
      const tipo = c.tipo.toUpperCase();
      totalPorTipo.set(tipo, (totalPorTipo.get(tipo) ?? 0) + c.valor);
    }

    for (const [tipo, total] of totalPorTipo) {
      itens.push({
        kind: 'imposto',
        natureza: 'devedora',
        registro: 'C100',
        codigo: tipo.slice(0, 3),
        nome: `${tipo} · Consolidação`,
        descricao: `${tipo} consolidado · importado de NF-e SEFAZ`,
        imposto: tipo,
        valor: total,
        linha: linha++,
        data: '0000', // Períod
      });
    }
  }

  const parsed: ParsedSpedFiscal = {
    tipo: 'CONTRIBUICOES',
    fileName: `SEFAZ_NFe_${mm}${yyyy}_${cache.ufSync || 'BR'}.txt`,
    cnpj: cnpj.replace(/\D/g, ''),
    empresa: companyName,
    dtIni,
    dtFin,
    dtFinLabel: `NFe SEFAZ ${cache.ufSync} · ${dd}/${mm}/${yyyy}`,
    itens,
    notasFiscais: convertNotasParaSpedFormat(cache.notas ?? []),
    issues: [],
  };

  return parsed;
}

/**
 * Converte notas fiscais do cache em formato SpedNotaFiscal.
 * As notas são usadas para aparecer nos acumuladores.
 */
function convertNotasParaSpedFormat(notas: NfeNotaResumo[]): SpedNotaFiscal[] {
  return notas.map((n) => ({
    linha: 0,
    chave: n.chave,
    numero: n.numero,
    serie: n.serie,
    data: n.emissao || '00000000',
    nomeParticipante: n.emitente,
    emitente: n.emitente,
    participante: n.emitente,
    cfop: '1949', // CFOP genérico de entrada
    descricao: `NFe ${n.numero}/${n.serie}`,
    valorTotal: n.total ?? 0,
    valorIcms: 0, // Será preenchido pelos créditos
    valorPis: 0,
    valorCofins: 0,
    valorIpi: 0,
    codParticipante: '',
    cstIcms: '',
    codContribuicao: '',
  })) as SpedNotaFiscal[];
}

/**
 * Salva um arquivo SPED virtual criado a partir do cache de NFs.
 * Integra o arquivo com os já existentes.
 */
export function saveSpedFromNfeCache(
  companyName: string,
  cache: PricingNfeCache,
  cnpj: string,
): boolean {
  const parsed = createSpedFromNfeCache(cache, companyName, cnpj);
  if (!parsed) return false;

  const novoArquivo: FiscalSpedArquivoSalvo = {
    id: `nfe-sefaz-${Date.now()}`,
    parsed,
  };

  // Carregar arquivos existentes
  const existentes = readManagerData<FiscalSpedArquivoSalvo>(companyName, 'fiscalSped') ?? [];

  // Adicionar novo arquivo
  const todos = [...existentes, novoArquivo];

  // Salvar
  writeManagerData(companyName, 'fiscalSped', todos);

  return true;
}
