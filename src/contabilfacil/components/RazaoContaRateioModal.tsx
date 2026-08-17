import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { getNaturezaEsperada } from '../../extratoVision/utils/naturezaContabil';
import ExtratoContaPicker from './ExtratoContaPicker';
import type { ExtratoPlanoContaOption } from './ExtratoContaPicker';

interface AccountPlan {
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: 'S' | 'A';
  nivel?: number;
  group?: 'ATIVO' | 'PASSIVO' | 'PATRIMONIO_LIQUIDO' | 'RECEITA' | 'DESPESA';
  nature?: 'DEVEDORA' | 'CREDORA';
}

export type LancamentosTransferencia = {
  todos: VisionBalanceteRow[];
  invertidos: VisionBalanceteRow[];
  /**
   * Saldo de ABERTURA assinado (+ devedor, − credor) da conta imediatamente antes
   * do primeiro lançamento de `todos` — o mesmo que o Razão usa para decidir quais
   * lançamentos são causa-raiz da inversão. Sem ele o modal não tem como projetar
   * o saldo real da conta depois da reclassificação.
   */
  saldoAnterior?: number;
};

interface RazaoContaRateioModalProps {
  isOpen: boolean;
  onClose: () => void;
  contaInvertida: {
    codigo: string;
    classificacao: string;
    nome: string;
    saldoFinal: number;
  } | null;
  lancamentos: LancamentosTransferencia;
  /** Razão COMPLETO da empresa — para calcular o saldo atual da conta destino. */
  razaoCompleto: VisionBalanceteRow[];
  planoContas: AccountPlan[];
  /** novasLinhas entram no razão; lancamentosRemovidos saem (vazio nos modos de rateio). */
  onAplicarRateio: (
    novasLinhas: VisionBalanceteRow[],
    lancamentosRemovidos: VisionBalanceteRow[],
  ) => void;
}

type ModoTransferencia = 'todos' | 'invertidos' | 'ratear' | 'zerar' | 'compensacao';

type RateioRow = { id: string; conta: string; valor: string };

/** Sentido do lançamento de compensação sobre a conta de DESTINO escolhida. */
type SentidoCompensacao = 'debita_destino' | 'credita_destino';

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseValorBr(raw: string): number {
  const s = String(raw || '').trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normRed(s?: string): string {
  return String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

function mesDaData(data?: string): string {
  const m = String(data || '').match(/^\d{1,2}\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}/${m[2]}`;
}

function dataToTime(data?: string): number {
  const m = String(data || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 0;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

/** DD/MM/AAAA → dia seguinte, mesmo formato. */
function proximoDiaBr(data: string): string {
  const m = data.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return data;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  d.setDate(d.getDate() + 1);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function novaRateioRow(): RateioRow {
  return { id: `rat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, conta: '', valor: '' };
}

const MODOS: Array<{ id: ModoTransferencia; label: string; desc: string }> = [
  { id: 'todos', label: 'Todos', desc: 'Transfere os lançamentos da conta para a conta de destino — o sistema corta automaticamente o que inverteria o destino.' },
  { id: 'invertidos', label: 'Só invertidos', desc: 'Transfere apenas os lançamentos invertidos (em vermelho) — também respeitando o limite da conta de destino.' },
  { id: 'ratear', label: 'Ratear valor', desc: 'Distribui parte do saldo total para uma ou mais contas, sem desmembrar lançamentos — informe o valor de cada conta, respeitando o limite do saldo.' },
  { id: 'zerar', label: 'Zerar conta', desc: 'Detecta o saldo que sobra no fim de cada mês (do lado invertido da conta) e gera automaticamente o rateio do valor necessário para a conta escolhida.' },
  { id: 'compensacao', label: 'Compensação', desc: 'Para cada dia em que a conta fecha invertida, lança o valor exato do saldo do dia contra a conta escolhida (você decide se ela é debitada ou creditada) — e desfaz esse lançamento no dia seguinte. Repete dia a dia até a conta ficar com a natureza correta.' },
];

export function RazaoContaRateioModal({
  isOpen,
  onClose,
  contaInvertida,
  lancamentos,
  razaoCompleto,
  planoContas,
  onAplicarRateio,
}: RazaoContaRateioModalProps) {
  const [modo, setModo] = useState<ModoTransferencia>('invertidos');
  const [contaDestino, setContaDestino] = useState<string>('');
  const [rateios, setRateios] = useState<RateioRow[]>([novaRateioRow()]);
  /** Modo Compensação: o usuário escolhe se a conta selecionada (destino) é debitada ou creditada. */
  const [compensacaoSentidoEscolhido, setCompensacaoSentidoEscolhido] =
    useState<SentidoCompensacao | null>(null);
  const [preview, setPreview] = useState<VisionBalanceteRow[]>([]);
  const [previewRemovidos, setPreviewRemovidos] = useState<VisionBalanceteRow[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const limparPreview = useCallback(() => {
    setPreview([]);
    setPreviewRemovidos([]);
    setShowPreview(false);
  }, []);

  const contasDisponíveisMesmoGrupo = useMemo(() => {
    if (!contaInvertida) return [];
    const firstDigit = parseInt(contaInvertida.classificacao.charAt(0), 10);
    const estaNoAtivo = firstDigit >= 1 && firstDigit <= 3;

    return planoContas
      .filter((p) => {
        const codigo = p.code.replace(/\./g, '').replace(/^0+(?=\d)/, '');
        const firstDigitPlano = parseInt(codigo.charAt(0), 10);
        const estaNoAtivoPlan = firstDigitPlano >= 1 && firstDigitPlano <= 3;
        return estaNoAtivo === estaNoAtivoPlan && codigo !== contaInvertida.classificacao;
      })
      .map((p) => ({
        code: p.code,
        name: p.name,
        codigoReduzido: p.codigoReduzido,
        tipo: p.tipo,
        nivel: p.nivel,
        group: p.group,
      } as ExtratoPlanoContaOption));
  }, [contaInvertida, planoContas]);

  /**
   * Saldo assinado (+ devedor, − credor) da conta ORIGEM: abertura + os MESMOS
   * lançamentos que o modal reclassifica.
   *
   * Antes somava débito − crédito da conta sobre TODO o razão, o que produzia
   * uma base incompatível com o lote em duas frentes: ignorava o saldo de
   * abertura (que vem na linha "SALDO ANTERIOR", com o valor em `saldoInicial`
   * e não em débito/crédito) e incluía lançamentos de fora do período aberto no
   * Razão. Retirar do "saldo atual" um lote que nunca fez parte dele deixava o
   * "Ficará" com um resíduo fantasma — a conta aparecia ainda invertida mesmo
   * transferindo todos os lançamentos invertidos. Com a mesma base do Razão, o
   * "Ficará" do modo "Só invertidos" é exatamente o saldo corrigido da conta.
   */
  const saldoTotal = useMemo(() => {
    if (!contaInvertida) return 0;
    let s = lancamentos.saldoAnterior ?? 0;
    for (const r of lancamentos.todos) {
      s += (r.debito ?? 0) - (r.credito ?? 0);
    }
    return s;
  }, [contaInvertida, lancamentos]);
  const saldoTotalAbs = Math.abs(saldoTotal);

  const totalRateado = useMemo(
    () => rateios.reduce((acc, r) => acc + parseValorBr(r.valor), 0),
    [rateios],
  );

  const findContaDestino = useCallback(
    (code: string): AccountPlan | undefined => {
      return planoContas.find(
        (p) =>
          p.code === code ||
          p.codigoReduzido === code ||
          (p.codigoReduzido && normRed(p.codigoReduzido) === normRed(code)),
      );
    },
    [planoContas],
  );

  /** Saldo atual (D − C) de uma conta do plano dentro do razão completo. */
  const saldoContaPlano = useCallback(
    (p: AccountPlan): number => {
      const redP = normRed(p.codigoReduzido);
      const clsP = p.code.trim();
      let s = 0;
      for (const r of razaoCompleto) {
        const redR = normRed(r.codigo);
        const clsR = String(r.classificacao || '').trim();
        if ((redP && redR === redP) || (clsR && clsR === clsP)) {
          s += (r.debito ?? 0) - (r.credito ?? 0);
        }
      }
      return s;
    },
    [razaoCompleto],
  );

  /**
   * Natureza esperada da conta (CPC 26): delega para a mesma função usada no
   * resto do app (`getNaturezaEsperada`) em vez de reimplementar a heurística
   * localmente — a versão local só tratava raiz '2'/'4' como credora, então
   * contas de Receita (raiz '3' no plano deste sistema: 1 Ativo, 2 Passivo/PL,
   * 3 Receitas, 4+ Custos/Despesas) caíam no fallback devedor por engano,
   * fazendo qualquer transferência para elas ser rejeitada como "inverteria".
   */
  const naturezaEsperada = useCallback(
    (p: AccountPlan): 'D' | 'C' => {
      if (p.nature === 'CREDORA') return 'C';
      if (p.nature === 'DEVEDORA') return 'D';
      return getNaturezaEsperada(
        { nome: p.name, classificacao: p.code, codigo: p.codigoReduzido ?? p.code },
        razaoCompleto,
      );
    },
    [razaoCompleto],
  );

  const destinoSelecionado = useMemo(
    () => (contaDestino.trim() ? findContaDestino(contaDestino) : undefined),
    [contaDestino, findContaDestino],
  );
  const saldoDestino = useMemo(
    () => (destinoSelecionado ? saldoContaPlano(destinoSelecionado) : 0),
    [destinoSelecionado, saldoContaPlano],
  );
  const natDestino = destinoSelecionado ? naturezaEsperada(destinoSelecionado) : 'D';
  const destinoInvertido =
    destinoSelecionado &&
    (natDestino === 'D' ? saldoDestino < -0.005 : saldoDestino > 0.005);
  /** Quanto o destino ainda absorve antes de inverter. */
  const margemDestino = destinoSelecionado
    ? natDestino === 'C'
      ? Math.max(0, -saldoDestino)
      : Math.max(0, saldoDestino)
    : 0;

  const ultimaData = useMemo(() => {
    const datas = lancamentos.todos.map((r) => r.data).filter(Boolean) as string[];
    return datas.length ? datas[datas.length - 1] : '';
  }, [lancamentos.todos]);

  const origemPlano = useMemo(() => {
    if (!contaInvertida) return undefined;
    return planoContas.find(
      (p) =>
        p.code === contaInvertida.classificacao ||
        p.codigoReduzido === contaInvertida.codigo ||
        (p.codigoReduzido && normRed(p.codigoReduzido) === normRed(contaInvertida.codigo)),
    );
  }, [contaInvertida, planoContas]);

  const natOrigem = useMemo(() => {
    if (!contaInvertida) return 'D';
    if (origemPlano) return naturezaEsperada(origemPlano);
    return getNaturezaEsperada(
      { nome: contaInvertida.nome, classificacao: contaInvertida.classificacao, codigo: contaInvertida.codigo },
      razaoCompleto,
    );
  }, [contaInvertida, origemPlano, naturezaEsperada, razaoCompleto]);

  /**
   * Sentido efetivo da compensação. Sem escolha explícita, usa o que corrige a
   * inversão: conta devedora invertida (saldo credor) precisa de débito na origem,
   * logo o destino é creditado — e vice-versa.
   */
  const compensacaoSentido: SentidoCompensacao =
    compensacaoSentidoEscolhido ?? (natOrigem === 'D' ? 'credita_destino' : 'debita_destino');

  /** Lançamentos invertidos garantidos: NUNCA inclui lançamentos da mesma natureza da conta origem. */
  const lancamentosInvertidosSeguros = useMemo(() => {
    const rawInvertidos = lancamentos.invertidos.length > 0 ? lancamentos.invertidos : lancamentos.todos;
    return rawInvertidos.filter((r) => {
      const deb = r.debito ?? 0;
      const cred = r.credito ?? 0;
      const ownNat: 'D' | 'C' | null = deb > cred ? 'D' : cred > deb ? 'C' : null;
      // Regra inviolável: se o lançamento for da mesma natureza da conta de origem, JAMAIS pode ser reclassificado como invertido!
      if (!ownNat || ownNat === natOrigem) return false;
      return true;
    });
  }, [lancamentos, natOrigem]);

  /** Par de partida dobrada entre origem e compensação — histórico autossuficiente para o TXT. */
  const gerarParCompensacao = useCallback(
    (compensacao: AccountPlan, valor: number, data: string, historico: string, origemDebita: boolean): VisionBalanceteRow[] => {
      if (!contaInvertida) return [];
      const origemCod = contaInvertida.codigo || contaInvertida.classificacao;
      const compCod = compensacao.codigoReduzido || compensacao.code;
      const base = {
        data,
        nome: historico,
        saldoInicial: 0,
        saldoFinal: 0,
        contaDeb: origemDebita ? origemCod : compCod,
        contaCred: origemDebita ? compCod : origemCod,
        isReconciliation: true,
      };
      return [
        {
          ...base,
          codigo: origemCod,
          classificacao: contaInvertida.classificacao,
          debito: origemDebita ? valor : 0,
          credito: origemDebita ? 0 : valor,
        },
        {
          ...base,
          codigo: compCod,
          classificacao: compensacao.code,
          debito: origemDebita ? 0 : valor,
          credito: origemDebita ? valor : 0,
        },
      ];
    },
    [contaInvertida],
  );

  /**
   * Percorre os lançamentos dia a dia somando o movimento REAL (sem contar as próprias
   * correções, que são sempre revertidas no dia seguinte). Todo dia em que o saldo
   * acumulado fecha do lado errado recebe um lançamento que zera o dia contra a conta
   * de compensação — e no dia seguinte um lançamento EXATAMENTE oposto desfaz essa
   * correção, deixando o movimento real seguir intacto. Se o dia seguinte também fechar
   * invertido (considerando só o movimento real), gera uma nova correção — e assim por
   * diante — até a conta estabilizar do lado certo.
   */
  const gerarCompensacaoDiaria = useCallback(
    (compensacao: AccountPlan): VisionBalanceteRow[] => {
      const porDia = new Map<string, VisionBalanceteRow[]>();
      for (const r of lancamentos.todos) {
        if (!r.data) continue;
        if (!porDia.has(r.data)) porDia.set(r.data, []);
        porDia.get(r.data)!.push(r);
      }
      const dias = [...porDia.keys()].sort((a, b) => dataToTime(a) - dataToTime(b));
      const gerados: VisionBalanceteRow[] = [];
      let running = 0;
      for (const dia of dias) {
        for (const r of porDia.get(dia)!) running += (r.debito ?? 0) - (r.credito ?? 0);
        const invertido = natOrigem === 'D' ? running < -0.005 : running > 0.005;
        if (!invertido) continue;
        const ajuste = Math.abs(running);
        // Sentido escolhido pelo usuário: a conta selecionada é o DESTINO do
        // lançamento e ele decide se ela é debitada ou creditada. A origem recebe
        // sempre a contrapartida, no mesmo valor.
        const origemDebitaCorrecao = compensacaoSentido === 'credita_destino';
        gerados.push(
          ...gerarParCompensacao(
            compensacao,
            ajuste,
            dia,
            `COMPENSAÇÃO DIA ${dia} R$ ${fmt(ajuste)} SANAR INVERSÃO ${contaInvertida?.nome} P/ ${compensacao.name}`,
            origemDebitaCorrecao,
          ),
        );
        const diaSeguinte = proximoDiaBr(dia);
        gerados.push(
          ...gerarParCompensacao(
            compensacao,
            ajuste,
            diaSeguinte,
            `REVERSÃO COMPENSAÇÃO DE ${dia} R$ ${fmt(ajuste)} ${contaInvertida?.nome} P/ ${compensacao.name}`,
            !origemDebitaCorrecao,
          ),
        );
      }
      return gerados;
    },
    [lancamentos.todos, natOrigem, compensacaoSentido, gerarParCompensacao, contaInvertida],
  );

  /** Simula a transferência no destino: greedy anti-inversão em ordem cronológica. */
  const simularTransferencia = useCallback(
    (destino: AccountPlan, origem: VisionBalanceteRow[]) => {
      const nat = naturezaEsperada(destino);
      const saldoInicial = saldoContaPlano(destino);
      const ordenadas = [...origem].sort((a, b) => dataToTime(a.data) - dataToTime(b.data));
      const aceitos: VisionBalanceteRow[] = [];
      let running = saldoInicial;
      let pulados = 0;
      for (const l of ordenadas) {
        const delta = (l.debito ?? 0) - (l.credito ?? 0);
        const next = running + delta;
        const ok = nat === 'D' ? next >= -0.005 : next <= 0.005;
        if (ok) {
          aceitos.push(l);
          running = next;
        } else {
          pulados++;
        }
      }
      return { aceitos, pulados, saldoInicial, saldoFinal: running };
    },
    [naturezaEsperada, saldoContaPlano],
  );

  /** Origem para o modo "Ratear valor" — não tem um destino único (várias contas), então só o card da origem se aplica. */
  const resumoOrigemRateio = useMemo(() => {
    if (modo !== 'ratear') return null;
    return { origemFinal: saldoTotal - totalRateado };
  }, [modo, totalRateado, saldoTotal]);

  /**
   * Par de partida dobrada movendo `valor` da conta origem para a destino.
   * `origemCredita` decide o sentido: true = credita a origem (ela estava devedora
   * naquele valor) e debita o destino; false = o inverso. O sentido é do LOTE que
   * está sendo movido — no modo "Zerar" cada mês pode ter sentido próprio, então
   * não pode ser derivado do saldo global da conta.
   */
  const gerarParRateio = useCallback(
    (
      destino: AccountPlan,
      valor: number,
      data: string,
      historico: string,
      origemCredita: boolean,
    ): VisionBalanceteRow[] => {
      if (!contaInvertida) return [];
      const origemCod = contaInvertida.codigo || contaInvertida.classificacao;
      const destinoCod = destino.codigoReduzido || destino.code;
      const devedor = origemCredita;
      const base = {
        data,
        nome: historico,
        saldoInicial: 0,
        saldoFinal: 0,
        contaDeb: devedor ? destinoCod : origemCod,
        contaCred: devedor ? origemCod : destinoCod,
        isReconciliation: true,
      };
      return [
        {
          ...base,
          codigo: origemCod,
          classificacao: contaInvertida.classificacao,
          debito: devedor ? 0 : valor,
          credito: devedor ? valor : 0,
        },
        {
          ...base,
          codigo: destinoCod,
          classificacao: destino.code,
          debito: devedor ? valor : 0,
          credito: devedor ? 0 : valor,
        },
      ];
    },
    [contaInvertida],
  );

  /**
   * Modo "Zerar conta": fecha cada mês somando o movimento e, quando o acumulado
   * sobra do lado INVERTIDO da natureza da conta, gera o par que zera esse saldo
   * contra a conta escolhida. Antes a regra era fixa em "acumulado > 0" (saldo
   * devedor), então uma conta de natureza credora invertida a débito era tratada
   * ao contrário e uma conta devedora invertida a crédito (o caso do banco) não
   * gerava nada — "nenhum mês fechou com saldo devedor".
   */
  const gerarZerarMensal = useCallback(
    (destino: AccountPlan): VisionBalanceteRow[] => {
      if (!contaInvertida) return [];
      const porMes = new Map<string, VisionBalanceteRow[]>();
      for (const r of lancamentos.todos) {
        const mes = mesDaData(r.data);
        if (!mes) continue;
        if (!porMes.has(mes)) porMes.set(mes, []);
        porMes.get(mes)!.push(r);
      }
      const meses = [...porMes.keys()].sort((a, b) => {
        const [ma, ya] = a.split('/').map(Number);
        const [mb, yb] = b.split('/').map(Number);
        return ya !== yb ? ya - yb : ma - mb;
      });
      const gerados: VisionBalanceteRow[] = [];
      let acumulado = 0;
      for (const mes of meses) {
        const rows = [...porMes.get(mes)!].sort((a, b) => dataToTime(a.data) - dataToTime(b.data));
        for (const r of rows) acumulado += (r.debito ?? 0) - (r.credito ?? 0);
        const invertido = natOrigem === 'D' ? acumulado < -0.005 : acumulado > 0.005;
        if (!invertido) continue;
        const dataMes = rows[rows.length - 1].data || ultimaData;
        const valor = Math.abs(acumulado);
        // Histórico autossuficiente para o TXT Domínio: data e valor total do saldo
        // que este lançamento zera vão no próprio texto (sem vínculo com outro lançamento).
        gerados.push(
          ...gerarParRateio(
            destino,
            valor,
            dataMes,
            `ZERAR SALDO TOTAL R$ ${fmt(valor)} DE ${dataMes} ${contaInvertida.nome} P/ ${destino.name}`,
            acumulado > 0,
          ),
        );
        acumulado = 0;
      }
      return gerados;
    },
    [contaInvertida, lancamentos.todos, natOrigem, ultimaData, gerarParRateio],
  );

  /** Soma o efeito de linhas geradas sobre origem e destino (partida dobrada). */
  const somarDeltas = useCallback(
    (gerados: VisionBalanceteRow[]) => {
      const origemCls = (contaInvertida?.classificacao || '').trim();
      let deltaOrigem = 0;
      let deltaDestino = 0;
      for (const r of gerados) {
        const delta = (r.debito ?? 0) - (r.credito ?? 0);
        if (String(r.classificacao || '').trim() === origemCls) deltaOrigem += delta;
        else deltaDestino += delta;
      }
      return { deltaOrigem, deltaDestino };
    },
    [contaInvertida],
  );

  /**
   * FONTE ÚNICA DA VERDADE dos modos com conta destino única. Os cards de
   * origem/destino e o "Gerar preview" leem exatamente o mesmo resultado — antes
   * o card da origem assumia que o lote INTEIRO seria transferido enquanto a
   * simulação anti-inversão descartava lançamentos, mostrando por exemplo
   * "origem 0,83 D → ficará 1.100,83 D" com o destino parado em 0,00.
   */
  const plano = useMemo(() => {
    if (!contaInvertida || !destinoSelecionado) return null;

    if (modo === 'todos' || modo === 'invertidos') {
      const lote = modo === 'todos' ? lancamentos.todos : lancamentosInvertidosSeguros;
      if (lote.length === 0) {
        return {
          novasLinhas: [] as VisionBalanceteRow[],
          removidos: [] as VisionBalanceteRow[],
          qtd: 0,
          ficam: 0,
          origemFinal: saldoTotal,
          destinoFinal: saldoDestino,
          aviso: '',
          erro:
            modo === 'todos'
              ? 'Nenhum lançamento nesta conta no período.'
              : 'Nenhum lançamento invertido nesta conta no período.',
        };
      }
      const { aceitos, pulados, saldoInicial, saldoFinal } = simularTransferencia(destinoSelecionado, lote);
      const transferido = aceitos.reduce((acc, r) => acc + (r.debito ?? 0) - (r.credito ?? 0), 0);
      const codDestino = destinoSelecionado.codigoReduzido || destinoSelecionado.code;
      const novasLinhas = aceitos.map((linha) => ({
        ...linha,
        codigo: codDestino,
        classificacao: destinoSelecionado.code,
        nome: `TRANSFERÊNCIA · ${linha.nome}`,
        // A partida dobrada precisa acompanhar a troca de conta: o lado que
        // pertencia à conta de ORIGEM passa a ser a conta de DESTINO. Sem isso a
        // linha ia para a conta nova mas continuava carregando contaDeb/contaCred
        // do lançamento original — e o TXT Domínio, que exporta por esses campos,
        // reemitia a partida antiga (duplicando valor na origem e no banco) e
        // nunca lançava nada na conta de destino.
        ...((linha.debito ?? 0) > 0 ? { contaDeb: codDestino } : { contaCred: codDestino }),
      }));
      return {
        novasLinhas,
        removidos: aceitos,
        qtd: aceitos.length,
        ficam: pulados,
        origemFinal: saldoTotal - transferido,
        destinoFinal: saldoFinal,
        aviso:
          pulados > 0
            ? `${pulados} lançamento(s) ficaram de fora automaticamente para não inverter ${destinoSelecionado.name} ` +
              `(saldo atual R$ ${fmt(Math.abs(saldoInicial))} ${saldoInicial >= 0 ? 'D' : 'C'} → ficará R$ ${fmt(Math.abs(saldoFinal))} ${saldoFinal >= 0 ? 'D' : 'C'}).`
            : '',
        erro:
          aceitos.length === 0
            ? `Nenhum lançamento cabe em ${destinoSelecionado.name} sem invertê-la — saldo atual R$ ${fmt(Math.abs(saldoInicial))} ${saldoInicial >= 0 ? 'D' : 'C'}.`
            : '',
      };
    }

    if (modo === 'zerar' || modo === 'compensacao') {
      const gerados =
        modo === 'zerar'
          ? gerarZerarMensal(destinoSelecionado)
          : gerarCompensacaoDiaria(destinoSelecionado);
      const { deltaOrigem, deltaDestino } = somarDeltas(gerados);
      const destinoFinal = saldoDestino + deltaDestino;
      const destinoInverte =
        natDestino === 'D' ? destinoFinal < -0.005 : destinoFinal > 0.005;
      return {
        novasLinhas: gerados,
        removidos: [] as VisionBalanceteRow[],
        qtd: gerados.length / 2,
        ficam: 0,
        origemFinal: saldoTotal + deltaOrigem,
        destinoFinal,
        // Zerar/compensação não podem "cortar" lançamentos (o objetivo é fechar a
        // origem), então o limite do destino vira aviso em vez de descarte.
        aviso: destinoInverte
          ? `Atenção: ${destinoSelecionado.name} ficará invertida (R$ ${fmt(Math.abs(destinoFinal))} ${destinoFinal >= 0 ? 'D' : 'C'}) ao absorver este valor.`
          : '',
        erro:
          gerados.length === 0
            ? modo === 'zerar'
              ? `Nenhum mês fechou com saldo invertido em ${contaInvertida.nome} — nada a zerar.`
              : `Nenhum dia fechou invertido — ${contaInvertida.nome} já está com a natureza correta.`
            : '',
      };
    }

    return null;
  }, [
    contaInvertida,
    destinoSelecionado,
    modo,
    lancamentos.todos,
    lancamentosInvertidosSeguros,
    simularTransferencia,
    gerarZerarMensal,
    gerarCompensacaoDiaria,
    somarDeltas,
    saldoTotal,
    saldoDestino,
    natDestino,
  ]);

  const gerarPreview = useCallback(() => {
    if (!contaInvertida) return;

    // Modos com conta destino única: preview = exatamente o plano já exibido nos cards.
    if (modo === 'todos' || modo === 'invertidos' || modo === 'zerar' || modo === 'compensacao') {
      if (!contaDestino.trim()) {
        window.alert(
          modo === 'zerar'
            ? 'Selecione a conta que vai receber o rateio automático.'
            : modo === 'compensacao'
              ? 'Selecione a conta de compensação.'
              : 'Selecione a conta de destino.',
        );
        return;
      }
      if (!plano) {
        window.alert('Conta de destino inválida.');
        return;
      }
      if (plano.erro) {
        window.alert(plano.erro);
        return;
      }
      setPreview(plano.novasLinhas);
      setPreviewRemovidos(plano.removidos);
      setShowPreview(true);
      return;
    }

    if (modo === 'ratear') {
      const validos = rateios.filter((r) => r.conta.trim() && parseValorBr(r.valor) > 0);
      if (validos.length === 0) {
        window.alert('Adicione ao menos uma conta com valor para ratear.');
        return;
      }
      const soma = validos.reduce((acc, r) => acc + parseValorBr(r.valor), 0);
      if (soma > saldoTotalAbs + 0.005) {
        window.alert(
          `O total rateado (R$ ${fmt(soma)}) ultrapassa o saldo da conta (R$ ${fmt(saldoTotalAbs)}).`,
        );
        return;
      }
      const gerados: VisionBalanceteRow[] = [];
      for (const r of validos) {
        const destino = findContaDestino(r.conta);
        if (!destino) {
          window.alert(`Conta de destino inválida: ${r.conta}`);
          return;
        }
        const valor = parseValorBr(r.valor);
        // Histórico autossuficiente: no TXT Domínio o lançamento sai SOZINHO (sem vínculo
        // com o lançamento original) — a data e o valor total do qual faz parte vão no texto.
        gerados.push(
          ...gerarParRateio(
            destino,
            valor,
            ultimaData,
            `RATEIO R$ ${fmt(valor)} PARTE DO TOTAL R$ ${fmt(saldoTotalAbs)} DE ${ultimaData} ${contaInvertida.nome} P/ ${destino.name}`,
            // Saldo devedor: credita a origem (reduz) e debita o destino; credor: inverso.
            saldoTotal >= 0,
          ),
        );
      }
      setPreview(gerados);
      setPreviewRemovidos([]);
      setShowPreview(true);
    }
  }, [
    contaInvertida,
    modo,
    contaDestino,
    plano,
    rateios,
    saldoTotal,
    saldoTotalAbs,
    findContaDestino,
    gerarParRateio,
    ultimaData,
  ]);

  /** Remove um lançamento do preview de transferência (modos todos/invertidos). */
  const removerDoPreview = useCallback((idx: number) => {
    setPreview((prev) => prev.filter((_, i) => i !== idx));
    setPreviewRemovidos((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleAplicar = useCallback(() => {
    if (preview.length === 0) {
      window.alert('Gere um preview primeiro.');
      return;
    }
    onAplicarRateio(preview, previewRemovidos);
    setContaDestino('');
    setRateios([novaRateioRow()]);
    limparPreview();
    onClose();
  }, [preview, previewRemovidos, onAplicarRateio, limparPreview, onClose]);

  if (!isOpen || !contaInvertida) return null;

  const modoInfo = MODOS.find((m) => m.id === modo)!;
  const precisaContaUnica =
    modo === 'todos' || modo === 'invertidos' || modo === 'zerar' || modo === 'compensacao';
  const modoTransferencia = modo === 'todos' || modo === 'invertidos';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300] p-4">
      <div className="bg-brand-bg border border-brand-border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-brand-border sticky top-0 bg-brand-bg z-10">
          <div>
            <h2 className="text-sm font-black uppercase tracking-widest">RECLASSIFICAÇÃO E COMPENSAÇÃO</h2>
            <p className="text-[9px] opacity-60 mt-1">
              {contaInvertida.nome} ({contaInvertida.classificacao})
            </p>
            <p className="text-[9px] font-mono mt-1">
              Saldo atual: <strong>R$ {fmt(saldoTotalAbs)} {saldoTotal >= 0 ? 'D' : 'C'}</strong>
              {' · '}
              {/* Conta os invertidos REALMENTE elegíveis (mesma lista usada pelo modo
                  "Só invertidos"), e não o bruto recebido — evita prometer no cabeçalho
                  lançamentos que o modo nunca moveria. */}
              {lancamentos.todos.length} lançamento(s) · {lancamentosInvertidosSeguros.length} invertido(s)
            </p>
          </div>
          <button onClick={onClose} className="text-brand-border hover:text-brand-text shrink-0">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Seletor de modo */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-2">Modo</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
              {MODOS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setModo(m.id);
                    limparPreview();
                  }}
                  className={`px-2 py-2 text-[9px] font-black uppercase border transition ${
                    modo === m.id
                      ? 'bg-brand-text text-white border-brand-text'
                      : 'bg-white text-brand-text border-brand-border hover:bg-brand-sidebar/30'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[9px] opacity-60 mt-2">{modoInfo.desc}</p>
          </div>

          {/* Conta única (todos / invertidos / zerar / compensação) */}
          {precisaContaUnica && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest mb-2">
                {modo === 'zerar'
                  ? 'Conta que recebe o rateio automático'
                  : modo === 'compensacao'
                    ? 'Conta de compensação (contrapartida)'
                    : 'Transferir para'}
              </label>
              <ExtratoContaPicker
                value={contaDestino}
                options={contasDisponíveisMesmoGrupo}
                lookupOptions={contasDisponíveisMesmoGrupo}
                placeholder="Selecione a conta de destino…"
                includeSinteticas
                onChange={(c) => {
                  setContaDestino(c);
                  limparPreview();
                }}
              />
              {destinoSelecionado && (
                <div
                  className={`mt-2 border px-3 py-2 text-[9px] font-mono ${
                    destinoInvertido
                      ? 'border-red-400 bg-red-50 text-red-800'
                      : 'border-brand-border bg-brand-sidebar/20'
                  }`}
                >
                  <strong>{destinoSelecionado.name}</strong> · Saldo atual:{' '}
                  <strong>
                    R$ {fmt(Math.abs(saldoDestino))} {saldoDestino >= 0 ? 'D' : 'C'}
                  </strong>{' '}
                  · Natureza {natDestino === 'D' ? 'Devedora' : 'Credora'}
                  {destinoInvertido
                    ? ' · JÁ ESTÁ INVERTIDA'
                    : ` · Margem antes de inverter: R$ ${fmt(margemDestino)}`}
                </div>
              )}
              {/* Compensação: o usuário decide o sentido do lançamento na conta de destino. */}
              {modo === 'compensacao' && (
                <div className="mt-2">
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1">
                    Lançamento na conta de destino
                  </label>
                  <div className="grid grid-cols-2 gap-1">
                    {([
                      { id: 'debita_destino' as const, label: 'Debitar destino' },
                      { id: 'credita_destino' as const, label: 'Creditar destino' },
                    ]).map((op) => (
                      <button
                        key={op.id}
                        type="button"
                        onClick={() => {
                          setCompensacaoSentidoEscolhido(op.id);
                          limparPreview();
                        }}
                        className={`px-2 py-2 text-[9px] font-black uppercase border transition ${
                          compensacaoSentido === op.id
                            ? 'bg-brand-text text-white border-brand-text'
                            : 'bg-white text-brand-text border-brand-border hover:bg-brand-sidebar/30'
                        }`}
                      >
                        {op.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] opacity-60 mt-1 font-mono">
                    {compensacaoSentido === 'debita_destino'
                      ? `D ${destinoSelecionado?.name ?? 'destino'} / C ${contaInvertida.nome}`
                      : `D ${contaInvertida.nome} / C ${destinoSelecionado?.name ?? 'destino'}`}
                    {' — mesmo valor nos dois lados; a reversão do dia seguinte inverte o par.'}
                  </p>
                </div>
              )}
              {/* Motivo pelo qual o modo atual não produz nenhum lançamento nesta conta. */}
              {plano?.erro && (
                <p className="mt-2 border border-amber-400 bg-amber-50 text-amber-900 px-3 py-2 text-[9px] font-mono">
                  {plano.erro}
                </p>
              )}
            </div>
          )}

          {plano && !plano.erro && destinoSelecionado && (
            <div className="grid grid-cols-2 gap-2">
              <div className="border border-brand-border bg-white px-3 py-2 text-[9px] font-mono">
                <p className="font-black uppercase tracking-wide opacity-70 mb-1">
                  Origem · {contaInvertida.nome}
                  {plano.qtd > 0 ? ` (${plano.qtd})` : ''}
                </p>
                Saldo atual: <strong>
                  R$ {fmt(saldoTotalAbs)} {saldoTotal >= 0 ? 'D' : 'C'}
                </strong>
                <br />
                Ficará: <strong>
                  R$ {fmt(Math.abs(plano.origemFinal))}{' '}
                  {plano.origemFinal >= 0 ? 'D' : 'C'}
                </strong>
                {plano.ficam > 0 && (
                  <>
                    <br />
                    <span className="opacity-70">{plano.ficam} lançamento(s) permanecem aqui</span>
                  </>
                )}
              </div>
              <div className="border border-brand-border bg-white px-3 py-2 text-[9px] font-mono">
                <p className="font-black uppercase tracking-wide opacity-70 mb-1">
                  Destino · {destinoSelecionado.name}
                </p>
                Saldo atual: <strong>
                  R$ {fmt(Math.abs(saldoDestino))} {saldoDestino >= 0 ? 'D' : 'C'}
                </strong>
                <br />
                Ficará: <strong>
                  R$ {fmt(Math.abs(plano.destinoFinal))}{' '}
                  {plano.destinoFinal >= 0 ? 'D' : 'C'}
                </strong>
              </div>
            </div>
          )}
          {/* Aviso do plano (corte automático / destino que ficará invertido) já na seleção. */}
          {plano && !plano.erro && plano.aviso && (
            <div className="border border-amber-400 bg-amber-50 text-amber-900 px-3 py-2 text-[9px] font-mono">
              {plano.aviso}
            </div>
          )}

          {resumoOrigemRateio && (
            <div className="grid grid-cols-1 gap-2">
              <div className="border border-brand-border bg-white px-3 py-2 text-[9px] font-mono">
                <p className="font-black uppercase tracking-wide opacity-70 mb-1">
                  Origem · {contaInvertida.nome}
                </p>
                Saldo atual: <strong>
                  R$ {fmt(saldoTotalAbs)} {saldoTotal >= 0 ? 'D' : 'C'}
                </strong>
                <br />
                Ficará: <strong>
                  R$ {fmt(Math.abs(resumoOrigemRateio.origemFinal))}{' '}
                  {resumoOrigemRateio.origemFinal >= 0 ? 'D' : 'C'}
                </strong>
              </div>
            </div>
          )}

          {/* Rateio manual (várias contas + valor) */}
          {modo === 'ratear' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[10px] font-black uppercase tracking-widest">
                  Contas do rateio
                </label>
                <p className="text-[9px] font-mono">
                  Rateado: <strong>R$ {fmt(totalRateado)}</strong> · Restante:{' '}
                  <strong className={totalRateado > saldoTotalAbs + 0.005 ? 'text-red-600' : ''}>
                    R$ {fmt(Math.max(0, saldoTotalAbs - totalRateado))}
                  </strong>
                </p>
              </div>
              <div className="space-y-1.5">
                {rateios.map((r) => {
                  const contaRateio = r.conta.trim() ? findContaDestino(r.conta) : undefined;
                  const saldoRateio = contaRateio ? saldoContaPlano(contaRateio) : 0;
                  return (
                    <div key={r.id}>
                      <div className="grid grid-cols-[minmax(0,1fr)_110px_28px] gap-1.5 items-center">
                        <ExtratoContaPicker
                          value={r.conta}
                          options={contasDisponíveisMesmoGrupo}
                          lookupOptions={contasDisponíveisMesmoGrupo}
                          placeholder="Conta…"
                          includeSinteticas
                          onChange={(c) => {
                            setRateios((prev) => prev.map((x) => (x.id === r.id ? { ...x, conta: c } : x)));
                            limparPreview();
                          }}
                        />
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          value={r.valor}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRateios((prev) => prev.map((x) => (x.id === r.id ? { ...x, valor: v } : x)));
                            limparPreview();
                          }}
                          className="h-[26px] border border-brand-border bg-white px-2 text-[10px] font-mono font-bold text-right"
                          aria-label="Valor do rateio"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setRateios((prev) =>
                              prev.length > 1 ? prev.filter((x) => x.id !== r.id) : prev,
                            );
                            limparPreview();
                          }}
                          className="h-[26px] border border-brand-border flex items-center justify-center hover:bg-red-50"
                          aria-label="Remover conta do rateio"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {contaRateio && (
                        <p className="text-[8px] font-mono opacity-70 mt-0.5 pl-1">
                          Saldo atual de {contaRateio.name}: R$ {fmt(Math.abs(saldoRateio))}{' '}
                          {saldoRateio >= 0 ? 'D' : 'C'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setRateios((prev) => [...prev, novaRateioRow()])}
                className="technical-button mt-2 px-3 py-1.5 text-[9px] font-bold uppercase flex items-center gap-1.5"
              >
                <Plus size={12} /> Adicionar conta
              </button>
            </div>
          )}

          {/* Preview */}
          {showPreview && preview.length > 0 && (
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-1">
                Preview: {preview.length} linha(s)
                {modoTransferencia &&
                  previewRemovidos.length > 0 &&
                  ` · ${previewRemovidos.length} lançamento(s) saem de ${contaInvertida.nome}`}
              </h3>
              {(modo === 'ratear' || modo === 'zerar') && (
                <p className="text-[9px] font-mono opacity-70 mb-2">
                  Saldo total: R$ {fmt(saldoTotalAbs)} · Rateado agora: R${' '}
                  {fmt(preview.reduce((a, r) => a + (r.debito ?? 0), 0))} em{' '}
                  {new Set(preview.map((r) => r.classificacao).filter((c) => c !== contaInvertida.classificacao)).size}{' '}
                  conta(s) — os lançamentos originais permanecem inteiros na conta.
                </p>
              )}
              <div className="border border-brand-border rounded-lg overflow-x-auto">
                <table className="w-full text-[8px]">
                  <thead>
                    <tr className="border-b border-brand-border bg-brand-sidebar/20">
                      <th className="px-2 py-1 text-left font-bold w-[70px]">Data</th>
                      <th className="px-2 py-1 text-left font-bold w-[55px]">Código</th>
                      <th className="px-2 py-1 text-left font-bold">Descrição</th>
                      <th className="px-2 py-1 text-right font-bold w-[75px]">Débito</th>
                      <th className="px-2 py-1 text-right font-bold w-[75px]">Crédito</th>
                      {modoTransferencia && <th className="px-1 py-1 w-[28px]" aria-label="Remover" />}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((linha, idx) => (
                      <tr key={idx} className="border-b border-brand-border hover:bg-brand-sidebar/10">
                        <td className="px-2 py-1 font-mono text-center">{linha.data || '—'}</td>
                        <td className="px-2 py-1 font-mono">{linha.codigo}</td>
                        <td className="px-2 py-1 truncate max-w-[240px]">{linha.nome}</td>
                        <td className="px-2 py-1 text-right font-mono">
                          {linha.debito > 0 ? fmt(linha.debito) : '—'}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          {linha.credito > 0 ? fmt(linha.credito) : '—'}
                        </td>
                        {modoTransferencia && (
                          <td className="px-1 py-1 text-center">
                            <button
                              type="button"
                              onClick={() => removerDoPreview(idx)}
                              className="h-[18px] w-[18px] border border-brand-border/60 inline-flex items-center justify-center hover:bg-red-50"
                              title="Retirar este lançamento da transferência"
                              aria-label="Retirar da transferência"
                            >
                              <X size={10} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-6 border-t border-brand-border justify-end">
          <button onClick={onClose} className="technical-button px-4 py-2 text-xs font-bold uppercase">
            Cancelar
          </button>
          <button
            onClick={gerarPreview}
            className="technical-button-secondary px-4 py-2 text-xs font-bold uppercase"
          >
            GERAR PREVIEW
          </button>
          {preview.length > 0 && (
            <button
              onClick={handleAplicar}
              className="technical-button-primary px-6 py-2 text-xs font-bold uppercase"
            >
              APLICAR
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
