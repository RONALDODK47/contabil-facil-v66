/**
 * Campos de formulário — largura proporcional + alinhamento padronizado.
 *
 * Escala de containers:
 *   curto  (CF_INPUT_SHORT)  ~88px   — SKU, código, qty
 *   médio  (CF_INPUT_MED)    ~224px  — nome, cliente, categoria
 *   longo  (CF_INPUT_LONG)   ~384px  — descrição, complemento extenso
 *   busca  — w-full com max-w-*       — apenas campos de pesquisa
 *
 * Usar CF_FIELD_ROW + CF_FIELD_COL; hints (CF_FIELD_HINT) ficam fora da linha.
 */

/** Altura única para input — mantém baseline alinhada na linha. */
export const CF_CONTROL_H = 'h-[26px] min-h-[26px] box-border leading-none';

const CF_BASE =
  `${CF_CONTROL_H} border border-brand-border bg-white font-mono outline-none focus:bg-brand-sidebar/10 disabled:opacity-50`;

/** Select nativo — line-height normal evita lista sobrepor a borda do campo (Windows). */
const CF_SELECT_BASE =
  'cf-select h-[26px] min-h-[26px] box-border leading-normal shrink-0 border border-brand-border bg-white font-mono text-[10px] font-bold outline-none focus:bg-brand-sidebar/10 focus:z-20 disabled:opacity-50';

export const CF_FIELD_ROW = 'flex flex-wrap items-start gap-x-3 gap-y-2';
/** Formulário inteiro: campos pequenos/médios lado a lado; use CF_FIELD_FULL na mesma lista para linha larga. */
export const CF_FORM_FIELDS = 'flex flex-wrap items-start gap-x-3 gap-y-3 w-full max-w-full text-xs';
export const CF_FIELD_COL = 'flex flex-col gap-0.5 shrink-0 min-w-0';
/** Só quando o campo longo precisa crescer dentro de uma linha flex. */
export const CF_FIELD_COL_GROW = 'flex flex-col gap-0.5 flex-1 min-w-[14rem] max-w-[24rem]';
/** Select ou texto que ocupa a linha inteira do formulário flex. */
export const CF_FIELD_FULL = 'flex flex-col gap-0.5 basis-full w-full min-w-0 max-w-[24rem]';
export const CF_LOAN_FIELD_FULL = 'flex flex-col gap-0.5 basis-full w-full min-w-0';
export const CF_LABEL = 'text-[9px] font-black uppercase leading-none block opacity-55 min-h-[11px]';
export const CF_FIELD_HINT = 'text-[8px] opacity-50 font-bold uppercase leading-tight';
export const CF_FIELD_INLINE = 'flex flex-wrap gap-1.5 items-stretch';
/** Coluna de campo com controles que abrem lista (select) — não corta o dropdown. */
export const CF_FIELD_COL_CONTROLS = 'flex flex-col gap-0.5 shrink-0 min-w-0 overflow-visible';

/** Curto — SKU, referência, código reduzido. */
export const CF_INPUT_SHORT = `${CF_BASE} w-[5.5rem] px-1.5 text-[11px] tabular-nums`;

/** Médio — nome de produto, cliente, pasta, categoria. */
export const CF_INPUT_MED = `${CF_BASE} w-[14rem] max-w-full px-2 text-[11px]`;

/** Longo — descrição de lançamento, texto que pode passar de ~30 caracteres. */
export const CF_INPUT_LONG = `${CF_BASE} w-full max-w-[24rem] min-w-[14rem] px-2 text-[11px]`;

/** Alias: texto padrão = médio (não estica na linha inteira). */
export const CF_INPUT_TEXT = CF_INPUT_MED;

export const CF_INPUT_NUM = `${CF_BASE} w-[4.5rem] px-1.5 text-[11px] text-right tabular-nums`;
/** Mesma largura que CF_INPUT_NUM (valor ao lado de qtd). */
export const CF_INPUT_MONEY = `${CF_BASE} w-[7rem] min-w-[4.5rem] px-1.5 text-[11px] text-right tabular-nums`;
export const CF_INPUT_PCT = `${CF_BASE} w-[5rem] px-1.5 text-[11px] text-right tabular-nums`;
export const CF_INPUT_DATE = `${CF_BASE} w-[9.5rem] px-2 text-[11px]`;
export const CF_INPUT_ACCOUNT = `${CF_BASE} w-[8.5rem] px-2 text-[11px]`;
/** Placeholder padrão — só código reduzido (nunca classificação). */
export const CF_ACCOUNT_REDUCED_PLACEHOLDER = 'Cód. reduzido (ex.: 147)';

export const CF_SELECT = `${CF_SELECT_BASE} w-auto min-w-[7rem] max-w-[12rem] pl-1.5 pr-6`;
/** Select que ocupa a linha inteira no celular. */
export const CF_SELECT_RESPONSIVE = `${CF_SELECT_BASE} w-full min-w-0 max-w-full sm:w-auto sm:min-w-[7rem] sm:max-w-[12rem] pl-1.5 pr-6`;
export const CF_SELECT_WIDE = `${CF_SELECT_BASE} w-auto min-w-[12rem] max-w-md pl-1.5 pr-6`;
export const CF_SELECT_WIDE_RESPONSIVE = `${CF_SELECT_BASE} w-full min-w-0 max-w-full sm:w-auto sm:min-w-[12rem] sm:max-w-md pl-1.5 pr-6`;
/** Unitário (R$/un) / Total (R$) — largura fixa para não cortar rótulo. */
export const CF_SELECT_PRICE_MODE = `${CF_SELECT_BASE} w-[11.5rem] min-w-[11.5rem] max-w-[11.5rem] pl-2 pr-6`;
/** Unitária / Total (medida). */
export const CF_SELECT_QTY_MODE = `${CF_SELECT_BASE} w-[5.75rem] min-w-[5.75rem] max-w-[5.75rem] pl-1.5 pr-6`;
/** un, g, kg, cm… */
export const CF_SELECT_MEASURE = `${CF_SELECT_BASE} w-[3.25rem] min-w-[3.25rem] max-w-[3.25rem] px-1 text-center`;

/** Painel de formulário compacto — não estica na largura da página. */
export const CF_FORM_PANEL = 'w-fit max-w-full';

/** Painel branco da aba Cálculos — altura mínima fixa; largura segue o conteúdo (não estica na página). */
export const CF_CALC_PANEL =
  'technical-panel p-4 w-full min-h-[15rem] flex flex-col box-border border-t-0';

/** Agrupa abas cinza + painel branco — sombra única em todo o bloco. */
export const CF_CALC_SHELL = 'w-fit max-w-full space-y-0 shadow-[3px_3px_0_0_#141414]';

/** Barra de sub-abas da calculadora. */
export const CF_CALC_TABS =
  'flex flex-wrap gap-1 border border-brand-border border-b-0 p-1 bg-brand-sidebar/10 w-full box-border';

/** Painéis empréstimo (fundo sidebar). */
const CF_LOAN_BASE =
  `${CF_CONTROL_H} border border-brand-border/60 bg-brand-sidebar/20 font-mono font-bold outline-none focus:bg-white disabled:opacity-50`;

export const CF_LOAN_INPUT_MED = `${CF_LOAN_BASE} w-[14rem] max-w-full px-2 text-[10px]`;
export const CF_LOAN_INPUT_LONG = `${CF_LOAN_BASE} w-full max-w-[24rem] min-w-[14rem] px-2 text-[10px]`;
export const CF_LOAN_INPUT_TEXT = CF_LOAN_INPUT_MED;
export const CF_LOAN_INPUT_NUM = `${CF_LOAN_BASE} w-[4.5rem] px-1.5 text-[10px] text-right tabular-nums`;
export const CF_LOAN_INPUT_MONEY = `${CF_LOAN_BASE} w-[7rem] px-1.5 text-[10px] text-right tabular-nums`;
export const CF_LOAN_INPUT_PCT = `${CF_LOAN_BASE} w-[5rem] px-1.5 text-[10px] text-right tabular-nums`;
export const CF_LOAN_INPUT_DATE = `${CF_LOAN_BASE} w-[9.5rem] px-2 text-[10px]`;
/** Select dentro do painel do contrato — respeita a largura da coluna (sem estourar). */
export const CF_LOAN_SELECT = `${CF_LOAN_BASE} block w-full max-w-full min-w-0 box-border px-1.5 text-[10px]`;

/** Formulários gerais (parcelamento, aplicações, gerencial). */
const CF_FORM_BASE =
  `${CF_CONTROL_H} border border-brand-border bg-white font-bold outline-none focus:bg-brand-sidebar/10 disabled:opacity-50`;

export const CF_FORM_INPUT_MED = `${CF_FORM_BASE} w-[14rem] max-w-full px-2 text-xs`;
export const CF_FORM_INPUT_LONG = `${CF_FORM_BASE} w-full max-w-[24rem] min-w-[14rem] px-2 text-xs`;
export const CF_FORM_INPUT_TEXT = CF_FORM_INPUT_MED;
export const CF_FORM_INPUT_SHORT = `${CF_FORM_BASE} w-[5.5rem] px-1.5 text-xs font-mono tabular-nums`;
export const CF_FORM_INPUT_NUM = `${CF_FORM_BASE} w-[4.5rem] px-1.5 text-xs font-mono text-right tabular-nums`;
export const CF_FORM_INPUT_MONEY = `${CF_FORM_BASE} w-[7rem] min-w-[4.5rem] px-1.5 text-xs font-mono text-right tabular-nums`;
export const CF_FORM_INPUT_PCT = `${CF_FORM_BASE} w-[5rem] px-1.5 text-xs font-mono text-right tabular-nums`;
export const CF_FORM_INPUT_DATE = `${CF_FORM_BASE} w-[9.5rem] px-2 text-xs font-mono`;
export const CF_FORM_SELECT = `${CF_FORM_BASE} w-auto min-w-[7rem] max-w-[12rem] px-1.5 text-xs`;
