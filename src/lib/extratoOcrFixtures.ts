/**
 * Fixtures sintéticos OCR puro — contratos de regressão (segmentação + histórico + auditoria).
 */
import type { OcrPosicionadoItem } from './ocrExtratoPositional';

export type ExtratoOcrFixtureColMap = Record<string, { start: number; end: number }>;

export type ExtratoOcrFixtureRowExpect = {
  data?: string;
  descricaoContains?: string[];
  descricaoNotContains?: string[];
  valorDebito?: string;
  valorCredito?: string;
  valorMisto?: string;
};

export type ExtratoOcrFixtureContract = {
  id: string;
  descricao: string;
  items: OcrPosicionadoItem[];
  imgWidth: number;
  imgHeight: number;
  columns: ExtratoOcrFixtureColMap;
  ignoreWords?: string[];
  expect: {
    segmentCount: number;
    auditOk: boolean;
    rows?: ExtratoOcrFixtureRowExpect[];
  };
};

export const EXTRATO_OCR_FIXTURES: ExtratoOcrFixtureContract[] = [
  {
    id: 'pix-multilinha-doc',
    descricao: 'PIX multilinha com DOC. no histórico — sem vazar próximo lançamento',
    imgWidth: 600,
    imgHeight: 200,
    columns: {
      data: { start: 0, end: 100 },
      descricao: { start: 120, end: 400 },
      valorMisto: { start: 420, end: 520 },
    },
    items: [
      { str: '27/02', x: 10, y: 100, w: 40, h: 12 },
      { str: '7.999,54D', x: 430, y: 100, w: 70, h: 12 },
      { str: 'Pagamento Pix', x: 140, y: 118, w: 100, h: 12 },
      { str: 'DOC.: Pix', x: 140, y: 136, w: 80, h: 12 },
      { str: '28/02', x: 10, y: 160, w: 40, h: 12 },
      { str: 'PIX RECEBIDO', x: 140, y: 160, w: 100, h: 12 },
      { str: '500,00C', x: 430, y: 160, w: 60, h: 12 },
    ],
    expect: {
      segmentCount: 2,
      auditOk: true,
      rows: [
        {
          descricaoContains: ['Pagamento Pix', 'DOC'],
          descricaoNotContains: ['PIX RECEBIDO'],
        },
        {
          descricaoContains: ['PIX RECEBIDO'],
          descricaoNotContains: ['Pagamento Pix'],
        },
      ],
    },
  },
  {
    id: 'sicoob-valor-unico',
    descricao: 'Só valor na coluna — um segmento por valor',
    imgWidth: 500,
    imgHeight: 180,
    columns: {
      data: { start: 0, end: 80 },
      descricao: { start: 90, end: 340 },
      valorMisto: { start: 350, end: 500 },
    },
    items: [
      { str: '2.747,94D', x: 400, y: 80, w: 70, h: 12 },
      { str: '471,41D', x: 400, y: 120, w: 70, h: 12 },
      { str: '104,13D', x: 400, y: 144, w: 70, h: 12 },
    ],
    expect: {
      segmentCount: 3,
      auditOk: true,
    },
  },
  {
    id: 'ted-valor-linha-2',
    descricao: 'TED com valor na segunda linha física',
    imgWidth: 920,
    imgHeight: 200,
    columns: {
      data: { start: 0, end: 120 },
      descricao: { start: 130, end: 700 },
      valorMisto: { start: 720, end: 920 },
    },
    items: [
      { str: '02/02', x: 20, y: 100, w: 40, h: 12 },
      { str: 'TED ENVIADA', x: 140, y: 100, w: 100, h: 12 },
      { str: '04.763.273/0001-49', x: 140, y: 118, w: 120, h: 12 },
      { str: '25.636,00D', x: 780, y: 118, w: 70, h: 12 },
    ],
    expect: {
      segmentCount: 1,
      auditOk: true,
      rows: [
        {
          data: '02/02',
          descricaoContains: ['TED'],
        },
      ],
    },
  },
  {
    id: 'dois-lancamentos-mesmo-dia',
    descricao: 'Dois lançamentos na mesma data',
    imgWidth: 500,
    imgHeight: 160,
    columns: {
      data: { start: 0, end: 80 },
      descricao: { start: 90, end: 380 },
      valorMisto: { start: 390, end: 500 },
    },
    items: [
      { str: '02/02', x: 10, y: 100, w: 40, h: 12 },
      { str: 'PIX', x: 80, y: 100, w: 60, h: 12 },
      { str: '100,00D', x: 400, y: 100, w: 60, h: 12 },
      { str: '02/02', x: 10, y: 120, w: 40, h: 12 },
      { str: 'TED', x: 80, y: 120, w: 60, h: 12 },
      { str: '200,00D', x: 400, y: 120, w: 60, h: 12 },
    ],
    expect: {
      segmentCount: 2,
      auditOk: true,
    },
  },
  {
    id: 'gap-y-historico-distante',
    descricao: 'Gap Y impede anexar histórico distante',
    imgWidth: 600,
    imgHeight: 220,
    columns: {
      data: { start: 0, end: 100 },
      descricao: { start: 120, end: 400 },
      valorMisto: { start: 420, end: 520 },
    },
    items: [
      { str: '01/03', x: 10, y: 80, w: 40, h: 12 },
      { str: 'PIX SAIDA', x: 140, y: 80, w: 80, h: 12 },
      { str: '50,00D', x: 430, y: 80, w: 60, h: 12 },
      { str: 'TEXTO DISTANTE', x: 140, y: 160, w: 100, h: 12 },
      { str: '02/03', x: 10, y: 180, w: 40, h: 12 },
      { str: 'OUTRO PIX', x: 140, y: 180, w: 80, h: 12 },
      { str: '30,00D', x: 430, y: 180, w: 60, h: 12 },
    ],
    expect: {
      segmentCount: 2,
      auditOk: true,
      rows: [
        { descricaoContains: ['PIX SAIDA'], descricaoNotContains: ['TEXTO DISTANTE'] },
        { descricaoContains: ['OUTRO PIX'] },
      ],
    },
  },
];
