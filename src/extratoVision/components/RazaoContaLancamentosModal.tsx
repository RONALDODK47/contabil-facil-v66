import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, X, Zap } from 'lucide-react';
import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { getClassificacao } from '../utils/demonstracoesContabeis';
import { type LinhaComparativoMensal } from '../utils/balanceteComparativoMensal';
import {
  getNaturezaEsperada,
  isContaNaturezaAmbigua,
  selecionarIndicesCausaRaizInvertidos,
  type NaturezaSaldo,
} from '../utils/naturezaContabil';
import { isCnpjLike } from '../../lib/cnpjGuard';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from '../../contabilfacil/components/ExtratoContaPicker';
import {
  buildPlanoLookup,
  chaveContaRazao,
  filtrarContasAnaliticas,
  filtrarRazaoPorPeriodo,
  montarBalanceteComPeriodo,
  sortRowsByDataRazao,
  type PlanoLookup,
} from '../utils/razaoContabil';

export type RazaoContaModo = 'codigo' | 'classificacao';

type ContaSelecionada = Pick<
  LinhaComparativoMensal,
  'chave' | 'codigo' | 'classificacao' | 'nome' | 'tipo'
>;

type Props = {
  open: boolean;
  onClose: () => void;
  razaoRows: VisionBalanceteRow[];
  planoRows?: VisionPlanoRow[];
  conta: ContaSelecionada | null;
  /** codigo = só lançamentos do código reduzido; classificacao = só da classificação do balancete. */
  modo: RazaoContaModo;
  periodoDe: string;
  periodoAte: string;
  surface?: 'vision' | 'contabilfacil';
  /** Permite editar conta débito/crédito, excluir e lançar manualmente no razão. */
  onRazaoRowsChange?: (rows: VisionBalanceteRow[]) => void;
  /** Abre transferência/rateio de lançamentos desta conta (todos + subconjunto invertido + abertura). */
  onAbrirTransferencia?: (
    conta: ContaSelecionada,
    lancamentos: {
      todos: VisionBalanceteRow[];
      invertidos: VisionBalanceteRow[];
      saldoAnterior?: number;
    },
  ) => void;
};

function normDigits(s: string): string {
  const d = s.replace(/\D/g, '');
  if (!d) return '';
  return d.replace(/^0+/, '') || '0';
}

function normCls(s: string): string {
  return s.replace(/\./g, '').replace(/\s/g, '');
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1.234,56" ou "1234.56" → 1234.56 */
function parseValorInput(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function todayBr(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** DD/MM/AAAA → YYYY-MM-DD (para o input type="date"). */
function brToIso(val: string): string {
  if (!val) return '';
  const p = val.split('/');
  if (p.length === 3 && p[2].length === 4) return `${p[2]}-${p[1]}-${p[0]}`;
  return '';
}

/** YYYY-MM-DD → DD/MM/AAAA (do input type="date" para gravação). */
function isoToBr(val: string): string {
  if (!val) return '';
  const p = val.split('-');
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
  return val;
}

/** Classificação hierárquica do plano (nunca o reduzido repetido). */
function classificacaoDoPlano(
  row: VisionBalanceteRow,
  conta: ContaSelecionada,
  lookup?: PlanoLookup,
): string {
  const clsConta = (conta.classificacao || '').trim();
  if (clsConta.includes('.')) {
    const rowCod = normDigits(row.codigo || '');
    const contaCod = normDigits(conta.codigo || '');
    const rowCls = normCls(getClassificacao(row));
    const alvoCls = normCls(clsConta);
    if (contaCod && rowCod === contaCod) return clsConta;
    if (alvoCls && (rowCls === alvoCls || rowCls.startsWith(alvoCls))) return clsConta;
  }

  if (lookup) {
    const red = normDigits(row.codigo || '');
    if (red) {
      const hit = lookup.byReduced.get(red);
      if (hit?.codigo?.includes('.')) return hit.codigo;
    }
    const cls = normCls(row.classificacao || row.codigo || '');
    if (cls) {
      const hit = lookup.byCls.get(cls);
      if (hit?.codigo?.includes('.')) return hit.codigo;
    }
  }

  const raw = (row.classificacao || '').trim();
  if (raw.includes('.')) return raw;
  const viaGet = getClassificacao(row);
  if (viaGet.includes('.')) return viaGet;
  return clsConta.includes('.') ? clsConta : viaGet || raw || '—';
}

function codigoExibicao(row: VisionBalanceteRow, conta: ContaSelecionada, lookup?: PlanoLookup): string {
  const red = (row.codigo || '').trim();
  if (red && !red.includes('.')) return red;
  if (lookup) {
    const cls = normCls(getClassificacao(row) || conta.classificacao || '');
    const hit = cls ? lookup.byCls.get(cls) : undefined;
    if (hit?.codigoReduzido) return hit.codigoReduzido;
  }
  return (conta.codigo || red || '—').trim();
}

/** Lançamentos do razão filtrados pelo modo (código ou classificação do balancete). */
export function filtrarLancamentosRazaoDaConta(
  razaoRows: VisionBalanceteRow[],
  conta: ContaSelecionada,
  periodoDe: string,
  periodoAte: string,
  modo: RazaoContaModo,
  planoRows: VisionPlanoRow[] = [],
): VisionBalanceteRow[] {
  const noPeriodo = filtrarRazaoPorPeriodo(razaoRows, periodoDe, periodoAte);
  const lookup = planoRows.length > 0 ? buildPlanoLookup(planoRows) : undefined;
  const clsAlvo = (conta.classificacao || '').trim();
  // Linha sintética sem código reduzido usa a própria classificação como "codigo"
  // (fallback). Nesse caso NÃO se pode casar lançamentos por código: a conta "4"
  // (IMPOSTOS, sem reduzido) puxava a linha do grupo CAIXA cujo REDUZIDO é 4.
  const codAlvoRaw = normDigits(conta.codigo || '');
  const codAlvo = codAlvoRaw && codAlvoRaw !== normDigits(clsAlvo) ? codAlvoRaw : '';
  const sintetica = conta.tipo === 'S';

  const filtrado = noPeriodo.filter((r) => {
    // CNPJ vazado de rodapé de PDF gravado como "lançamento" nunca pertence a conta alguma.
    if (isCnpjLike(r.codigo) || isCnpjLike(r.classificacao)) return false;

    const rowCod = normDigits(r.codigo || '');
    const rowClsRaw = getClassificacao(r);
    const clsPlano = classificacaoDoPlano(r, conta, lookup);

    if (modo === 'codigo') {
      if (!codAlvo) return false;
      if (rowCod === codAlvo) return true;
      // Linha só com classificação: casa via plano → reduzido
      if (lookup && rowClsRaw) {
        const hit = lookup.byCls.get(normCls(rowClsRaw));
        if (hit && normDigits(hit.codigoReduzido || '') === codAlvo) return true;
      }
      return false;
    }

    // modo classificacao - comparação com classificação original (com pontos)
    if (!clsAlvo) return false;
    if (rowClsRaw === clsAlvo || clsPlano === clsAlvo) return true;
    if (codAlvo && rowCod === codAlvo) return true;
    if (sintetica) {
      if (rowClsRaw.startsWith(clsAlvo + '.') && rowClsRaw.length > clsAlvo.length) return true;
      if (clsPlano.startsWith(clsAlvo + '.') && clsPlano.length > clsAlvo.length) return true;
    }
    return false;
  });

  const soAnaliticas = filtrarContasAnaliticas(filtrado, planoRows, lookup);
  return sortRowsByDataRazao(soAnaliticas);
}

/**
 * As linhas exibidas no razão NÃO são as mesmas instâncias de `razaoRows`:
 * `filtrarContasAnaliticas` passa por `enrichNomeDoPlano`, que devolve um objeto
 * NOVO (`{...row}`) sempre que a conta é achada no plano. Comparar por referência
 * (`r === lancamentoEditando`) nunca casava — por isso editar a conta de uma
 * reclassificação "salvava" sem mudar nada e o Excluir não removia o lançamento.
 *
 * Casa pelo que o enriquecimento NÃO altera: id (quando existe), data, ordem,
 * valores e histórico. `codigo` só entra quando os dois lados o têm preenchido
 * (o enriquecimento preenche o vazio) e `classificacao` fica de fora porque é
 * justamente o campo sobrescrito pelo plano.
 */
export function mesmaLinhaRazao(a: VisionBalanceteRow, b: VisionBalanceteRow): boolean {
  if (a === b) return true;
  if (a.id && b.id) return a.id === b.id;
  if ((a.data ?? '') !== (b.data ?? '')) return false;
  if ((a.ordem ?? null) !== (b.ordem ?? null)) return false;
  if (Math.abs((a.debito ?? 0) - (b.debito ?? 0)) > 0.005) return false;
  if (Math.abs((a.credito ?? 0) - (b.credito ?? 0)) > 0.005) return false;
  if ((a.nome ?? '').trim().toUpperCase() !== (b.nome ?? '').trim().toUpperCase()) return false;
  const codA = normDigits(a.codigo || '');
  const codB = normDigits(b.codigo || '');
  if (codA && codB && codA !== codB) return false;
  return true;
}

/** Índice da linha original em `razaoRows` correspondente a uma linha exibida no razão. */
export function indiceLinhaRazao(rows: VisionBalanceteRow[], alvo: VisionBalanceteRow): number {
  const porReferencia = rows.indexOf(alvo);
  if (porReferencia >= 0) return porReferencia;
  return rows.findIndex((r) => mesmaLinhaRazao(r, alvo));
}

/** Chave estável de um lançamento — usada quando a referência de objeto não é confiável. */
export function chaveLancamentoRazao(r: VisionBalanceteRow): string {
  return [
    r.data ?? '',
    r.codigo ?? '',
    r.classificacao ?? '',
    String(r.debito ?? 0),
    String(r.credito ?? 0),
    String(r.ordem ?? ''),
    r.nome ?? '',
  ].join('|');
}

/**
 * Coleta os lançamentos causa-raiz da inversão (mesma regra do modal do Razão)
 * para um conjunto de contas, no período De/Até — com saldo anterior corretamente
 * carregado de antes do período.
 */
export function coletarLancamentosCausaRaizInvertidos(
  contas: Array<Pick<LinhaComparativoMensal, 'codigo' | 'classificacao' | 'nome' | 'tipo'>>,
  razaoRows: VisionBalanceteRow[],
  periodoDe: string,
  periodoAte: string,
  planoRows: VisionPlanoRow[] = [],
): Set<string> {
  const chaves = new Set<string>();

  for (const conta of contas) {
    const { lancamentos, indices } = analisarRazaoInvertidoDaConta(
      conta,
      razaoRows,
      periodoDe,
      periodoAte,
      planoRows,
    );
    for (const idx of indices) {
      const row = lancamentos[idx];
      if (!row) continue;
      chaves.add(chaveLancamentoRazao(row));
      // `lancamentos` sai enriquecido pelo plano (`enrichNomeDoPlano` reescreve
      // classificacao/codigo/nome). Quem consome estas chaves — o modo "Razão" do
      // Balancete — compara com as linhas CRUAS de `razaoRows`, cuja chave é outra
      // sempre que a linha veio só com o código reduzido, sem classificação. Sem a
      // chave da linha original, o lançamento causa-raiz simplesmente não era
      // pintado de vermelho no Balancete (o Razão marcava, o Balancete não).
      const idxOriginal = indiceLinhaRazao(razaoRows, row);
      if (idxOriginal >= 0) chaves.add(chaveLancamentoRazao(razaoRows[idxOriginal]!));
    }
  }

  return chaves;
}

/**
 * Dentro de cada dia, coloca primeiro os lançamentos do lado que condiz com a
 * natureza da conta. Débito e crédito no mesmo dia não têm ordem entre si, então
 * sem isso o saldo do dia podia aparecer invertido numa linha intermediária só
 * pela ordem de gravação. Ordenação estável e restrita ao dia.
 */
export function ordenarLancamentosPorNaturezaNoDia(
  rows: VisionBalanceteRow[],
  naturezaEsperada: NaturezaSaldo | null,
): VisionBalanceteRow[] {
  if (!naturezaEsperada || rows.length < 2) return rows;
  const oposto = (r: VisionBalanceteRow): boolean => {
    const deb = r.debito ?? 0;
    const cred = r.credito ?? 0;
    const ownNat: NaturezaSaldo | null = deb > cred ? 'D' : cred > deb ? 'C' : null;
    return ownNat !== naturezaEsperada;
  };
  const out: VisionBalanceteRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const dia = rows[i].data ?? '';
    let fim = i;
    while (fim < rows.length && (rows[fim].data ?? '') === dia) fim++;
    const doDia = rows.slice(i, fim);
    out.push(...doDia.filter((r) => !oposto(r)), ...doDia.filter(oposto));
    i = fim;
  }
  return out;
}

/**
 * A conta tem razão invertido dentro do período?
 *
 * Mesma regra (e mesmo saldo de abertura) usada para pintar de vermelho os
 * lançamentos causa-raiz — o filtro do Balancete e o destaque do Razão não
 * podem discordar, senão a tela acusa conta que o Razão não acusa.
 */
export function contaTemRazaoInvertido(
  conta: Pick<LinhaComparativoMensal, 'codigo' | 'classificacao' | 'nome' | 'tipo'>,
  razaoRows: VisionBalanceteRow[],
  periodoDe: string,
  periodoAte: string,
  planoRows: VisionPlanoRow[] = [],
): boolean {
  return (
    analisarRazaoInvertidoDaConta(conta, razaoRows, periodoDe, periodoAte, planoRows).indices.size > 0
  );
}

/**
 * Saldo do período ANTERIOR da conta (+ devedor, − credor), pela via canônica:
 * é, por definição, o saldo final da conta no balancete montado até a véspera do
 * período. Mesma função que o modal do Razão usa para a coluna "SALDO ANTERIOR" —
 * a análise de inversão não pode partir de uma abertura diferente da que o Razão
 * mostra na tela, senão o Balancete acusa conta que o Razão não acusa.
 *
 * O balancete é montado UMA vez por (razaoRows, planoRows, período) e o resultado
 * fica num cache de 1 entrada: o filtro do Balancete pergunta isso conta por conta
 * (centenas de linhas) e remontar o balancete a cada pergunta travava a tela.
 */
let cacheSaldosAnteriores: {
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  periodoDe: string;
  periodoAte: string;
  mapa: Map<string, number>;
} | null = null;

export function saldosAnterioresDoRazao(
  razaoRows: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  periodoDe: string,
  periodoAte: string,
): Map<string, number> {
  const c = cacheSaldosAnteriores;
  if (
    c &&
    c.razaoRows === razaoRows &&
    c.planoRows === planoRows &&
    c.periodoDe === periodoDe &&
    c.periodoAte === periodoAte
  ) {
    return c.mapa;
  }

  const linhasNoPeriodo = filtrarRazaoPorPeriodo(razaoRows, periodoDe, periodoAte);
  const balancete = montarBalanceteComPeriodo(
    razaoRows,
    linhasNoPeriodo,
    planoRows,
    periodoDe,
    periodoAte,
  );
  const mapa = new Map<string, number>();
  for (const r of balancete) {
    const si = r.saldoInicial ?? 0;
    if (Math.abs(si) < 0.001) continue;
    mapa.set(chaveContaRazao(r), r.naturezaSaldoInicial === 'C' ? -si : si);
  }

  cacheSaldosAnteriores = { razaoRows, planoRows, periodoDe, periodoAte, mapa };
  return mapa;
}

/**
 * Reproduz EXATAMENTE o que o modal do Razão calcula para a conta — mesmos
 * lançamentos (só o período, na mesma ordem exibida), mesma natureza esperada e
 * mesmo saldo anterior — e devolve os índices causa-raiz da inversão.
 *
 * O filtro "Contas com razão invertido" do Balancete e o destaque vermelho do
 * Razão saem daqui, então não podem discordar. Antes cada um montava a sua
 * própria versão: o filtro varria o razão desde o início dos tempos e refazia a
 * abertura por conta própria (somando `debito - credito`, aceitando lançamento
 * sem data no período e resolvendo a natureza pelo razão em vez do plano),
 * enquanto o modal usava o período e a abertura do balancete. Divergindo nas
 * entradas, o Balancete pintava de vermelho conta cujo Razão nunca inverte.
 */
export function analisarRazaoInvertidoDaConta(
  conta: Pick<LinhaComparativoMensal, 'codigo' | 'classificacao' | 'nome' | 'tipo'>,
  razaoRows: VisionBalanceteRow[],
  periodoDe: string,
  periodoAte: string,
  planoRows: VisionPlanoRow[] = [],
  modo: RazaoContaModo = 'classificacao',
): { lancamentos: VisionBalanceteRow[]; indices: Set<number> } {
  const vazio = { lancamentos: [] as VisionBalanceteRow[], indices: new Set<number>() };
  if (conta.tipo === 'S') return vazio;
  if (isContaNaturezaAmbigua({ nome: conta.nome, classificacao: conta.classificacao })) return vazio;

  const nEsp = naturezaEsperadaDaConta(conta, razaoRows, planoRows);
  if (!nEsp) return vazio;

  const brutos = filtrarLancamentosRazaoDaConta(
    razaoRows,
    { ...conta, chave: conta.classificacao || conta.codigo || conta.nome },
    periodoDe,
    periodoAte,
    modo,
    planoRows,
  );
  if (brutos.length === 0) return vazio;

  // Mesma ordem por dia que o Razão exibe — senão o filtro do Balancete acusa
  // inversão que o Razão não mostra (e vice-versa).
  const lancamentos = ordenarLancamentosPorNaturezaNoDia(brutos, nEsp);

  const saldoAnterior =
    saldosAnterioresDoRazao(razaoRows, planoRows, periodoDe, periodoAte).get(
      chaveContaRazao({
        codigo: conta.codigo,
        classificacao: conta.classificacao,
        nome: conta.nome,
      } as VisionBalanceteRow),
    ) ?? 0;

  return {
    lancamentos,
    indices: selecionarIndicesCausaRaizInvertidos(lancamentos, nEsp, saldoAnterior, false),
  };
}

/** Natureza esperada com as MESMAS entradas do modal do Razão (plano na frente do razão). */
function naturezaEsperadaDaConta(
  conta: Pick<LinhaComparativoMensal, 'codigo' | 'classificacao' | 'nome'>,
  razaoRows: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
): NaturezaSaldo | null {
  return getNaturezaEsperada(
    { nome: conta.nome, classificacao: conta.classificacao, codigo: conta.codigo },
    (planoRows.length > 0 ? planoRows : razaoRows) as unknown as VisionBalanceteRow[],
  );
}

export function RazaoContaLancamentosModal({
  open,
  onClose,
  razaoRows,
  planoRows = [],
  conta,
  modo,
  periodoDe,
  periodoAte,
  surface = 'contabilfacil',
  onRazaoRowsChange,
  onAbrirTransferencia,
}: Props) {
  const contabil = surface === 'contabilfacil';
  const podeEditar = typeof onRazaoRowsChange === 'function';

  const [lancamentoEditando, setLancamentoEditando] = useState<VisionBalanceteRow | null>(null);
  const [editData, setEditData] = useState('');
  const [editHistorico, setEditHistorico] = useState('');
  const [editContaDeb, setEditContaDeb] = useState('');
  const [editContaCred, setEditContaCred] = useState('');
  const [editValor, setEditValor] = useState('');

  const [novoAberto, setNovoAberto] = useState(false);
  const [novoData, setNovoData] = useState('');
  const [novoHistorico, setNovoHistorico] = useState('');
  const [novoContaDeb, setNovoContaDeb] = useState('');
  const [novoContaCred, setNovoContaCred] = useState('');
  const [novoValor, setNovoValor] = useState('');

  const lookup = useMemo(
    () => (planoRows.length > 0 ? buildPlanoLookup(planoRows) : undefined),
    [planoRows],
  );

  const planoContaOptions: ExtratoPlanoContaOption[] = useMemo(
    () =>
      planoRows.map((p) => ({
        code: p.codigo,
        name: p.nome,
        codigoReduzido: p.codigoReduzido,
        tipo: p.tipo,
        nivel: p.nivel,
      })),
    [planoRows],
  );

  const lancamentosBrutos = useMemo(() => {
    if (!open || !conta) return [];
    return filtrarLancamentosRazaoDaConta(
      razaoRows,
      conta,
      periodoDe,
      periodoAte,
      modo,
      planoRows,
    );
  }, [open, conta, razaoRows, periodoDe, periodoAte, modo, planoRows]);

  const naturezaEsperada: NaturezaSaldo | null = useMemo(() => {
    if (!conta) return null;
    return getNaturezaEsperada(
      { nome: conta.nome, classificacao: conta.classificacao, codigo: conta.codigo },
      (planoRows.length > 0 ? planoRows : razaoRows) as unknown as VisionBalanceteRow[],
    );
  }, [conta, planoRows, razaoRows]);

  /**
   * Dentro do MESMO dia, o lançamento da natureza da conta vem primeiro.
   *
   * Débito e crédito no mesmo dia não têm ordem cronológica entre si (a data é a
   * única referência), então exibi-los na ordem em que foram gravados podia jogar
   * o de natureza oposta na frente e fazer o saldo do dia aparecer invertido numa
   * linha intermediária — mesmo com o dia fechando correto. Ex.: em 27/05 a
   * devolução (C) vinha antes da utilização (D) e a linha da devolução mostrava
   * 997,19 C numa conta devedora. Ordenando o lado que condiz com a natureza
   * primeiro, o saldo intermediário nunca inverte por causa da ordem de gravação.
   * A ordenação é estável: entre lançamentos do mesmo lado, a ordem original é
   * preservada, e dias diferentes não se misturam.
   */
  const lancamentos = useMemo(
    () => ordenarLancamentosPorNaturezaNoDia(lancamentosBrutos, naturezaEsperada),
    [lancamentosBrutos, naturezaEsperada],
  );

  /**
   * Contas de natureza legitimamente ambígua (Resultado do Exercício, AEA,
   * Lucros/Prejuízos Acumulados etc.) podem fechar tanto D quanto C — nunca
   * devem ser acusadas de "invertida", nem no mês nem no dia.
   */
  const naturezaAmbigua = useMemo(() => {
    if (!conta) return false;
    return isContaNaturezaAmbigua({ nome: conta.nome, classificacao: conta.classificacao });
  }, [conta]);

  /** Mês (AAAA-MM) da data BR (DD/MM/AAAA) da linha, para agrupar o saldo diário/mensal. */
  const mesDaLinha = (data?: string): string => {
    const partes = (data || '').split('/');
    return partes.length === 3 ? `${partes[2]}-${partes[1]}` : '';
  };

  /**
   * Saldo da conta ANTES do período exibido (+ devedor, − credor).
   *
   * Antes esta função reimplementava, isolada, a mesma lógica de "SI mais
   * recente + movimentos desde o SI" que `montarBalanceteComPeriodo` usa para
   * o Balancete — e as duas podiam divergir em casos-limite, fazendo o Razão
   * mostrar um saldo anterior diferente do saldo final do Balancete para a
   * MESMA conta. Agora delega para a função canônica: o saldo anterior do
   * Razão é sempre, por definição, o saldo final da conta específica no
   * balancete do período anterior — nunca um cálculo paralelo.
   */
  const saldoAnteriorPeriodo = useMemo(() => {
    if (!open || !conta) return 0;
    const key = chaveContaRazao({
      codigo: conta.codigo,
      classificacao: conta.classificacao,
      nome: conta.nome,
    } as VisionBalanceteRow);
    return saldosAnterioresDoRazao(razaoRows, planoRows ?? [], periodoDe, periodoAte).get(key) ?? 0;
  }, [open, conta, razaoRows, periodoDe, periodoAte, planoRows]);

  const totais = useMemo(() => {
    let deb = 0;
    let cred = 0;
    for (const r of lancamentos) {
      deb += r.debito ?? 0;
      cred += r.credito ?? 0;
    }
    const saldoAssinado = saldoAnteriorPeriodo + deb - cred;
    const natureza: NaturezaSaldo | null =
      Math.abs(saldoAssinado) < 0.005 ? null : saldoAssinado > 0 ? 'D' : 'C';
    return { deb, cred, saldo: Math.abs(saldoAssinado), natureza };
  }, [lancamentos, saldoAnteriorPeriodo]);

  /**
   * Saldo do dia (acumulado desde o início do razão — parte do saldo anterior ao
   * período) e natureza real de cada lançamento — usado para pintar de vermelho
   * o(s) mês(es)/dia(s) cujo saldo fecha do lado oposto ao esperado (mesma regra
   * de "invertida" do Balancete).
   */
  const { linhasComSaldo, mesesInvertidos, indicesElegiveisReclassificacao } = useMemo(() => {
    let saldoAssinado = saldoAnteriorPeriodo; // + devedor, − credor
    const linhas = lancamentos.map((r) => {
      const saldoAnteriorAssinado = saldoAssinado; // com sinal
      saldoAssinado += (r.debito ?? 0) - (r.credito ?? 0);

      const natureza: NaturezaSaldo | null =
        Math.abs(saldoAssinado) < 0.005 ? null : saldoAssinado > 0 ? 'D' : 'C';
      const naturezaAnterior: NaturezaSaldo | null =
        Math.abs(saldoAnteriorAssinado) < 0.005 ? null : saldoAnteriorAssinado > 0 ? 'D' : 'C';

      return {
        row: r,
        saldoAnterior: Math.abs(saldoAnteriorAssinado),
        naturezaAnterior,
        saldoDia: Math.abs(saldoAssinado),
        naturezaDia: natureza,
        mes: mesDaLinha(r.data),
      };
    });

    // Último saldo conhecido de cada mês → define se o mês fechou invertido.
    const ultimoDoMes = new Map<string, NaturezaSaldo | null>();

    for (const l of linhas) {
      if (!l.mes) continue;
      ultimoDoMes.set(l.mes, l.naturezaDia);
    }

    const invertidos = new Set<string>();
    if (naturezaEsperada && !naturezaAmbigua) {
      for (const [mes, nat] of ultimoDoMes) {
        if (nat && nat !== naturezaEsperada) {
          invertidos.add(mes); // Mês fechou invertido
        }
      }
    }

    // Seleção elegível para reclassificação (modo "Só invertidos") — causa-raiz.
    const indicesElegiveis = selecionarIndicesCausaRaizInvertidos(
      lancamentos,
      naturezaEsperada,
      saldoAnteriorPeriodo,
      naturezaAmbigua,
    );

    return { linhasComSaldo: linhas, mesesInvertidos: invertidos, indicesElegiveisReclassificacao: indicesElegiveis };
  }, [lancamentos, naturezaEsperada, naturezaAmbigua, saldoAnteriorPeriodo]);

  /** Lançamentos antigos não gravam contaDeb/contaCred — acha a contraparte por data+histórico+valor no lado oposto. */
  const acharContrapartida = (row: VisionBalanceteRow, ladoQueFalta: 'debito' | 'credito'): string => {
    const valorAlvo = row.debito > 0 ? row.debito : row.credito;
    const par = razaoRows.find(
      (r) =>
        !mesmaLinhaRazao(r, row) &&
        r.data === row.data &&
        r.nome === row.nome &&
        Math.abs((ladoQueFalta === 'debito' ? r.debito : r.credito) - valorAlvo) <= 0.005 &&
        (ladoQueFalta === 'debito' ? r.credito <= 0.005 : r.debito <= 0.005),
    );
    return par ? (par.codigo || par.classificacao || '').trim() : '';
  };

  const abrirEdicao = (row: VisionBalanceteRow) => {
    if (!podeEditar || !conta) return;
    const codReduzido = codigoExibicao(row, conta, lookup);
    setLancamentoEditando(row);
    setEditData(row.data || '');
    setEditHistorico(row.nome || '');
    setEditContaDeb(
      row.contaDeb || (row.debito > 0 ? codReduzido : acharContrapartida(row, 'debito')),
    );
    setEditContaCred(
      row.contaCred || (row.credito > 0 ? codReduzido : acharContrapartida(row, 'credito')),
    );
    setEditValor(fmtMoney(row.debito > 0 ? row.debito : row.credito).replace('—', ''));
  };

  const fecharEdicao = () => setLancamentoEditando(null);

  const salvarEdicao = () => {
    if (!lancamentoEditando || !onRazaoRowsChange) return;
    // A linha exibida é uma CÓPIA da linha do razão (ver mesmaLinhaRazao); localiza
    // a original por índice antes de qualquer coisa.
    const idxOriginal = indiceLinhaRazao(razaoRows, lancamentoEditando);
    if (idxOriginal < 0) {
      window.alert('Não foi possível localizar este lançamento no razão para salvar a alteração.');
      return;
    }
    const original = razaoRows[idxOriginal];
    const valor = parseValorInput(editValor);
    const eraDebito = lancamentoEditando.debito > 0;
    const novaData = editData.trim() || lancamentoEditando.data;
    const novoNome = editHistorico.trim().toUpperCase() || lancamentoEditando.nome;
    const novaContaDeb = editContaDeb.trim() || undefined;
    const novaContaCred = editContaCred.trim() || undefined;

    // Resolve classificação completa a partir do código reduzido (mesmo que salvarNovo).
    const resolverCls = (cod: string | undefined): string | undefined => {
      if (!cod || !lookup) return cod;
      const norm = cod.replace(/\D/g, '').replace(/^0+/, '') || '0';
      const hit = lookup.byReduced.get(norm);
      if (hit?.codigo) return hit.codigo;
      const hitCls = lookup.byCls.get(norm);
      if (hitCls?.codigo) return hitCls.codigo;
      return cod;
    };

    // Classificação hierárquica (ex: "2.1.5.01") só deve ser sobrescrita quando o novo
    // código resolva uma classificação com ponto. Linhas de automação (FOLHA-AUTO,
    // FISCAL-AUTO, HONOR-AUTO, etc.) usam `classificacao` como marcador de identidade —
    // sobrescrever com o código da conta destrói esse marcador e impede que o próximo
    // "Mandar para o Balancete" remova as linhas antigas, gerando duplicatas sem contrapartida.
    const resolverClsSafe = (cod: string | undefined, original: string | undefined): string | undefined => {
      // Se o original já é um marcador de automação (contém letras), preserva.
      if (original && /[A-Za-z]/.test(original)) return original;
      const resolved = resolverCls(cod);
      if (resolved && resolved.includes('.')) return resolved; // classificação hierárquica válida
      return resolved ?? original;
    };

    const atualizado: VisionBalanceteRow = {
      ...original,
      data: novaData,
      nome: novoNome,
      contaDeb: novaContaDeb,
      contaCred: novaContaCred,
      codigo: eraDebito ? (novaContaDeb ?? original.codigo) : (novaContaCred ?? original.codigo),
      classificacao: eraDebito
        ? resolverClsSafe(novaContaDeb, original.classificacao)
        : resolverClsSafe(novaContaCred, original.classificacao),
      debito: eraDebito ? valor : 0,
      credito: eraDebito ? 0 : valor,
    };

    // Lançamento manual: duas linhas (débito + crédito) com o mesmo `ordem`.
    // Ao editar uma perna, sincroniza data, histórico, contas e valor na contraparte.
    //
    // IMPORTANTE: `ordem` sozinho não identifica a contraparte — ela se repete
    // entre meses/lançamentos diferentes (bases fixas como 900_000 são usadas em
    // todo mês automatizado). Sem checar também a `data` original, esse `find`
    // podia pegar um lançamento de OUTRA transação com o mesmo `ordem` em outra
    // data e sobrescrever a conta/valor dele — fazendo um lançamento não
    // relacionado "sumir" (mudar de conta/valor) ao editar outro.
    const ordemPar = original.ordem;
    const dataOriginal = original.data;
    const idxPar =
      ordemPar !== undefined
        ? razaoRows.findIndex(
            (r, i) => i !== idxOriginal && r.ordem === ordemPar && r.data === dataOriginal,
          )
        : -1;
    const par = idxPar >= 0 ? razaoRows[idxPar] : undefined;

    let novasLinhas = razaoRows.map((r, i) => (i === idxOriginal ? atualizado : r));

    if (par) {
      const parAtualizado: VisionBalanceteRow = {
        ...par,
        data: novaData,
        nome: novoNome,
        contaDeb: novaContaDeb,
        contaCred: novaContaCred,
        // A contraparte tem o lado oposto ao da linha editada.
        codigo: eraDebito ? (novaContaCred ?? par.codigo) : (novaContaDeb ?? par.codigo),
        classificacao: eraDebito
          ? resolverClsSafe(novaContaCred, par.classificacao)
          : resolverClsSafe(novaContaDeb, par.classificacao),
        debito: eraDebito ? 0 : valor,
        credito: eraDebito ? valor : 0,
      };
      novasLinhas = novasLinhas.map((r, i) => (i === idxPar ? parAtualizado : r));
    }

    onRazaoRowsChange(novasLinhas);
    setLancamentoEditando(null);
  };

  const excluirLancamento = () => {
    if (!lancamentoEditando || !onRazaoRowsChange) return;
    if (!window.confirm('Excluir este lançamento do razão? Esta ação não pode ser desfeita.')) return;

    // Idem salvarEdicao: a linha da tela é cópia, então localiza a original por índice.
    const idxOriginal = indiceLinhaRazao(razaoRows, lancamentoEditando);
    if (idxOriginal < 0) {
      window.alert('Não foi possível localizar este lançamento no razão para excluir.');
      return;
    }
    const lancamento = razaoRows[idxOriginal];
    const toExcluir = new Set<number>();
    toExcluir.add(idxOriginal);

    // Procura pela contrapartida usando os mesmos critérios que acharContrapartida:
    // data + histórico + valor. Isso garante que se excluir um débito, também exclui
    // o crédito correspondente (e vice-versa), mantendo a integridade contábil.
    const ladoComValor = lancamento.debito > 0 ? 'debito' : 'credito';
    const valorAlvo = lancamento.debito > 0 ? lancamento.debito : lancamento.credito;
    // A contraparte do MESMO lançamento (mesma `ordem`) vem primeiro; o casamento
    // por data+histórico+valor é o fallback para lançamentos antigos sem `ordem`.
    let idxContrapartida =
      lancamento.ordem !== undefined
        ? razaoRows.findIndex(
            (r, i) =>
              i !== idxOriginal &&
              r.ordem === lancamento.ordem &&
              r.data === lancamento.data &&
              (ladoComValor === 'debito' ? (r.credito ?? 0) > 0.005 : (r.debito ?? 0) > 0.005),
          )
        : -1;
    if (idxContrapartida < 0) {
      idxContrapartida = razaoRows.findIndex(
        (r, i) =>
          i !== idxOriginal &&
          r.data === lancamento.data &&
          r.nome === lancamento.nome &&
          Math.abs((ladoComValor === 'debito' ? r.credito : r.debito) - valorAlvo) <= 0.005 &&
          (ladoComValor === 'debito' ? r.credito > 0.005 : r.debito > 0.005),
      );
    }

    if (idxContrapartida >= 0) {
      toExcluir.add(idxContrapartida);
    }

    onRazaoRowsChange(razaoRows.filter((_, i) => !toExcluir.has(i)));
    setLancamentoEditando(null);
  };

  const abrirNovo = () => {
    if (!podeEditar || !conta) return;
    setNovoData(periodoAte.trim() || todayBr());
    setNovoHistorico('');
    setNovoValor('');
    const contaCodigo = (conta.codigo || conta.classificacao || '').trim();
    if (naturezaEsperada === 'C') {
      setNovoContaDeb('');
      setNovoContaCred(contaCodigo);
    } else {
      setNovoContaDeb(contaCodigo);
      setNovoContaCred('');
    }
    setNovoAberto(true);
  };

  const fecharNovo = () => setNovoAberto(false);

  const salvarNovo = () => {
    if (!onRazaoRowsChange) return;
    const valor = parseValorInput(novoValor);
    const contaDebTrim = novoContaDeb.trim();
    const contaCredTrim = novoContaCred.trim();
    if (valor <= 0 || !contaDebTrim || !contaCredTrim) return;
    const dataBr = novoData.trim() || periodoAte.trim() || todayBr();
    const historico = novoHistorico.trim().toUpperCase() || 'LANÇAMENTO MANUAL';
    const ordem = Date.now();

    // Resolve a classificação completa (ex.: "1.01.02.0001") a partir do código
    // reduzido gravado pelo ExtratoContaPicker, usando o plano de contas.
    // Sem isso, ambas as linhas ficavam com codigo="8"/classificacao="8" e o
    // filtro do razão não conseguia associá-las às contas corretas do balancete.
    const resolverCls = (cod: string): string => {
      if (!lookup) return cod;
      const norm = cod.replace(/\D/g, '').replace(/^0+/, '') || '0';
      const hit = lookup.byReduced.get(norm);
      if (hit?.codigo) return hit.codigo;
      const hitCls = lookup.byCls.get(norm);
      if (hitCls?.codigo) return hitCls.codigo;
      return cod;
    };

    const clsDeb = resolverCls(contaDebTrim);
    const clsCred = resolverCls(contaCredTrim);

    const base = {
      nome: historico,
      data: dataBr,
      ordem,
      saldoInicial: 0,
      saldoFinal: 0,
      contaDeb: contaDebTrim,
      contaCred: contaCredTrim,
      isReconciliation: true,
    };
    const linhaDebito: VisionBalanceteRow = {
      ...base,
      codigo: contaDebTrim,
      classificacao: clsDeb,
      debito: valor,
      credito: 0,
    };
    const linhaCredito: VisionBalanceteRow = {
      ...base,
      codigo: contaCredTrim,
      classificacao: clsCred,
      debito: 0,
      credito: valor,
    };
    onRazaoRowsChange([...razaoRows, linhaDebito, linhaCredito]);
    setNovoAberto(false);
  };

  if (!open || !conta) return null;

  const tituloModo = modo === 'codigo' ? 'por código' : 'por classificação';
  const mostrarCodigo = modo === 'codigo';
  const mostrarClassificacao = modo === 'classificacao';

  const overlay = contabil
    ? 'fixed inset-0 z-[220] flex items-center justify-center p-4 bg-brand-text/40'
    : 'fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/70';
  const panel = contabil
    ? 'technical-panel w-full max-w-4xl max-h-[85vh] flex flex-col shadow-[6px_6px_0_0_#141414] bg-brand-bg'
    : 'w-full max-w-4xl max-h-[85vh] flex flex-col rounded-xl border border-slate-700 bg-slate-950 shadow-2xl';
  const head = contabil
    ? 'flex items-start justify-between gap-3 p-4 border-b border-brand-border'
    : 'flex items-start justify-between gap-3 p-4 border-b border-slate-700';
  const th = contabil
    ? 'px-3 py-2 text-[9px] font-black uppercase tracking-wider border-r border-brand-border bg-brand-sidebar'
    : 'px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-700';
  const td = contabil
    ? 'px-3 py-2 border-r border-brand-border/20 text-[11px] font-mono'
    : 'px-3 py-2 text-[11px] font-mono border-b border-slate-800';

  const colSpanTotais = 4 + (mostrarCodigo ? 1 : 0) + (mostrarClassificacao ? 1 : 0);

  return (
    <div
      className={overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`Razão da conta ${conta.nome}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={panel}>
        <div className={head}>
          <div className="min-w-0 space-y-1">
            <p
              className={
                contabil
                  ? 'text-[10px] font-black uppercase tracking-widest opacity-50'
                  : 'text-[10px] font-black uppercase tracking-widest text-slate-500'
              }
            >
              Razão da conta · {tituloModo}
            </p>
            <h2
              className={
                contabil
                  ? 'text-sm font-black uppercase tracking-tight truncate'
                  : 'text-sm font-black uppercase tracking-tight text-cyan-200 truncate'
              }
              title={conta.nome}
            >
              {conta.nome}
            </h2>
            <p className="text-[10px] font-mono opacity-70">
              {modo === 'codigo'
                ? `Código ${conta.codigo || '—'}`
                : `Classificação ${conta.classificacao || '—'}`}
              {conta.tipo === 'S' && modo === 'classificacao' ? ' · Sintética (filhas)' : ''}
            </p>
            <p className="text-[9px] font-mono opacity-50">
              Período {periodoDe} a {periodoAte} · {lancamentos.length.toLocaleString('pt-BR')}{' '}
              lançamento(s)
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onAbrirTransferencia && conta && (
              <button
                type="button"
                onClick={() => {
                  // Só os lançamentos de natureza oposta à da conta E que mantêm
                  // o saldo do dia invertido — nunca lançamentos da mesma natureza.
                  const lancamentosInvertidos = linhasComSaldo
                    .filter((linha, idx) => {
                      if (!indicesElegiveisReclassificacao.has(idx)) return false;
                      const deb = linha.row.debito ?? 0;
                      const cred = linha.row.credito ?? 0;
                      const ownNat: NaturezaSaldo | null = deb > cred ? 'D' : cred > deb ? 'C' : null;
                      if (naturezaEsperada && ownNat === naturezaEsperada) return false;
                      return true;
                    })
                    .map((linha) => linha.row);
                  onAbrirTransferencia(conta, {
                    todos: lancamentos,
                    invertidos: lancamentosInvertidos,
                    // Mesma abertura usada para eleger os causa-raiz acima — sem ela
                    // o modal de reclassificação projeta o saldo final sobre outra base.
                    saldoAnterior: saldoAnteriorPeriodo,
                  });
                }}
                title="Transferir lançamentos invertidos para conta de contrapartida"
                className={
                  contabil
                    ? 'technical-button-primary flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase'
                    : 'flex items-center gap-1.5 px-3 py-2 rounded border border-cyan-700 bg-cyan-900/40 text-cyan-200 text-[10px] font-bold uppercase hover:bg-cyan-900/70'
                }
              >
                Reclassificação e Compensação
              </button>
            )}
            {podeEditar && (
              <button
                type="button"
                onClick={abrirNovo}
                className={
                  contabil
                    ? 'technical-button-primary flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase'
                    : 'flex items-center gap-1.5 px-3 py-2 rounded border border-cyan-700 bg-cyan-900/40 text-cyan-200 text-[10px] font-bold uppercase hover:bg-cyan-900/70'
                }
              >
                <Plus size={14} aria-hidden />
                Novo lançamento
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={
                contabil
                  ? 'technical-button-secondary p-2'
                  : 'p-2 rounded border border-slate-600 text-slate-300 hover:bg-slate-800'
              }
              aria-label="Fechar razão da conta"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {lancamentos.length === 0 ? (
            <p
              className={
                contabil
                  ? 'p-10 text-center text-[10px] font-bold uppercase tracking-widest opacity-40'
                  : 'p-10 text-center text-sm text-slate-500'
              }
            >
              Nenhum lançamento desta conta no período.
            </p>
          ) : (
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className={th}>Data</th>
                  {mostrarCodigo ? <th className={th}>Código</th> : null}
                  {mostrarClassificacao ? <th className={th}>Classificação</th> : null}
                  <th className={th}>Histórico</th>
                  <th className={th}>Natureza</th>
                  <th className={`${th} text-right`}>Saldo anterior</th>
                  <th className={`${th} text-right`}>Débito</th>
                  <th className={`${th} text-right`}>Crédito</th>
                  <th className={`${th} text-right`}>Saldo do dia</th>
                  {podeEditar ? <th className={`${th} w-8`} /> : null}
                </tr>
              </thead>
              <tbody>
                {linhasComSaldo.map(({ row: r, saldoAnterior, naturezaAnterior, saldoDia, naturezaDia, mes }, i) => {
                  const mesInvertido = mesesInvertidos.has(mes);
                  // Vermelho só no causador real da inversão (causa-raiz) — não em todo
                  // dia que carrega o saldo já invertido por causa de um lançamento anterior.
                  const diaInvertido = indicesElegiveisReclassificacao.has(i);
                  return (
                    <tr
                      key={`${r.ordem ?? i}-${r.data}-${r.codigo}-${r.debito}-${r.credito}`}
                      onClick={podeEditar ? () => abrirEdicao(r) : undefined}
                      className={`${podeEditar ? 'cursor-pointer' : ''} ${
                        diaInvertido
                          ? contabil
                            ? 'technical-grid-row bg-red-100/70'
                            : 'bg-red-950/40'
                          : contabil
                            ? 'technical-grid-row'
                            : 'hover:bg-slate-900/60'
                      }`}
                      title={diaInvertido ? `Saldo do dia está invertido (${naturezaDia} em vez de ${naturezaEsperada})` : mesInvertido ? `Mês ${mes} fechou com natureza invertida` : undefined}
                    >
                      <td className={`${td} whitespace-nowrap`}>{r.data || '—'}</td>
                      {mostrarCodigo ? (
                        <td className={td}>{codigoExibicao(r, conta, lookup)}</td>
                      ) : null}
                      {mostrarClassificacao ? (
                        <td className={td}>{classificacaoDoPlano(r, conta, lookup)}</td>
                      ) : null}
                      <td
                        className={`${td} ${contabil ? 'uppercase italic' : 'text-slate-300'} max-w-[280px] truncate`}
                        title={r.nome}
                      >
                        {r.nome || '—'}
                      </td>
                      <td
                        className={`${td} font-bold uppercase ${
                          mesInvertido
                            ? contabil
                              ? 'text-red-700'
                              : 'text-red-400'
                            : contabil
                              ? 'opacity-60'
                              : 'text-slate-400'
                        }`}
                      >
                        {naturezaAmbigua
                          ? 'Ambígua'
                          : naturezaEsperada === 'D'
                            ? 'Devedora'
                            : naturezaEsperada === 'C'
                              ? 'Credora'
                              : '—'}
                      </td>
                      <td className={`${td} text-right font-mono ${contabil ? '' : 'text-slate-300'}`}>
                        {i === 0 && naturezaAnterior ? `${fmtMoney(saldoAnterior)} ${naturezaAnterior}` : '—'}
                      </td>
                      <td className={`${td} text-right ${contabil ? 'text-red-700' : 'text-red-400'}`}>
                        {fmtMoney(r.debito ?? 0)}
                      </td>
                      <td className={`${td} text-right ${contabil ? 'text-green-700' : 'text-emerald-400'}`}>
                        {fmtMoney(r.credito ?? 0)}
                      </td>
                      <td
                        className={`${td} text-right font-bold ${
                          mesInvertido
                            ? contabil
                              ? 'text-red-700'
                              : 'text-red-400'
                            : ''
                        }`}
                      >
                        {naturezaDia ? `${fmtMoney(saldoDia)} ${naturezaDia}` : '—'}
                      </td>
                      {podeEditar ? (
                        <td className={`${td} text-center`}>
                          <Pencil size={12} className="opacity-40 inline-block" aria-hidden />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr
                  className={
                    contabil
                      ? 'bg-brand-sidebar/40 font-black'
                      : 'bg-slate-900 font-black text-slate-200'
                  }
                >
                  <td className={td} colSpan={colSpanTotais}>
                    Totais
                  </td>
                  <td className={`${td} text-right`}>{fmtMoney(totais.deb)}</td>
                  <td className={`${td} text-right`}>{fmtMoney(totais.cred)}</td>
                  <td className={`${td} text-right`}>
                    {totais.natureza ? `${fmtMoney(totais.saldo)} ${totais.natureza}` : '—'}
                  </td>
                  {podeEditar ? <td className={td} /> : null}
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {lancamentoEditando ? (
        <div
          className={contabil ? 'fixed inset-0 z-[230] flex items-center justify-center p-4 bg-brand-text/50' : 'fixed inset-0 z-[230] flex items-center justify-center p-4 bg-black/80'}
          role="dialog"
          aria-modal="true"
          aria-label="Editar lançamento"
          onClick={(e) => {
            if (e.target === e.currentTarget) fecharEdicao();
          }}
        >
          <div
            className={
              contabil
                ? 'technical-panel w-full max-w-md p-5 space-y-4 shadow-[6px_6px_0_0_#141414] bg-brand-bg'
                : 'w-full max-w-md p-5 space-y-4 rounded-xl border border-slate-700 bg-slate-950 shadow-2xl'
            }
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className={contabil ? 'text-sm font-black uppercase tracking-tight' : 'text-sm font-black uppercase tracking-tight text-cyan-200'}>
                Editar lançamento
              </h3>
              <button
                type="button"
                onClick={fecharEdicao}
                className={contabil ? 'technical-button-secondary p-1.5' : 'p-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-800'}
                aria-label="Fechar edição"
              >
                <X size={14} aria-hidden />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Data</label>
                <input
                  type="date"
                  value={brToIso(editData)}
                  onChange={(e) => setEditData(isoToBr(e.target.value))}
                  className="w-full text-[11px] font-mono bg-white/5 border border-brand-border px-2 py-1.5 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Histórico</label>
                <input
                  type="text"
                  value={editHistorico}
                  onChange={(e) => setEditHistorico(e.target.value)}
                  className="w-full text-[11px] font-mono bg-white/5 border border-brand-border px-2 py-1.5 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Conta débito</label>
                  <ExtratoContaPicker
                    ariaLabel="Conta débito - editar lançamento"
                    options={planoContaOptions}
                    value={editContaDeb}
                    onChange={setEditContaDeb}
                    includeSinteticas
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Conta crédito</label>
                  <ExtratoContaPicker
                    ariaLabel="Conta crédito - editar lançamento"
                    options={planoContaOptions}
                    value={editContaCred}
                    onChange={setEditContaCred}
                    includeSinteticas
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Valor</label>
                <input
                  type="text"
                  value={editValor}
                  onChange={(e) => setEditValor(e.target.value)}
                  className="w-full text-[11px] font-mono bg-white/5 border border-brand-border px-2 py-1.5 outline-none"
                  placeholder="0,00"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-brand-border">
              <button
                type="button"
                onClick={excluirLancamento}
                className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase text-rose-600 hover:bg-rose-50"
              >
                <Trash2 size={14} aria-hidden />
                Excluir lançamento
              </button>
              <button
                type="button"
                onClick={salvarEdicao}
                className="technical-button-primary px-4 py-2 text-[10px] font-bold uppercase"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {novoAberto ? (
        <div
          className={contabil ? 'fixed inset-0 z-[230] flex items-center justify-center p-4 bg-brand-text/50' : 'fixed inset-0 z-[230] flex items-center justify-center p-4 bg-black/80'}
          role="dialog"
          aria-modal="true"
          aria-label="Novo lançamento"
          onClick={(e) => {
            if (e.target === e.currentTarget) fecharNovo();
          }}
        >
          <div
            className={
              contabil
                ? 'technical-panel w-full max-w-md p-5 space-y-4 shadow-[6px_6px_0_0_#141414] bg-brand-bg'
                : 'w-full max-w-md p-5 space-y-4 rounded-xl border border-slate-700 bg-slate-950 shadow-2xl'
            }
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className={contabil ? 'text-sm font-black uppercase tracking-tight' : 'text-sm font-black uppercase tracking-tight text-cyan-200'}>
                Novo lançamento
              </h3>
              <button
                type="button"
                onClick={fecharNovo}
                className={contabil ? 'technical-button-secondary p-1.5' : 'p-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-800'}
                aria-label="Fechar novo lançamento"
              >
                <X size={14} aria-hidden />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Data</label>
                <input
                  type="date"
                  value={brToIso(novoData)}
                  onChange={(e) => setNovoData(isoToBr(e.target.value))}
                  className="w-full text-[11px] font-mono bg-white/5 border border-brand-border px-2 py-1.5 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Valor</label>
                <input
                  type="text"
                  value={novoValor}
                  onChange={(e) => setNovoValor(e.target.value)}
                  className="w-full text-[11px] font-mono bg-white/5 border border-brand-border px-2 py-1.5 outline-none"
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Histórico</label>
                <input
                  type="text"
                  value={novoHistorico}
                  onChange={(e) => setNovoHistorico(e.target.value)}
                  className="w-full text-[11px] font-mono bg-white/5 border border-brand-border px-2 py-1.5 outline-none"
                  placeholder="Descrição do lançamento"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Conta débito</label>
                  <ExtratoContaPicker
                    ariaLabel="Conta débito - novo lançamento"
                    options={planoContaOptions}
                    value={novoContaDeb}
                    onChange={setNovoContaDeb}
                    includeSinteticas
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Conta crédito</label>
                  <ExtratoContaPicker
                    ariaLabel="Conta crédito - novo lançamento"
                    options={planoContaOptions}
                    value={novoContaCred}
                    onChange={setNovoContaCred}
                    includeSinteticas
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-brand-border">
              <button
                type="button"
                onClick={fecharNovo}
                className="technical-button-secondary px-4 py-2 text-[10px] font-bold uppercase"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvarNovo}
                disabled={parseValorInput(novoValor) <= 0 || !novoContaDeb.trim() || !novoContaCred.trim()}
                className="technical-button-primary px-4 py-2 text-[10px] font-bold uppercase disabled:opacity-40"
              >
                Lançar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default RazaoContaLancamentosModal;
