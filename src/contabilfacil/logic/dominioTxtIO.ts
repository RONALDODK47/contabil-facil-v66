import { parseISO, isValid, format } from 'date-fns';
import { downloadDominioTXT } from '../../lib/dominioExporter';
import { montarLinhaTxtDominio } from '../../lib/dominioTxtLinha';
import {
  isDominioLancamentosHeaderLine,
  isDominioLancamentosTxt,
  parseDominioLancamentosTxt,
  readTextFileSmart,
  findSubsetSum,
} from '../../extratoVision/utils/dominioLancamentosTxt';
import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { isCnpjLike } from '../../lib/cnpjGuard';

// Re-export parseTxtPlusToRazaoVision from contabilPipeline for compatibility
export { parseTxtPlusToRazaoVision } from './contabilPipeline';

export { isDominioLancamentosTxt, readTextFileSmart };

export function brDateToIso(data: string | undefined): string {
  const t = String(data ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/);
  if (!m) return new Date().toISOString().split('T')[0];
  const yearPart = m[3] ?? String(new Date().getFullYear());
  const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;
  return `${year}-${m[2]}-${m[1]}`;
}

function parseDateForDominio(dateStr: string): Date {
  const iso = brDateToIso(dateStr);
  const d = parseISO(iso);
  return isValid(d) ? d : new Date();
}

export type BalanceteImportRow = {
  id: string;
  dataInicio: string;
  codigo: string;
  classificacao: string;
  descricao: string;
  saldoInicial: number;
  debito: number;
  credito: number;
  saldoFinal: number;
  natureza: 'D' | 'C';
};

export type FolhaRelatorioImportRow = {
  id: string;
  date: string;
  description: string;
  debito: number;
  credito: number;
  /** Tipo de rubrica conforme seção do PDF: PROVENTOS, DESCONTOS ou INFORMATIVA. */
  tipo?: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA';
  /**
   * Cabeçalho "Cálculo:" do relatório de origem — "Folha Mensal", "Rescisão", "Folha Mensal e
   * Complementar". Num relatório só de rescisão, TODA rubrica é verba rescisória, mesmo as que
   * não têm "rescisão" no nome (saldo de salário, DSR).
   */
  tipoCalculo?: string;
};

export type ExtratoExportRow = {
  date: string;
  description: string;
  value: number;
  nature: 'D' | 'C';
  accountDebit?: string;
  accountCredit?: string;
  /** Fallback legado (só banco) quando D/C ainda não foram preenchidos. */
  accountCode?: string;
  operationName?: string;
};

function digitsOnly(code: string | undefined): string {
  return String(code ?? '').replace(/\D/g, '');
}

/**
 * Monta a partida Domínio a partir da linha do extrato.
 * Entrada (C): banco no DÉBITO · Saída (D): banco no CRÉDITO.
 * Nunca devolve débito = crédito.
 */
export function resolvePartidaDominioExtrato(
  row: ExtratoExportRow,
  contaBancoPreferida?: string,
): { contaDebito: string; contaCredito: string } | null {
  const banco = digitsOnly(contaBancoPreferida);
  let deb = digitsOnly(row.accountDebit);
  let cred = digitsOnly(row.accountCredit);
  const code = digitsOnly(row.accountCode);

  // Completa lado do banco com accountCode legado, se faltar
  if (code) {
    if (row.nature === 'C' && !deb) deb = code;
    if (row.nature === 'D' && !cred) cred = code;
  }

  const pickContra = (a: string, b: string): string => {
    if (banco) {
      const bNum = contaDominioNum(banco);
      if (a && contaDominioNum(a) !== bNum) return a;
      if (b && contaDominioNum(b) !== bNum) return b;
      return '';
    }
    return a || b || '';
  };

  if (banco) {
    const bNum = contaDominioNum(banco);
    if (row.nature === 'C') {
      const contra = pickContra(cred, deb);
      // Se contra for igual ao banco (mesmo ignorando zeros), é erro de partida dobrada (D=C).
      if (contra && contaDominioNum(contra) === bNum) return null;
      return { contaDebito: banco, contaCredito: contra || '' };
    }
    const contra = pickContra(deb, cred);
    if (contra && contaDominioNum(contra) === bNum) return null;
    return { contaDebito: contra || '', contaCredito: banco };
  }

  // Sem conta banco preferida: usa o par já gravado, se válido
  if (deb && cred && contaDominioNum(deb) !== contaDominioNum(cred)) {
    return { contaDebito: deb, contaCredito: cred };
  }

  // Se o usuário quer "todos os lançamentos", e só temos um lado,
  // exporta com o outro vazio (Domínio reportará o erro, mas a linha estará lá).
  if (deb || cred) {
    return { contaDebito: deb, contaCredito: cred };
  }

  return null;
}

/**
 * Conta reduzida válida para TXT+ Domínio (não vazia, não zero, não classificação estruturada).
 * - Aceita apenas códigos puramente numéricos (ex.: "8", "1106", "0000008").
 * - Rejeita classificações estruturadas com pontos (ex.: "1.1.1.01.00001") —
 *   se tivéssemos removido os pontos, "1.1.1.01.00001" viraria "11101000001",
 *   um número inexistente no Domínio que faz o lançamento ser importado na conta errada.
 */
function contaDominioValida(raw: string | undefined): string {
  const s = String(raw ?? '').trim();
  // Classificação estruturada (com ponto) não é código reduzido — rejeita.
  if (s.includes('.')) return '';
  const digits = s.replace(/\D/g, '');
  if (!digits || /^0+$/.test(digits)) return '';
  return digits;
}

/** Só para comparar se duas contas são a MESMA conta — ignora padding de zero. */
function contaDominioNum(conta: string): string {
  return conta.replace(/^0+(?=\d)/, '');
}

/**
 * Saldo da conta que vazou para o fim do histórico na leitura do extrato —
 * ex.: "PAGAMENTO PIX 01852649135 RODRIGO RODRIGUES DA S -687,90". É sempre o
 * saldo DEVEDOR do dia (por isso o sinal negativo obrigatório), o mesmo valor
 * que dispara o lançamento automático de garantia logo em seguida.
 *
 * O sinal é a salvaguarda: um histórico pode legitimamente terminar em valor
 * ("PAGAMENTO NF 1234 1.500,00") e esse não é tocado — só o token assinado sai.
 */
const RE_SALDO_VAZADO_NO_FIM = /\s[-+]\d{1,3}(?:\.\d{3})*,\d{2}\s*$/;

function limparSaldoVazado(texto: string): string {
  let out = texto;
  // Pode ter vazado mais de um saldo na mesma linha (dias encadeados).
  while (RE_SALDO_VAZADO_NO_FIM.test(out)) {
    const cortado = out.replace(RE_SALDO_VAZADO_NO_FIM, '').trim();
    // Nunca esvazia o histórico: se não sobrar texto, mantém o original.
    if (!/[A-Za-zÀ-ÿ]/.test(cortado)) break;
    out = cortado;
  }
  return out;
}

function histKeyDominio(nome: string | undefined): string {
  return limparSaldoVazado(
    String(nome ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' '),
  );
}

/**
 * Agrupa linhas do razão em partidas dobradas (débito+crédito) para export TXT+.
 *
 * Aceita:
 * - linhas já com contaDeb+contaCred (extrato/conciliação);
 * - pares Domínio identificados pelo mesmo número de `ordem` na mesma data;
 * - fallback: mesma data + mesmo valor (sem exigir histórico igual).
 *
 * REGRA FUNDAMENTAL: a chave de agrupamento por `ordem` NÃO inclui o histórico
 * porque, no razão do Domínio, a linha de DÉBITO e a linha de CRÉDITO do mesmo
 * lançamento compartilham a mesma `ordem` mas frequentemente têm `nome` distintos
 * (ex.: a linha da conta Banco tem o histórico do banco, a linha da contra-conta
 * tem o histórico da operação).  Incluir o nome na chave causa o agrupamento
 * separado das duas linhas e elas nunca são emparelhadas → lançamento some do TXT.
 */
type PairedMovement = {
  date: string;
  historico: string;
  debito: number;
  credito: number;
  contaDeb: string;
  contaCred: string;
};

function pairDominioMovementRows(rows: VisionBalanceteRow[]): PairedMovement[] {
  return pairDominioMovementRowsCore(rows).paired;
}

/**
 * Igual a `pairDominioMovementRows`, mas também devolve as linhas do razão que
 * ficaram de fora do TXT (nenhum dos 4 passos conseguiu achar um par válido) —
 * usado para diagnosticar exatamente qual lançamento "sumiu" quando a soma do
 * TXT não bate com o razão, em vez de precisar adivinhar pelo código.
 */
/**
 * A linha do razão pertence à conta `codigo`; logo, o lado da partida que
 * corresponde ao seu valor TEM de apontar para essa conta. Quando `contaDeb` e
 * `contaCred` não citam a conta da própria linha, os campos ficaram para trás de
 * alguma edição (reclassificação/transferência copiava a partida original ao
 * mover o lançamento de conta). Exportar assim reemite a partida ANTIGA: o valor
 * duplica nas duas contas originais e a conta nova nunca recebe nada no TXT.
 * Aqui o vínculo é reancorado na conta da linha, que é a fonte da verdade.
 */
function reancorarPartidaNaContaDaLinha(row: VisionBalanceteRow): VisionBalanceteRow {
  const contaLinha = contaDominioValida(row.codigo);
  if (!contaLinha) return row;
  const deb = contaDominioValida(row.contaDeb);
  const cred = contaDominioValida(row.contaCred);
  if (!deb || !cred) return row;
  const num = contaDominioNum(contaLinha);
  if (contaDominioNum(deb) === num || contaDominioNum(cred) === num) return row;
  const ehDebito = (row.debito ?? 0) > 0;
  const ehCredito = (row.credito ?? 0) > 0;
  if (ehDebito === ehCredito) return row; // sem lado definido — não há o que reancorar
  return ehDebito ? { ...row, contaDeb: contaLinha } : { ...row, contaCred: contaLinha };
}

function pairDominioMovementRowsCore(rowsBrutas: VisionBalanceteRow[]): {
  paired: PairedMovement[];
  leftover: VisionBalanceteRow[];
} {
  const rows = rowsBrutas.map(reancorarPartidaNaContaDaLinha);
  const out: PairedMovement[] = [];
  const seen = new Set<string>();
  // Linhas já emitidas (por qualquer passo) não podem ser reaproveitadas por um passo
  // seguinte — senão a mesma linha de débito pode ser "gasta" de novo com outro crédito
  // e o export soma mais do que existe no razão.
  const consumed = new Set<VisionBalanceteRow>();

  /**
   * Registra a partida se válida e ainda não presente.
   * A chave inclui a `ordem` quando disponível para que lançamentos legítimos
   * com mesmo perfil contábil mas sequências distintas no razão gerem linhas
   * separadas no TXT (ex.: dois pagamentos idênticos no mesmo dia).
   */
  const pushIfValid = (
    p: {
      date: string;
      historico: string;
      debito: number;
      credito: number;
      contaDeb: string;
      contaCred: string;
    },
    ordemRef?: number,
  ) => {
    const deb = contaDominioValida(p.contaDeb);
    const cred = contaDominioValida(p.contaCred);
    const valor = Math.max(p.debito, p.credito);
    if (!deb || !cred || contaDominioNum(deb) === contaDominioNum(cred) || !(valor > 0)) return;

    // Quando a ordem está disponível ela distingue lançamentos iguais no
    // mesmo dia; sem ordem usamos a chave clássica data+contas+valor.
    const ordemSuffix =
      ordemRef != null && Number.isFinite(ordemRef) ? `|ord:${ordemRef}` : '';
    const key = `${p.date}|${deb}|${cred}|${valor.toFixed(2)}${ordemSuffix}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      date: p.date,
      historico: histKeyDominio(p.historico) || 'LANCAMENTO',
      debito: valor,
      credito: valor,
      contaDeb: deb,
      contaCred: cred,
    });
  };

  // ─── Passo 1 ─────────────────────────────────────────────────────────────
  // Partidas já marcadas com as duas contas (extrato → razão).
  // Estas são as mais confiáveis: débito E crédito já estão na mesma linha.
  for (const row of rows) {
    if (consumed.has(row)) continue;
    if ((row.saldoInicial ?? 0) > 0 && row.debito === 0 && row.credito === 0) continue;
    const deb = contaDominioValida(row.contaDeb);
    const cred = contaDominioValida(row.contaCred);
    if (!deb || !cred) continue;
    const valor = Math.max(row.debito ?? 0, row.credito ?? 0);
    if (!(valor > 0)) continue;
    consumed.add(row);

    // Encontra e consome a contraparte correspondente no razão para evitar duplicidade de exportação e falsos órfãos.
    // Permite compensação com janela de até 10 dias e priorização de histórico, assim como no Passo 5.
    // Prioridade de desambiguação (maior para menor):
    //   1. Mesma partida (contaDeb/contaCred idênticos + mesma ordem) → par natural garantido
    //   2. Mesmo histórico
    //   3. Data mais próxima
    const isDeb = (row.debito ?? 0) > 0;
    const contaProcurada = isDeb ? cred : deb;
    const procNum = contaDominioNum(contaProcurada);
    const rowTime = parseDateForDominio(row.data ?? '').getTime();
    const rowHist = histKeyDominio(row.nome ?? row.historico);
    const rowDebNum = contaDominioNum(deb);
    const rowCredNum = contaDominioNum(cred);

    let bestIdx = -1;
    let bestDiff = Infinity;
    let bestHistMatch = false;
    let bestMesmaPartida = false;
    let bestContaBate = false;
    let bestScore = -Infinity;
    let bestConta = '';

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r === row || consumed.has(r)) continue;

      const valR = Math.max(r.debito ?? 0, r.credito ?? 0);
      if (Math.abs(valR - valor) > 0.009) continue;

      const rIsDeb = (r.debito ?? 0) > 0;
      if (rIsDeb === isDeb) continue;

      const rConta = contaDominioValida(r.codigo);
      if (!rConta) continue;
      const contaBate = contaDominioNum(rConta) === procNum;
      /**
       * Contraparte "adotada": a linha não está na conta que `contaDeb/contaCred`
       * aponta, mas ela própria aponta de volta para ESTA linha. É o caso de um
       * lançamento reclassificado — a perna foi movida para outra conta e este
       * lado ficou com a contrapartida antiga. A linha REAL do razão manda sobre
       * o campo; sem isso o TXT emitia a partida velha (valor duplicado na conta
       * original) e a conta nova nunca recebia o lançamento.
       */
      const rDebNumRef = contaDominioNum(contaDominioValida(r.contaDeb) || '');
      const rCredNumRef = contaDominioNum(contaDominioValida(r.contaCred) || '');
      const contaDestaLinha = contaDominioNum(contaDominioValida(row.codigo) || '');
      const apontaDeVolta =
        contaDestaLinha !== '' &&
        (isDeb ? rDebNumRef === contaDestaLinha : rCredNumRef === contaDestaLinha);
      if (!contaBate && !apontaDeVolta) continue;

      const rTime = parseDateForDominio(r.data ?? '').getTime();
      if (!Number.isFinite(rowTime) || !Number.isFinite(rTime)) continue;

      const diffDias = Math.abs(rTime - rowTime) / 86_400_000;
      if (diffDias > 10) continue;

      // Mesma partida = mesmos contaDeb/contaCred E mesma ordem → par natural, prioridade máxima.
      const rDebNum = contaDominioNum(contaDominioValida(r.contaDeb) || '');
      const rCredNum = contaDominioNum(contaDominioValida(r.contaCred) || '');
      const mesmaPartida =
        row.ordem != null &&
        r.ordem === row.ordem &&
        rDebNum === rowDebNum &&
        rCredNum === rowCredNum;

      const histMatch = Boolean(rowHist) && histKeyDominio(r.nome ?? r.historico) === rowHist;
      /**
       * Pontuação de desambiguação (maior vence). O MESMO DIA pesa mais que a
       * conta indicada em `contaDeb/contaCred`: antes a conta indicada tinha
       * prioridade absoluta e, dentro da janela de 10 dias, o lançamento roubava
       * o par de outro dia — emitindo uma partida com a conta antiga e deixando
       * a contraparte real do próprio dia órfã (duplicando valor no TXT).
       */
      const score =
        (mesmaPartida ? 1000 : 0) +
        (diffDias < 0.5 ? 200 : 0) +
        (contaBate ? 100 : 0) +
        (histMatch ? 10 : 0) -
        diffDias;

      if (bestIdx < 0 || score > bestScore) {
        bestScore = score;
        bestDiff = diffDias;
        bestIdx = i;
        bestHistMatch = histMatch;
        bestMesmaPartida = mesmaPartida;
        bestContaBate = contaBate;
        bestConta = rConta;
      }
    }

    // A conta da contraparte REAL encontrada define o outro lado da partida.
    // Só cai no campo `contaDeb/contaCred` quando nenhuma contraparte foi achada.
    const contraparteConta = bestIdx >= 0 && bestConta ? bestConta : contaProcurada;
    pushIfValid(
      {
        date: row.data ?? '',
        historico: row.nome ?? row.historico ?? 'LANCAMENTO',
        debito: valor,
        credito: valor,
        contaDeb: isDeb ? deb : contraparteConta,
        contaCred: isDeb ? contraparteConta : cred,
      },
      row.ordem,
    );

    if (bestIdx >= 0) {
      consumed.add(rows[bestIdx]);
    }
  }

  /** Linhas ainda sem par, candidatas aos passos seguintes. */
  const remaining = (): VisionBalanceteRow[] =>
    rows.filter((r) => {
      if (consumed.has(r)) return false;
      if ((r.saldoInicial ?? 0) > 0 && r.debito === 0 && r.credito === 0) return false;
      return r.debito > 0 || r.credito > 0;
    });

  // ─── Passo 2 ─────────────────────────────────────────────────────────────
  // Pares clássicos Domínio: linhas separadas por conta, emparelhadas pelo
  // número de `ordem` dentro da mesma data.
  //
  // ⚠️  A chave NÃO inclui o histórico (nome).
  //     No razão do Domínio, a linha de débito de um lançamento pode ter
  //     um histórico completamente diferente da linha de crédito do mesmo
  //     lançamento (ex.: Banco → "BANCO DO BRASIL AG:1269-6 CC: 49352",
  //     contra-conta → "PAGAMENTO NF 1234").  Se incluirmos o nome na chave,
  //     as duas linhas ficam em grupos separados e o lançamento desaparece
  //     do TXT exportado — exatamente o bug relatado.
  const consumeGroup = (group: VisionBalanceteRow[]) => {
    const debRows = group.filter((r) => r.debito > 0 && !consumed.has(r));
    const credRows = group.filter((r) => r.credito > 0 && !consumed.has(r));
    const usedCred = new Set<number>();

    for (const deb of debRows) {
      const contaDeb = contaDominioValida(deb.contaDeb) || contaDominioValida(deb.codigo);
      if (!contaDeb) continue;
      const valorDeb = deb.debito;
      const candidatos: number[] = [];
      for (let i = 0; i < credRows.length; i++) {
        if (usedCred.has(i)) continue;
        const cred = credRows[i];
        if (Math.abs((cred.credito ?? 0) - valorDeb) > 0.009) continue;
        const contaCred = contaDominioValida(cred.contaCred) || contaDominioValida(cred.codigo);
        if (!contaCred || contaDominioNum(contaCred) === contaDominioNum(contaDeb)) continue;
        candidatos.push(i);
      }
      if (candidatos.length === 0) continue;
      // Quando o grupo tem mais de um candidato de mesmo valor (colisão), prioriza
      // quem tem o MESMO histórico — evita "roubar" o par certo de um lançamento
      // e deixar outro (de valor igual, mas conta/operação diferente) órfão.
      let matchIdx = candidatos[0];
      if (candidatos.length > 1) {
        const debHist = histKeyDominio(deb.nome ?? deb.historico);
        if (debHist) {
          const porHistorico = candidatos.find(
            (i) => histKeyDominio(credRows[i].nome ?? credRows[i].historico) === debHist,
          );
          if (porHistorico != null) matchIdx = porHistorico;
        }
      }
      usedCred.add(matchIdx);
      const cred = credRows[matchIdx];
      const ordemRef = deb.ordem ?? cred.ordem;
      pushIfValid(
        {
          date: deb.data ?? cred.data ?? '',
          historico: deb.nome ?? cred.nome ?? 'LANCAMENTO',
          debito: valorDeb,
          credito: cred.credito,
          contaDeb,
          contaCred: contaDominioValida(cred.contaCred) || contaDominioValida(cred.codigo),
        },
        ordemRef,
      );
      consumed.add(deb);
      consumed.add(cred);
    }
  };

  const byOrdem = new Map<string, VisionBalanceteRow[]>();
  for (const row of remaining()) {
    if (row.ordem == null || !Number.isFinite(row.ordem)) continue;
    const ordemKey = `${row.data ?? ''}|ord:${row.ordem}`;
    const list = byOrdem.get(ordemKey) ?? [];
    list.push(row);
    byOrdem.set(ordemKey, list);
  }
  // Emparelha pelos grupos com `ordem` (mais preciso).
  for (const group of byOrdem.values()) consumeGroup(group);

  // ─── Passo 3 ─────────────────────────────────────────────────────────────
  // Fallback: mesma data + mesmo valor, SEM histórico. Captura pares cujas
  // linhas não têm `ordem` ou têm ordens diferentes mas pertencem ao mesmo
  // lançamento (cenário legado / extrato manual / lançamentos gerados pelas
  // automações internas, que numeram débito e crédito com `ordem` seguidas).
  const byValorData = new Map<string, VisionBalanceteRow[]>();
  for (const row of remaining()) {
    const valor = Math.max(row.debito ?? 0, row.credito ?? 0);
    if (!(valor > 0)) continue;
    const vdKey = `${row.data ?? ''}|v:${valor.toFixed(2)}`;
    const listV = byValorData.get(vdKey) ?? [];
    listV.push(row);
    byValorData.set(vdKey, listV);
  }
  for (const group of byValorData.values()) consumeGroup(group);

  // ─── Passo 4 ─────────────────────────────────────────────────────────────
  // Partida composta / rateio: o que sobrar depois dos passos acima e ainda
  // assim fechar em valor (débito total = crédito total) na mesma data é, com
  // altíssima probabilidade, UM lançamento só dividido em várias contas — ex.:
  // um recebimento de banco rateado em 3 contas de receita, ou um pagamento
  // dividido em várias contas de despesa (o comentário sobre "lote de
  // crédito/débito puro" em dominioLancamentosTxt.ts é exatamente esse caso:
  // cada conta chega em um registro "03" separado, sem par 1-para-1 exato).
  // O TXT+ Domínio só aceita 1 débito + 1 crédito por linha, então a sobra é
  // distribuída em cascata (ordem do razão) até esgotar os dois lados —
  // sem isso, essas partidas somem inteiras do TXT exportado, mesmo aparecendo
  // certinhas no razão em tela.
  const byData = new Map<string, VisionBalanceteRow[]>();
  for (const row of remaining()) {
    const key = row.data ?? '';
    const list = byData.get(key) ?? [];
    list.push(row);
    byData.set(key, list);
  }
  for (const group of byData.values()) {
    const debRows = group.filter((r) => r.debito > 0 && !consumed.has(r));
    const credRows = group.filter((r) => r.credito > 0 && !consumed.has(r));
    if (debRows.length === 0 || credRows.length === 0) continue;

    const totalDeb = debRows.reduce((s, r) => s + (r.debito ?? 0), 0);
    const totalCred = credRows.reduce((s, r) => s + (r.credito ?? 0), 0);
    // Só distribui quando os dois lados batem — senão é dado órfão/incompleto
    // (import quebrado, período cortando um lançamento ao meio, etc.) e
    // inventar uma linha com valor errado seria pior do que deixar de fora.
    if (Math.abs(totalDeb - totalCred) > 0.02) continue;

    let di = 0;
    let ci = 0;
    let debRemain = debRows[0].debito ?? 0;
    let credRemain = credRows[0].credito ?? 0;
    let waterfallSeq = 0;
    while (di < debRows.length && ci < credRows.length) {
      const deb = debRows[di];
      const cred = credRows[ci];
      const amt = Math.min(debRemain, credRemain);
      if (amt > 0.004) {
        const contaDeb = contaDominioValida(deb.contaDeb) || contaDominioValida(deb.codigo);
        const contaCred = contaDominioValida(cred.contaCred) || contaDominioValida(cred.codigo);
        if (contaDeb && contaCred && contaDominioNum(contaDeb) !== contaDominioNum(contaCred)) {
          pushIfValid(
            {
              date: deb.data ?? cred.data ?? '',
              historico: deb.nome ?? cred.nome ?? 'LANCAMENTO',
              debito: amt,
              credito: amt,
              contaDeb,
              contaCred,
            },
            // Chave sintética fora da faixa de `ordem` real, só para não
            // colidir no dedup de `seen` entre linhas geradas aqui.
            9_000_000 + waterfallSeq++,
          );
        }
      }
      debRemain = Math.round((debRemain - amt) * 100) / 100;
      credRemain = Math.round((credRemain - amt) * 100) / 100;
      if (debRemain <= 0.004) {
        consumed.add(deb);
        di++;
        debRemain = debRows[di]?.debito ?? 0;
      }
      if (credRemain <= 0.004) {
        consumed.add(cred);
        ci++;
        credRemain = credRows[ci]?.credito ?? 0;
      }
    }
  }

  // ─── Passo 5 ─────────────────────────────────────────────────────────────
  // Janela de datas: um boleto (ou qualquer compensação bancária) tem a perna
  // da despesa/fornecedor lançada na data de pagamento/vencimento, mas a perna
  // do banco só compensa (e é lançada) 1-3 dias depois — mesmo valor, mesma
  // operação, mas SEM data igual. Todos os passos acima exigem data idêntica,
  // então esses lançamentos ficavam de fora do TXT mesmo com as duas pernas
  // presentes no razão (o usuário só não notava porque a tela agrupa por conta,
  // não por data exata). Aqui casamos por valor exato dentro de uma janela de
  // alguns dias, priorizando sempre a data mais próxima disponível.
  // Boletos costumam levar mais que 5 dias corridos pra compensar em torno de
  // feriados/fins de semana prolongados — 10 dias corridos cobre isso com folga
  // sem abrir mão do exato: valor exato continua obrigatório, só a data afrouxa.
  const JANELA_DIAS_COMPENSACAO = 10;
  const sobrasFinal = remaining();
  const debSobra = sobrasFinal.filter((r) => r.debito > 0);
  const credSobra = sobrasFinal.filter((r) => r.credito > 0);
  const usedCredSobra = new Set<number>();

  for (const deb of debSobra) {
    if (consumed.has(deb)) continue;
    const contaDeb = contaDominioValida(deb.contaDeb) || contaDominioValida(deb.codigo);
    if (!contaDeb) continue;
    const debTime = parseDateForDominio(deb.data ?? '').getTime();
    if (!Number.isFinite(debTime)) continue;
    const debHist = histKeyDominio(deb.nome ?? deb.historico);

    // Dentro da janela, um candidato com o MESMO histórico do débito ganha de
    // qualquer candidato só pela data mais próxima — evita cruzar lançamentos
    // que só coincidem em valor (ex.: 3 boletos idênticos de fornecedores
    // diferentes na mesma semana) com a contraparte errada.
    let bestIdx = -1;
    let bestDiff = Infinity;
    let bestHistMatch = false;
    for (let i = 0; i < credSobra.length; i++) {
      if (usedCredSobra.has(i)) continue;
      const cred = credSobra[i];
      if (consumed.has(cred)) continue;
      if (Math.abs((cred.credito ?? 0) - (deb.debito ?? 0)) > 0.009) continue;
      const contaCred = contaDominioValida(cred.contaCred) || contaDominioValida(cred.codigo);
      if (!contaCred || contaDominioNum(contaCred) === contaDominioNum(contaDeb)) continue;
      const credTime = parseDateForDominio(cred.data ?? '').getTime();
      if (!Number.isFinite(credTime)) continue;
      const diffDias = Math.abs(credTime - debTime) / 86_400_000;
      if (diffDias > JANELA_DIAS_COMPENSACAO) continue;
      const histMatch = Boolean(debHist) && histKeyDominio(cred.nome ?? cred.historico) === debHist;
      const melhor =
        bestIdx < 0 ||
        (histMatch && !bestHistMatch) ||
        (histMatch === bestHistMatch && diffDias < bestDiff);
      if (melhor) {
        bestDiff = diffDias;
        bestIdx = i;
        bestHistMatch = histMatch;
      }
    }
    if (bestIdx < 0) continue;
    usedCredSobra.add(bestIdx);
    const cred = credSobra[bestIdx];
    const contaCred = contaDominioValida(cred.contaCred) || contaDominioValida(cred.codigo);
    pushIfValid(
      {
        // Mantém a data do débito (data do lançamento/vencimento) — é a que o
        // usuário vê e confere no razão, mesmo a compensação bancária sendo
        // registrada alguns dias depois.
        date: deb.data ?? cred.data ?? '',
        historico: deb.nome ?? cred.nome ?? 'LANCAMENTO',
        debito: deb.debito,
        credito: cred.credito,
        contaDeb,
        contaCred,
      },
      deb.ordem ?? cred.ordem,
    );
    consumed.add(deb);
    consumed.add(cred);
  }

  return { paired: out, leftover: remaining() };
}

/**
 * Linhas do razão que NÃO entraram no TXT+ exportado (nenhum dos passos de
 * pareamento achou uma contraparte válida) — para descobrir exatamente qual
 * lançamento está faltando quando a soma do TXT importado no Domínio não bate
 * com o razão, em vez de precisar adivinhar pelo código.
 */
export function encontrarLancamentosNaoExportados(
  rows: VisionBalanceteRow[],
): VisionBalanceteRow[] {
  return pairDominioMovementRowsCore(rows).leftover;
}

/**
 * Detecção PRECISA de lançamentos sem contrapartida (falta uma perna de débito
 * ou crédito). Diferente de `encontrarLancamentosNaoExportados` (que usa
 * pareamento agressivo para export TXT), esta função só considera um lançamento
 * como "com contrapartida" quando existe REAL correspondência:
 *
 * 1. Entradas com mesma `data + ordem` formam um lançamento completo se têm
 *    ambos os lados (débito E crédito).
 * 2. Para entradas sem `ordem`: pareamento estrito por MESMA data + MESMO
 *    valor + conta DIFERENTE (sem janela de dias, sem partida composta).
 * 3. O que sobrar → sem contrapartida.
 */
export function detectarLancamentosSemContrapartida(
  rows: VisionBalanceteRow[],
): VisionBalanceteRow[] {
  // Só lançamentos com movimento real (débito ou crédito > 0).
  const movimentos = rows.filter(
    (r) => (r.debito ?? 0) > 0 || (r.credito ?? 0) > 0,
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // REGRA (definição do usuário):
  // "Sem contrapartida" = a perna do débito OU a perna do crédito NÃO tem conta,
  // ou seja, o lançamento não tem as DUAS partidas (débito e crédito) casadas.
  // Um lançamento COMPLETO tem uma linha débito e uma linha crédito (mesma ordem
  // ou mesmo valor/data) — ambas com conta preenchida. Se falta uma das pernas,
  // é "sem contrapartida".
  // ─────────────────────────────────────────────────────────────────────────────

  const consumidos = new Set<VisionBalanceteRow>();

  // ─── Passo 1: Entrada auto-contida (contaDeb E contaCred já preenchidas) ──
  // "Completo" = tem as DUAS contas (não só os dois valores numéricos) — uma
  // linha com debito/credito preenchidos mas sem contaDeb/contaCred ainda não
  // tem contrapartida real. E as duas contas nunca podem ser a mesma.
  //
  // NOTA: exigir debito>0 E credito>0 na MESMA linha aqui já foi tentado e
  // quebrou o padrão predominante deste dataset — a maioria das linhas tem só
  // UM lado com valor, mas contaDeb+contaCred JÁ preenchidos representando uma
  // partida legitimamente resolvida (ex.: "PAGAMENTO COFINS" com debito>0,
  // credito=0, mas contaDeb/contaCred corretos). Se não fossem aceitas aqui,
  // o Passo 4 (subset-sum por dia) podia parear essas linhas de novo,
  // coincidentemente, com um valor totalmente não relacionado do mesmo dia.
  for (const r of movimentos) {
    const deb = (r.contaDeb ?? '').trim();
    const cred = (r.contaCred ?? '').trim();
    if (deb && cred && deb !== cred) {
      consumidos.add(r);
    }
  }

  // ─── Passo 2: Pareamento por data + ordem (formato Domínio) ───────────────
  // Lançamentos completos têm duas linhas com a MESMA ordem na mesma data:
  // uma com débito e outra com crédito. Se o grupo tem ambos os lados → completo.
  const porOrdem = new Map<string, VisionBalanceteRow[]>();
  for (const r of movimentos) {
    if (consumidos.has(r)) continue;
    if (r.ordem != null && Number.isFinite(r.ordem)) {
      const key = `${r.data ?? ''}|ord:${r.ordem}`;
      const list = porOrdem.get(key) ?? [];
      list.push(r);
      porOrdem.set(key, list);
    }
  }

  for (const group of porOrdem.values()) {
    const contaDe = (r: VisionBalanceteRow) => (r.contaDeb || r.codigo || '').trim();
    const contaCre = (r: VisionBalanceteRow) => (r.contaCred || r.codigo || '').trim();
    const debAccounts = new Set(
      group.filter((r) => (r.debito ?? 0) > 0).map(contaDe).filter(Boolean),
    );
    const credAccounts = new Set(
      group.filter((r) => (r.credito ?? 0) > 0).map(contaCre).filter(Boolean),
    );
    // Só é "completo" se existir pelo menos uma conta de débito DIFERENTE de
    // alguma conta de crédito no grupo — senão é uma partida fechada contra
    // si mesma (mesma conta nos dois lados), o que não é uma contrapartida real.
    const temContrapartidaReal = [...debAccounts].some((d) =>
      [...credAccounts].some((c) => d !== c),
    );
    if (debAccounts.size > 0 && credAccounts.size > 0 && temContrapartidaReal) {
      for (const r of group) consumidos.add(r);
    }
  }

  // ─── Passo 3: Pareamento por data + valor (fallback p/ linhas sem ordem) ──
  // Linhas sem ordem que têm uma conta válida na contrapartida (contaDeb/contaCred)
  // podem ser pareadas com outra linha da mesma data e mesmo valor que tenha o
  // lado oposto. Ex.: linha débito 500,00 em 01/01 + linha crédito 500,00 em 01/01.
  const restantes = movimentos.filter((r) => !consumidos.has(r));
  const porDataValor = new Map<string, VisionBalanceteRow[]>();
  for (const r of restantes) {
    const val = (r.debito ?? 0) > 0 ? r.debito! : r.credito!;
    const key = `${r.data ?? ''}|v:${val.toFixed(2)}`;
    const list = porDataValor.get(key) ?? [];
    list.push(r);
    porDataValor.set(key, list);
  }

  for (const group of porDataValor.values()) {
    if (group.length < 2) continue;
    const debRows = group.filter((r) => (r.debito ?? 0) > 0);
    const credRows = group.filter((r) => (r.credito ?? 0) > 0);
    const contaDe = (r: VisionBalanceteRow) => (r.contaDeb || r.codigo || '').trim();
    const contaCre = (r: VisionBalanceteRow) => (r.contaCred || r.codigo || '').trim();
    const usedCred = new Set<number>();
    // Pareia 1:1 — cada débito com um crédito do mesmo valor/data, mas nunca
    // com a mesma conta (senão não é uma contrapartida real).
    for (const deb of debRows) {
      const contaDeb = contaDe(deb);
      const idx = credRows.findIndex(
        (c, i) => !usedCred.has(i) && (!contaDeb || contaCre(c) !== contaDeb),
      );
      if (idx < 0) continue;
      usedCred.add(idx);
      consumidos.add(deb);
      consumidos.add(credRows[idx]);
    }
  }

  // ─── Passo 4: partidas compostas (N-para-1 / 1-para-N) por data+valor ────
  // Tenta parear combinações de múltiplos débitos com um único crédito (ou
  // vice-versa) dentro da mesma data, mas SOMENTE quando os valores individuais
  // somam exatamente o valor da contraparte. Não usa mais a agregação por data
  // inteira (que marcava tudo como completo se o total do dia fechasse — isso
  // escondia lançamentos realmente sem contrapartida).
  const restantesAposPasso3 = movimentos.filter((r) => !consumidos.has(r));
  const porDataRestantes = new Map<string, VisionBalanceteRow[]>();
  for (const r of restantesAposPasso3) {
    if (!r.data) continue;
    const list = porDataRestantes.get(r.data) ?? [];
    list.push(r);
    porDataRestantes.set(r.data, list);
  }

  for (const [_data, group] of porDataRestantes.entries()) {
    const debs = group.filter((r) => (r.debito ?? 0) > 0);
    const creds = group.filter((r) => (r.credito ?? 0) > 0);
    if (debs.length === 0 || creds.length === 0) continue;

    const consumedDebs = new Set<VisionBalanceteRow>();
    const consumedCreds = new Set<VisionBalanceteRow>();
    const contaDe = (r: VisionBalanceteRow) => (r.contaDeb || r.codigo || '').trim();
    const contaCre = (r: VisionBalanceteRow) => (r.contaCred || r.codigo || '').trim();

    // 1-para-N: um crédito pareado com múltiplos débitos que somam o mesmo valor
    // — nunca aceita um débito da MESMA conta do crédito (não é contrapartida real).
    for (const c of creds) {
      const valC = c.credito ?? 0;
      const contaC = contaCre(c);
      const candidates = debs.filter((d) => !consumedDebs.has(d) && (!contaC || contaDe(d) !== contaC));
      const matchedSubset = findSubsetSum(candidates, valC);
      if (matchedSubset) {
        consumedCreds.add(c);
        consumidos.add(c);
        for (const d of matchedSubset) {
          consumedDebs.add(d);
          consumidos.add(d);
        }
      }
    }

    // N-para-1: um débito pareado com múltiplos créditos que somam o mesmo valor
    for (const d of debs) {
      if (consumedDebs.has(d)) continue;
      const valD = d.debito ?? 0;
      const contaD = contaDe(d);
      const candidates = creds.filter((c) => !consumedCreds.has(c) && (!contaD || contaCre(c) !== contaD));
      const matchedSubset = findSubsetSum(candidates, valD, 'credito');
      if (matchedSubset) {
        consumedDebs.add(d);
        consumidos.add(d);
        for (const c of matchedSubset) {
          consumedCreds.add(c);
          consumidos.add(c);
        }
      }
    }
  }

  // ─── Resultado: tudo que NÃO foi consumido é "sem contrapartida" ──────────
  // São linhas onde UMA das pernas (débito ou crédito) não tem a outra partida.
  return movimentos.filter((r) => !consumidos.has(r));
}

export function visionRowsToBalanceteImports(rows: VisionBalanceteRow[]): BalanceteImportRow[] {
  return rows.map((v, index) => {
    const dataIso = brDateToIso(v.data);
    const debito = v.debito ?? 0;
    const credito = v.credito ?? 0;
    const saldoIni = v.saldoInicial ?? 0;
    return {
      id: `dom-${index}-${v.codigo}-${v.ordem ?? 0}`,
      dataInicio: dataIso,
      codigo: v.codigo ?? '',
      classificacao: v.classificacao ?? v.codigo ?? '',
      descricao: (v.nome ?? 'LANCAMENTO').toUpperCase(),
      saldoInicial: saldoIni,
      debito,
      credito,
      saldoFinal: v.saldoFinal ?? saldoIni + debito - credito,
      natureza: debito >= credito ? 'D' : 'C',
    };
  });
}

export function visionRowsToFolhaRelatorio(rows: VisionBalanceteRow[]): FolhaRelatorioImportRow[] {
  const paired = pairDominioMovementRows(rows);
  return paired.map((p, i) => ({
    id: `folha-dom-${i}-${Date.now()}`,
    date: brDateToIso(p.date),
    description: p.historico,
    debito: p.debito,
    credito: p.credito,
  }));
}

export async function parseDominioTxtFile(text: string): Promise<{
  balancete: BalanceteImportRow[];
  folha: FolhaRelatorioImportRow[];
}> {
  if (!isDominioLancamentosTxt(text)) {
    throw new Error(
      'Arquivo não reconhecido como exportação Domínio (Utilitários > Exportação > Lançamentos).',
    );
  }
  const parsed = parseDominioLancamentosTxt(text);
  if (parsed.length === 0) {
    throw new Error('Nenhum lançamento válido encontrado no TXT Domínio.');
  }
  return {
    balancete: visionRowsToBalanceteImports(parsed),
    folha: visionRowsToFolhaRelatorio(parsed),
  };
}

/**
 * Exporta partidas já conciliadas para TXT+ Domínio.
 * Entrada (C): banco no débito · Saída (D): banco no crédito.
 * Nunca gera linha com Débito = Crédito.
 */
export function buildTxtPlusFromExtratoRows(
  rows: ExtratoExportRow[],
  contaBancoPreferida?: string,
): string {
  const lines: string[] = [];
  for (const row of rows) {
    // row.value vem com sinal (negativo para saídas/débito) — o TXT Domínio
    // nunca usa número negativo, o D/C é expresso só pela coluna (débito vs
    // crédito). Filtrar por `row.value > 0` descartava TODAS as saídas.
    const valorAbsoluto = Math.abs(row.value);
    if (!(valorAbsoluto > 0)) continue;
    const partida = resolvePartidaDominioExtrato(row, contaBancoPreferida);
    if (!partida) continue;
    lines.push(
      montarLinhaTxtDominio({
        date: parseDateForDominio(row.date),
        debContaStr: partida.contaDebito,
        credContaStr: partida.contaCredito,
        value: valorAbsoluto,
        // Usa description (texto original do extrato) — não operationName (que pode ter complemento do sistema).
        historico: (row.description || row.operationName || 'LANCAMENTO').toUpperCase(),
      }),
    );
  }
  return lines.join('\r\n');
}

export function buildTxtPlusFromFolhaRelatorio(
  rows: FolhaRelatorioImportRow[],
  defaultDeb = '1000001',
  defaultCred = '2000001',
): string {
  const lines: string[] = [];
  for (const row of rows) {
    const val = Math.max(row.debito, row.credito);
    if (val <= 0) continue;
    lines.push(
      montarLinhaTxtDominio({
        date: parseDateForDominio(row.date),
        debContaStr: row.debito > 0 ? defaultDeb : defaultCred,
        credContaStr: row.credito > 0 ? defaultCred : defaultDeb,
        value: val,
        historico: row.description,
      }),
    );
  }
  return lines.join('\r\n');
}

export function buildTxtPlusFromBalanceteImports(rows: BalanceteImportRow[]): string {
  const visionLike: VisionBalanceteRow[] = rows.flatMap((r) => {
    const base = { data: format(parseDateForDominio(r.dataInicio), 'dd/MM/yyyy'), nome: r.descricao, ordem: 0 };
    const out: VisionBalanceteRow[] = [];
    if (r.debito > 0) {
      out.push({ ...base, codigo: r.codigo, debito: r.debito, credito: 0, saldoInicial: 0, saldoFinal: 0 });
    }
    if (r.credito > 0) {
      out.push({ ...base, codigo: r.codigo, debito: 0, credito: r.credito, saldoInicial: 0, saldoFinal: 0 });
    }
    return out;
  });
  return buildTxtPlusFromRazaoVision(visionLike);
}

/** Export TXT+ a partir de lançamentos brutos do razão (mesmo motor da interface antiga).
 * Só emite partidas com débito E crédito informados — Domínio rejeita conta 0 / valor unilateral. */
export function buildTxtPlusFromRazaoVision(rows: VisionBalanceteRow[]): string {
  const paired = pairDominioMovementRows(rows);
  const lines = paired.map((p) =>
    montarLinhaTxtDominio({
      date: parseDateForDominio(p.date),
      debContaStr: p.contaDeb,
      credContaStr: p.contaCred,
      value: Math.max(p.debito, p.credito),
      historico: p.historico,
    }),
  );
  return lines.join('\r\n');
}

export function downloadTxtPlusDominio(content: string, filename: string) {
  if (!content.trim()) {
    throw new Error('Nenhuma linha TXT+ Domínio para exportar.');
  }
  downloadDominioTXT(content, filename.endsWith('.txt') ? filename : `${filename}.txt`);
}

function parseTxtPlusValor(raw: string): number {
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

export function isTxtPlusDominio(text: string): boolean {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^01\d/.test(l));
  if (!line) return false;
  const parts = line.split(';');
  if (parts.length < 6) return false;
  return (
    /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(parts[0].trim()) &&
    /^[\d.\s-]+$/.test(parts[1]?.trim() ?? '') &&
    /^[\d.\s-]+$/.test(parts[2]?.trim() ?? '')
  );
}

export function parseTxtPlusToExtratoRows(text: string): ExtratoExportRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: ExtratoExportRow[] = [];
  for (const line of lines) {
    // Registro "01" (cabeçalho com CNPJ) — nunca é lançamento.
    if (isDominioLancamentosHeaderLine(line)) continue;
    // Skip pure SPED format lines (01..., 02..., etc) but allow dates starting with 01/xx (Jan)
    // SPED format check: line starts with 01-03 followed by digits WITHOUT a slash
    // Date format check: line starts with D/MM/YYYY or DD/MM/YYYY
    if (/^0[123](?!\d*\/)/.test(line)) continue;

    const parts = line.split(';');
    if (parts.length < 4) continue;
    const dateStr = parts[0].trim();
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) continue;
    const contaDeb = parts[1]?.trim() ?? '';
    const contaCred = parts[2]?.trim() ?? '';
    const value = parseTxtPlusValor(parts[3] ?? '');
    const historico = (parts[5]?.trim() || parts[4]?.trim() || 'LANCAMENTO').toUpperCase();

    // Linha de cabeçalho com CNPJ vazado no lugar de conta — não é lançamento.
    if (isCnpjLike(contaDeb) || isCnpjLike(contaCred)) continue;

    if (value <= 0) continue;

    const date = brDateToIso(dateStr);
    
    // Single row - stores BOTH debit and credit accounts
    // parseTxtPlusToRazaoVision will expand this into 2 lines for display
    out.push({
      date,
      description: historico,
      value,
      nature: 'D', // default nature for storage
      accountDebit: contaDeb && contaDeb !== '0' ? contaDeb : undefined,
      accountCredit: contaCred && contaCred !== '0' ? contaCred : undefined,
      operationName: historico,
    });
  }
  return out;
}

/**
 * Parse TXT+ para EXTRATO: expande em 2 linhas por transação (uma por conta)
 * Cada linha da partida dobrada vira um movimento separado no extrato.
 */
export function parseTxtPlusToExtratoRowsExpanded(
  text: string,
  contaBancoSelecionada?: string,
): ExtratoExportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^01\d/.test(l));

  const out: ExtratoExportRow[] = [];

  for (const line of lines) {
    const parts = line.split(';');
    if (parts.length < 4) continue;

    const dateStr = parts[0];
    const contaDeb = parts[1]?.trim();
    const contaCred = parts[2]?.trim();
    const valorStr = parts[3];
    const historico = [parts[5], parts[6]].filter(Boolean).join(' ').trim() || 'TXT+';

    // Linha de cabeçalho com CNPJ vazado no lugar de conta — não é lançamento.
    if (isCnpjLike(contaDeb) || isCnpjLike(contaCred)) continue;

    const value = parseTxtPlusValor(valorStr);
    if (!value || value === 0) continue;

    const date = brDateToIso(dateStr);
    const isBankDebit = contaBancoSelecionada && contaDeb === contaBancoSelecionada;
    const isBankCredit = contaBancoSelecionada && contaCred === contaBancoSelecionada;

    // LINHA 1: Conta Débito (entrada para quem recebe, saída para quem envia)
    if (contaDeb && contaDeb !== '0') {
      out.push({
        date,
        description: historico,
        value: isBankDebit ? -value : value, // Negativo se banco é débito (saída)
        nature: isBankDebit ? 'C' : 'D',
        accountDebit: contaDeb,
        accountCredit: contaCred,
        operationName: historico,
      });
    }

    // LINHA 2: Conta Crédito (saída para quem envia, entrada para quem recebe)
    if (contaCred && contaCred !== '0') {
      out.push({
        date,
        description: historico,
        value: isBankCredit ? value : -value, // Negativo se banco é crédito (saída)
        nature: isBankCredit ? 'D' : 'C',
        accountDebit: contaDeb,
        accountCredit: contaCred,
        operationName: historico,
      });
    }
  }
  return out;
}

export function dominioVisionToExtratoRows(rows: VisionBalanceteRow[]): ExtratoExportRow[] {
  return pairDominioMovementRows(rows).map((p) => ({
    date: brDateToIso(p.date),
    description: p.historico,
    value: Math.max(p.debito, p.credito),
    nature: p.debito >= p.credito ? 'D' : 'C',
    accountDebit: p.contaDeb,
    accountCredit: p.contaCred,
    operationName: p.historico,
  }));
}

export function parseTxtPlusToBalanceteImports(text: string): BalanceteImportRow[] {
  return parseTxtPlusToExtratoRows(text).map((row, index) => ({
    id: `txtplus-${index}-${Date.now()}`,
    dataInicio: row.date,
    codigo: row.accountDebit || row.accountCredit || '',
    // Deixa classificacao vazia — será preenchida depois pelo enrichNomeDoPlano buscando no plano de contas
    classificacao: '',
    descricao: row.description,
    saldoInicial: 0,
    debito: row.nature === 'D' ? row.value : 0,
    credito: row.nature === 'C' ? row.value : 0,
    saldoFinal: row.nature === 'D' ? row.value : -row.value,
    natureza: row.nature,
  }));
}

export function parseTxtPlusToFolhaRelatorio(text: string): FolhaRelatorioImportRow[] {
  return parseTxtPlusToExtratoRows(text).map((row, index) => ({
    id: `folha-txtplus-${index}-${Date.now()}`,
    date: row.date,
    description: row.description,
    debito: row.nature === 'D' ? row.value : 0,
    credito: row.nature === 'C' ? row.value : 0,
  }));
}
