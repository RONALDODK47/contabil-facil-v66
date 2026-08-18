/**
 * Monta os lançamentos contábeis do extrato de aplicação: para cada linha lida
 * do PDF, decide qual conta fica no débito e qual fica no crédito.
 *
 * Vive fora dos componentes porque duas telas dependem do MESMO resultado — a
 * tabela do "Extrato de Aplicações" e a exportação TXT+ Domínio. Se cada uma
 * calculasse os lados por conta própria, o arquivo exportado poderia divergir
 * do que o usuário conferiu na tela.
 */
import type { AplicacaoContaExtrato } from './aplicacaoExtratoStorage';
import type { AplicacaoExtratoRow } from './aplicacaoExtratoParser';
import { aplicacaoRowEntraNaContabilidade } from './aplicacaoExtratoParser';
import { matchAplicacaoRegra, type AplicacaoRegraConta } from './aplicacaoRegrasContasStorage';

export type AplicacaoLancamentoContabil = {
  data: string;
  historico: string;
  valor: number;
  /** Lado da CONTA DA APLICAÇÃO: entrada é débito, resgate é crédito. */
  nature: 'D' | 'C';
  debito: string;
  credito: string;
  /** Lado definido por regra — null quando não há regra casando. */
  lado: 'D' | 'C' | null;
  /** Só é conciliado quando uma regra define a contrapartida. */
  conciliado: boolean;
  /** Provisão (rendimento a pagar / imposto a reter) — ver o parser. */
  provisionado: boolean;
  /** Provisão liberada pelo usuário para entrar na contabilidade. */
  desbloqueado: boolean;
  /** Entra em totais, conciliação e TXT? Provisão bloqueada não entra. */
  contabiliza: boolean;
};

/** Conta que representa a aplicação no plano — cai no nome se não houver código. */
export function contaDaAplicacao(conta: AplicacaoContaExtrato): string {
  return conta.contaContabil?.trim() || conta.nome;
}

/** dd/MM/yyyy → primeiro dia do mês seguinte, no mesmo formato. */
export function primeiroDiaDoMesSeguinte(data: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data.trim());
  if (!m) return '';
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  if (mes < 1 || mes > 12) return '';
  const proximoMes = mes === 12 ? 1 : mes + 1;
  const proximoAno = mes === 12 ? ano + 1 : ano;
  return `01/${String(proximoMes).padStart(2, '0')}/${proximoAno}`;
}

/**
 * Estorno de uma provisão, no primeiro dia do mês seguinte: mesmo valor com o
 * lado invertido, o que zera a provisão contra a própria conta da aplicação.
 *
 * Só existe para provisão liberada — o que está bloqueado nunca foi lançado, e
 * estornar algo que não entrou criaria um lançamento do nada.
 */
export function buildCompensacaoProvisao(row: AplicacaoExtratoRow): AplicacaoExtratoRow | null {
  if (!row.provisionado || row.desbloqueado !== true) return null;
  const data = primeiroDiaDoMesSeguinte(row.data);
  if (!data) return null;
  return {
    data,
    historico: `COMPENSACAO ${row.historico}`,
    entrada: row.saida,
    saida: row.entrada,
    saldo: null,
    provisionado: true,
    desbloqueado: true,
  };
}

/** Provisões liberadas + seus estornos, quando a aplicação pede compensação. */
export function comCompensacoesDeProvisao(conta: AplicacaoContaExtrato): AplicacaoExtratoRow[] {
  if (!conta.compensarProvisao) return conta.rows;
  const extras = conta.rows
    .map(buildCompensacaoProvisao)
    .filter((r): r is AplicacaoExtratoRow => r !== null);
  return [...conta.rows, ...extras];
}

export function buildAplicacaoLancamentoContabil(
  row: AplicacaoExtratoRow,
  conta: AplicacaoContaExtrato,
  regrasDaConta: AplicacaoRegraConta[],
): AplicacaoLancamentoContabil {
  const nature: 'D' | 'C' = row.saida > 0 ? 'C' : 'D';
  const valor = row.saida > 0 ? row.saida : row.entrada;
  const regra = matchAplicacaoRegra(regrasDaConta, row.historico, nature);
  const contaAplicacao = contaDaAplicacao(conta);

  // A natureza da regra é o lado da CONTA DA APLICAÇÃO; a contrapartida fica do
  // outro lado.
  //
  // Sem regra, a conta da aplicação já ocupa o lado dela assim mesmo: esse lado
  // não depende de regra nenhuma — sai do próprio extrato (entrada na aplicação
  // é débito, resgate é crédito) e a conta é a que foi escolhida na extração.
  // Quem falta é só a CONTRAPARTIDA, que fica em branco até uma regra dizer
  // qual é. Enquanto isso, o lançamento não conta como conciliado nem entra no
  // TXT do Domínio, que exige as duas pontas.
  return {
    data: row.data,
    historico: row.historico,
    valor,
    nature,
    debito: regra
      ? (regra.nature === 'D' ? contaAplicacao : regra.contaContrapartida)
      : (nature === 'D' ? contaAplicacao : ''),
    credito: regra
      ? (regra.nature === 'D' ? regra.contaContrapartida : contaAplicacao)
      : (nature === 'C' ? contaAplicacao : ''),
    lado: regra ? regra.nature : null,
    conciliado: Boolean(regra),
    provisionado: row.provisionado === true,
    desbloqueado: row.desbloqueado === true,
    contabiliza: aplicacaoRowEntraNaContabilidade(row),
  };
}
