import { derivePlanoGroupFromCode } from './planoContasMapper';

export type ExtratoContaPlanoLike = {
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: 'S' | 'A';
  group?: string;
};

/** Classificação contábil da operação bancária (regras de partida dobrada). */
export type ExtratoOperacaoLogica =
  | 'SAIDA_DESPESA'
  | 'ENTRADA_RECEITA'
  | 'TARIFA_BANCARIA'
  | 'JUROS_IOF'
  | 'PAGAMENTO_FORNECEDOR'
  | 'RECEBIMENTO_CLIENTE'
  | 'LIQUIDACAO_COBRANCA'
  | 'EMPRESTIMO_PAGAMENTO'
  | 'EMPRESTIMO_RECEBIMENTO'
  /** Saída de caixa concedendo empréstimo/mútuo → contrapartida no ATIVO. */
  | 'EMPRESTIMO_CONCESSAO'
  | 'TRANSFERENCIA'
  | 'FOLHA_PAGAMENTO'
  | 'PAGAMENTO_SOCIO'
  | 'IMPOSTO_TRIBUTO'
  | 'APLICACAO_FINANCEIRA'
  | 'SAQUE';

function normCls(code: string): string {
  return code.replace(/[^\d]/g, '').trim();
}

function normNome(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function isAnalitica(c: ExtratoContaPlanoLike): boolean {
  return c.tipo !== 'S';
}

const HINT_FORNECEDOR_ESTRANGEIRO =
  /ESTRANGEIRO|EXTERIOR|IMPORTACAO|\bIMPORT\b|CAMBIO|SWIFT|OFFSHORE|COMEX/;

/** Contas que um contador nunca usaria como contrapartida automática de extrato bancário genérico. */
export function isContaProibidaContrapartidaAutomatica(
  c: ExtratoContaPlanoLike,
  logica: ExtratoOperacaoLogica,
  significado: string,
): boolean {
  const n = normNome(c.name);
  const cls = normCls(c.code);
  const s = significado;

  if (/RESULTADO\s+DO\s+EXERCICIO|PATRIMONIO\s+LIQUIDO|CAPITAL\s+SOCIAL|RESERVA/.test(n)) {
    return true;
  }
  if (logica === 'TARIFA_BANCARIA' && /RESULTADO|EXERCICIO|IMPOSTO|PROVISAO/.test(n)) {
    return true;
  }
  if (/^511|^213|^21201|^21202/.test(cls) && /PROVISAO|IRPJ|CSLL|IMPOSTO/.test(n)) {
    if (logica !== 'IMPOSTO_TRIBUTO') return true;
  }
  if (/BAIXA\s+CUSTO|CMV|MERCADORIA\s+VENDIDA|CUSTO\s+MER/.test(n) || /^11501|^11502/.test(cls)) {
    if (logica === 'PAGAMENTO_FORNECEDOR' || logica === 'RECEBIMENTO_CLIENTE') return true;
    if (logica === 'SAIDA_DESPESA' && !/COMPRA|ESTOQUE|MERCADORIA/.test(s)) return true;
  }
  if (/EMPRESTIMO|FINANCIAMENTO/.test(n) && logica === 'RECEBIMENTO_CLIENTE') {
    if (!/EMPREST|LIBERAC|CONTRAT/.test(s)) return true;
  }
  if (/EMPRESTIMO|FINANCIAMENTO/.test(n) && logica === 'PAGAMENTO_FORNECEDOR') {
    return true;
  }
  if (/ESTRANGEIRO|EXTERIOR/.test(n) && logica === 'PAGAMENTO_FORNECEDOR') {
    if (!HINT_FORNECEDOR_ESTRANGEIRO.test(s)) return true;
  }
  if (/FORNECEDOR.*NACIONAL|\bNACIONAL\b/.test(n) && logica === 'PAGAMENTO_FORNECEDOR') {
    if (!/\bNACIONAL\b/.test(s) || HINT_FORNECEDOR_ESTRANGEIRO.test(s)) return true;
  }
  if (/JUROS\s+SOBRE|CAPITAL\s+PROPRIO/.test(n) && logica !== 'JUROS_IOF') {
    return true;
  }
  return false;
}

function pickConta(
  plano: ExtratoContaPlanoLike[],
  pred: (c: ExtratoContaPlanoLike) => boolean,
  logica: ExtratoOperacaoLogica,
  significado: string,
): string {
  for (const c of plano) {
    if (!isAnalitica(c)) continue;
    if (isContaProibidaContrapartidaAutomatica(c, logica, significado)) continue;
    if (pred(c)) return c.code.trim();
  }
  return '';
}

/** Pagamento genérico → Fornecedores Diversos; contas específicas só com evidência no histórico. */
export function pickContaFornecedorExtrato(
  plano: ExtratoContaPlanoLike[],
  significado: string,
  tokens: string[],
): string {
  const s = significado;
  const querEstrangeiro = HINT_FORNECEDOR_ESTRANGEIRO.test(s);
  const querNacional = /\bNACIONAL\b/.test(s) && !querEstrangeiro;

  let diversos = '';
  let estrangeiros = '';
  let nacionais = '';
  let bestEspecifico = '';
  let bestScore = 0;

  for (const c of plano) {
    if (!isAnalitica(c)) continue;
    if (isContaProibidaContrapartidaAutomatica(c, 'PAGAMENTO_FORNECEDOR', s)) continue;
    const g = c.group ?? derivePlanoGroupFromCode(c.code);
    if (g !== 'PASSIVO') continue;
    const n = normNome(c.name);
    if (!/FORNECEDOR|\bFORN\b|DUPLICATA|OBRIGAC/.test(n)) continue;

    if (/FORNECEDOR.*DIV\b|FORNECEDORES DIVERSOS|\bFORN DIV\b/.test(n)) {
      diversos = c.code.trim();
      continue;
    }
    if (/ESTRANGEIRO|EXTERIOR/.test(n)) {
      estrangeiros = c.code.trim();
      continue;
    }
    if (/NACIONAL/.test(n)) {
      nacionais = c.code.trim();
      continue;
    }

    let score = 0;
    for (const tok of tokens) {
      if (tok.length >= 5 && n.includes(tok)) score += tok.length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestEspecifico = c.code.trim();
    }
  }

  if (bestScore >= 10) return bestEspecifico;
  if (querEstrangeiro && estrangeiros) return estrangeiros;
  if (querNacional && nacionais) return nacionais;
  return diversos || nacionais || bestEspecifico || '';
}

function scoreContaPorTokensNome(n: string, personTokens: string[]): number {
  if (!personTokens.length) return 0;
  let score = 0;
  for (const tok of personTokens) {
    if (tok.length >= 3 && n.includes(tok)) score += tok.length;
  }
  return score;
}

/** Funcionário cadastrado — conta analítica com nome ou folha/salários a pagar. */
export function pickContaFuncionarioExtrato(
  plano: ExtratoContaPlanoLike[],
  nomePessoa: string,
): string {
  const personTokens = nomePessoa
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !/^(DE|DA|DO|DOS|DAS|E)$/.test(t));

  let bestNamed = '';
  let bestNamedScore = 0;
  for (const c of plano) {
    if (!isAnalitica(c)) continue;
    if (isContaProibidaContrapartidaAutomatica(c, 'FOLHA_PAGAMENTO', nomePessoa)) continue;
    const g = c.group ?? derivePlanoGroupFromCode(c.code);
    if (g !== 'PASSIVO' && g !== 'DESPESA') continue;
    const n = normNome(c.name);
    if (!/SALARIO|FOLHA|ADIANT|REMUN|ORDENADO|COLABORADOR|FUNCION/.test(n)) continue;
    const score = scoreContaPorTokensNome(n, personTokens);
    if (score > bestNamedScore) {
      bestNamedScore = score;
      bestNamed = c.code.trim();
    }
  }
  if (bestNamedScore >= 6) return bestNamed;

  return pickConta(
    plano,
    (c) => {
      const g = c.group ?? derivePlanoGroupFromCode(c.code);
      return g === 'PASSIVO' && /SALARIO|FOLHA|ADIANT|REMUN|ORDENADO/.test(normNome(c.name));
    },
    'FOLHA_PAGAMENTO',
    nomePessoa,
  );
}

/** Sócio cadastrado — pró-labore, adiantamento ou retirada de sócios. */
export function pickContaSocioExtrato(
  plano: ExtratoContaPlanoLike[],
  nomePessoa: string,
): string {
  const personTokens = nomePessoa
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !/^(DE|DA|DO|DOS|DAS|E)$/.test(t));

  let bestNamed = '';
  let bestNamedScore = 0;
  for (const c of plano) {
    if (!isAnalitica(c)) continue;
    if (isContaProibidaContrapartidaAutomatica(c, 'PAGAMENTO_SOCIO', nomePessoa)) continue;
    const g = c.group ?? derivePlanoGroupFromCode(c.code);
    if (g !== 'PASSIVO' && g !== 'PATRIMONIO_LIQUIDO' && g !== 'DESPESA') continue;
    const n = normNome(c.name);
    if (!/PRO LABORE|PROLABORE|SOCIO|RETIRADA|DISTR|LUCRO|DIVIDENDO|CAPITAL/.test(n)) continue;
    const score = scoreContaPorTokensNome(n, personTokens);
    if (score > bestNamedScore) {
      bestNamedScore = score;
      bestNamed = c.code.trim();
    }
  }
  if (bestNamedScore >= 6) return bestNamed;

  return (
    pickConta(
      plano,
      (c) => /PRO LABORE|PROLABORE/.test(normNome(c.name)),
      'PAGAMENTO_SOCIO',
      nomePessoa,
    ) ||
    pickConta(
      plano,
      (c) => {
        const g = c.group ?? derivePlanoGroupFromCode(c.code);
        return (
          (g === 'PASSIVO' || g === 'PATRIMONIO_LIQUIDO') &&
          /SOCIO|RETIRADA|ADIANT.*SOC|DISTR.*LUCRO/.test(normNome(c.name))
        );
      },
      'PAGAMENTO_SOCIO',
      nomePessoa,
    )
  );
}

/** Escolha explícita de contrapartida — ordem de preferência contábil (CPC 26 / ITG 2000). */
export function escolherContrapartidaContabilSenior(
  plano: ExtratoContaPlanoLike[],
  logica: ExtratoOperacaoLogica,
  significado: string,
  tokens: string[],
): string {
  const tokenStr = tokens.join(' ');

  switch (logica) {
    case 'PAGAMENTO_FORNECEDOR':
      return pickContaFornecedorExtrato(plano, significado, tokens);

    case 'RECEBIMENTO_CLIENTE':
    case 'LIQUIDACAO_COBRANCA':
      return (
        pickConta(
          plano,
          (c) => {
            const g = c.group ?? derivePlanoGroupFromCode(c.code);
            const n = normNome(c.name);
            return (
              (g === 'ATIVO' || g === 'PASSIVO') &&
              /CLIENTE|DUPLICATA|CONTAS A RECEBER|CREDITO/.test(n)
            );
          },
          logica,
          significado,
        ) ||
        pickConta(
          plano,
          (c) => {
            const g = c.group ?? derivePlanoGroupFromCode(c.code);
            return g === 'RECEITA' && /RECEITA|VENDA|SERVICO|FATURAMENTO/.test(normNome(c.name));
          },
          logica,
          significado,
        )
      );

    case 'TARIFA_BANCARIA':
      return pickConta(
        plano,
        (c) => {
          const g = c.group ?? derivePlanoGroupFromCode(c.code);
          return (
            g === 'DESPESA' &&
            /TARIFA|DESPESA FINANCEIRA|ENCARGO|SERVICO BANC|CESTA/.test(normNome(c.name))
          );
        },
        logica,
        significado,
      );

    case 'JUROS_IOF':
      return (
        pickConta(
          plano,
          (c) => {
            const g = c.group ?? derivePlanoGroupFromCode(c.code);
            return g === 'DESPESA' && /IOF|JUROS|ENCARGO|MORA/.test(normNome(c.name));
          },
          logica,
          significado,
        ) ||
        pickConta(
          plano,
          (c) => {
            const g = c.group ?? derivePlanoGroupFromCode(c.code);
            return g === 'PASSIVO' && /EMPRESTIMO|FINANCIAMENTO/.test(normNome(c.name));
          },
          logica,
          significado,
        )
      );

    case 'EMPRESTIMO_CONCESSAO':
      // Dinheiro saindo = empréstimo a receber / mútuo ativo (não passivo).
      return (
        pickConta(
          plano,
          (c) => {
            const g = c.group ?? derivePlanoGroupFromCode(c.code);
            const n = normNome(c.name);
            return (
              g === 'ATIVO' &&
              /EMPRESTIMO|FINANCIAMENTO|MUTUO|M[UÚ]TUO|A\s+RECEBER|COLIGAD|PARTES?\s+RELACIONAD|INTERCOMPANY/.test(
                n,
              )
            );
          },
          logica,
          significado,
        ) ||
        pickConta(
          plano,
          (c) => {
            const g = c.group ?? derivePlanoGroupFromCode(c.code);
            return g === 'ATIVO' && /EMPRESTIMO|MUTUO|M[UÚ]TUO/.test(normNome(c.name));
          },
          logica,
          significado,
        )
      );

    case 'EMPRESTIMO_PAGAMENTO':
      // Amortização / pagamento de dívida de empréstimo → passivo.
      return pickConta(
        plano,
        (c) => {
          const g = c.group ?? derivePlanoGroupFromCode(c.code);
          return g === 'PASSIVO' && /EMPRESTIMO|FINANCIAMENTO|MUTUO|M[UÚ]TUO/.test(normNome(c.name));
        },
        logica,
        significado,
      );

    case 'EMPRESTIMO_RECEBIMENTO':
      // Liberação / entrada de empréstimo tomado → passivo.
      return pickConta(
        plano,
        (c) => {
          const g = c.group ?? derivePlanoGroupFromCode(c.code);
          return g === 'PASSIVO' && /EMPRESTIMO|FINANCIAMENTO|MUTUO|M[UÚ]TUO/.test(normNome(c.name));
        },
        logica,
        significado,
      );

    case 'IMPOSTO_TRIBUTO':
      return (
        pickConta(
          plano,
          (c) => {
            const g = c.group ?? derivePlanoGroupFromCode(c.code);
            return g === 'PASSIVO' && /IMPOSTO|TRIBUTO|DARF|GPS|ISS|IRPJ|CSLL|PIS|COFINS/.test(normNome(c.name));
          },
          logica,
          significado,
        ) ||
        pickConta(
          plano,
          (c) => {
            const g = c.group ?? derivePlanoGroupFromCode(c.code);
            return g === 'DESPESA' && /IMPOSTO|TRIBUTO/.test(normNome(c.name));
          },
          logica,
          significado,
        )
      );

    case 'FOLHA_PAGAMENTO':
      return pickConta(
        plano,
        (c) => {
          const g = c.group ?? derivePlanoGroupFromCode(c.code);
          return g === 'PASSIVO' && /SALARIO|FOLHA|PRO LABORE|ENCARGO/.test(normNome(c.name));
        },
        logica,
        significado,
      );

    case 'PAGAMENTO_SOCIO':
      return pickContaSocioExtrato(plano, significado);

    case 'SAQUE':
      return (
        pickConta(
          plano,
          (c) => normNome(c.name).includes('CAIXA') && !/BANCO/.test(normNome(c.name)),
          logica,
          significado,
        ) ||
        pickConta(
          plano,
          (c) => /PRO LABORE|SOCIO|RETIRADA/.test(normNome(c.name)),
          logica,
          significado,
        )
      );

    case 'SAIDA_DESPESA':
    case 'ENTRADA_RECEITA':
    default:
      break;
  }

  if (tokens.length > 0) {
    let best = '';
    let bestScore = 0;
    for (const c of plano) {
      if (!isAnalitica(c)) continue;
      if (isContaProibidaContrapartidaAutomatica(c, logica, significado)) continue;
      const g = c.group ?? derivePlanoGroupFromCode(c.code);
      if (logica === 'SAIDA_DESPESA' && g !== 'DESPESA' && g !== 'PASSIVO') continue;
      if (logica === 'ENTRADA_RECEITA' && g !== 'RECEITA' && g !== 'PASSIVO') continue;
      const n = normNome(c.name);
      let score = 0;
      for (const tok of tokens) {
        if (n.includes(tok)) score += tok.length >= 5 ? 3 : 2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = c.code.trim();
      }
    }
    if (best) return best;
  }

  if ((logica as string) === 'PAGAMENTO_FORNECEDOR') {
    return pickContaFornecedorExtrato(plano, significado, tokens);
  }

  return '';
}

export function cacheKeyExtratoConta(significado: string, nature: 'D' | 'C'): string {
  const sig = significado.trim();
  if (!sig) return '';
  return `${sig}|${nature}`;
}

const HINTS_HISTORICO_CLARO =
  /FORNEC|COMPE|TIT\.|TITULO|TEF\b|COBRAN|BOLETO|PIX\s*EMIT|EMIT\.?\s*OUT|PIXEMIT|TARIFA|IOF|EMPREST|TRANSF|FOLHA|SALARIO|DARF|GPS|IMPOSTO|TRIBUTO|ENERGIA|TELEFONE|NFSE|\bNFE\b|CONV\.?\s*DEM|SAQ|CARTAO|\bCODE\b|SISPAG/;

const LOGICAS_SEM_PERGUNTA_NF = new Set<ExtratoOperacaoLogica>([
  'TRANSFERENCIA',
  'TARIFA_BANCARIA',
  'JUROS_IOF',
  'IMPOSTO_TRIBUTO',
  'EMPRESTIMO_PAGAMENTO',
  'EMPRESTIMO_RECEBIMENTO',
  'EMPRESTIMO_CONCESSAO',
  'FOLHA_PAGAMENTO',
  'PAGAMENTO_SOCIO',
  'SAQUE',
  'APLICACAO_FINANCEIRA',
  'RECEBIMENTO_CLIENTE',
  'LIQUIDACAO_COBRANCA',
  'ENTRADA_RECEITA',
]);

export function isHistoricoExtratoVago(significado: string): boolean {
  const sig = significado.trim();
  if (!sig || sig.length < 6) return true;
  if (HINTS_HISTORICO_CLARO.test(sig)) return false;
  const tokens = sig.split(/\s+/).filter((t) => t.length >= 3);
  if (tokens.length === 0) return true;
  if (tokens.length >= 2 && tokens.some((t) => t.length >= 5)) return false;
  return tokens.length <= 1;
}

export function devePerguntarSemNotaFiscal(
  nature: 'D' | 'C',
  significado: string,
  logica: ExtratoOperacaoLogica,
  temAcumuladorFiscal: boolean,
): boolean {
  if (nature !== 'D') return false;
  if (temAcumuladorFiscal) return false;
  if (LOGICAS_SEM_PERGUNTA_NF.has(logica)) return false;
  return isHistoricoExtratoVago(significado);
}

/** Despesa genérica quando não há NF — prioriza uso e consumo. */
export function pickContaDespesaGenericaExtrato(
  plano: ExtratoContaPlanoLike[],
  significado: string,
  tokens: string[],
): string {
  const preferencias = [
    /USO\s+E\s+CONSUMO|EM\s+USO\s+E\s+CONSUMO/,
    /MATERIAIS\s+DE\s+CONSUMO|MATERIAL\s+DE\s+CONSUMO/,
    /DESPESAS\s+DIVERSAS|DESPESA\s+DIVERSA/,
    /CUSTOS\s+DIVERSOS|GASTOS\s+GERAIS/,
    /DESPESAS\s+OPERACIONAIS/,
  ];

  for (const hint of preferencias) {
    const code = pickConta(
      plano,
      (c) => {
        const g = c.group ?? derivePlanoGroupFromCode(c.code);
        return g === 'DESPESA' && hint.test(normNome(c.name));
      },
      'SAIDA_DESPESA',
      significado,
    );
    if (code) return code;
  }

  if (tokens.length > 0) {
    let best = '';
    let bestScore = 0;
    for (const c of plano) {
      if (!isAnalitica(c)) continue;
      if (isContaProibidaContrapartidaAutomatica(c, 'SAIDA_DESPESA', significado)) continue;
      const g = c.group ?? derivePlanoGroupFromCode(c.code);
      if (g !== 'DESPESA') continue;
      const n = normNome(c.name);
      if (/TARIFA|IMPOSTO|IRPJ|CSLL|FOLHA|SALARIO|RESULTADO|EXERCICIO/.test(n)) continue;
      let score = 0;
      for (const tok of tokens) {
        if (tok.length >= 4 && n.includes(tok)) score += tok.length;
      }
      if (score > bestScore) {
        bestScore = score;
        best = c.code.trim();
      }
    }
    if (best) return best;
  }

  return pickConta(
    plano,
    (c) => {
      const g = c.group ?? derivePlanoGroupFromCode(c.code);
      if (g !== 'DESPESA') return false;
      const n = normNome(c.name);
      return /USO\s+E\s+CONSUMO|CONSUMO|DIVERSAS/.test(n);
    },
    'SAIDA_DESPESA',
    significado,
  );
}
