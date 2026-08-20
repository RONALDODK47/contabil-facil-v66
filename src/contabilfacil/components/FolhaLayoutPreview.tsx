import { memo } from 'react';

/**
 * Miniaturas dos dois relatórios do Domínio que a Folha importa.
 *
 * Servem para quem vai emitir o relatório reconhecer, de olho, qual dos dois tirar do sistema —
 * os nomes se parecem e o conteúdo é bem diferente.
 *
 * São desenhos esquemáticos, não recortes de PDF: reproduzem o cabeçalho, os títulos e as
 * colunas reais, mas onde ficariam nome da empresa, CNPJ e valores há apenas tarjas. Assim
 * nenhum dado de cliente entra no código do sistema.
 *
 * As posições em X são calculadas para a fonte monoespaçada do desenho (cada caractere ocupa
 * cerca de 0,55 do tamanho da fonte). Mexer num rótulo pede conferir o começo da coluna
 * seguinte, senão os textos se sobrepõem.
 */

const FUNDO = '#ffffff';
const BORDA = '#c8c8c8';
const TEXTO = '#3f3f3f';
const ROTULO = '#6b6b6b';
/** Tarja no lugar de um dado do cliente (nome, CNPJ, valor). */
const TARJA = '#e2e2e2';
/** Realce do que o sistema efetivamente lê. */
const REALCE = '#fde68a';
const REALCE_BORDA = '#d99e0b';

const MONO = 'ui-monospace, monospace';

type TarjaProps = { x: number; y: number; w: number; h?: number };

/** Retângulo cinza no lugar de um dado do cliente. */
const Tarja = ({ x, y, w, h = 5 }: TarjaProps) => (
  <rect x={x} y={y} width={w} height={h} rx={1} fill={TARJA} />
);

/** Cabeçalho comum aos dois relatórios: rótulos reais, dados do cliente tarjados. */
const Cabecalho = ({ comComplemento = false }: { comComplemento?: boolean }) => (
  <g fontFamily={MONO} fontSize={5} fill={ROTULO}>
    <text x={8} y={13}>Empresa:</text>
    <Tarja x={52} y={9} w={92} />
    <text x={8} y={22}>CNPJ:</text>
    <Tarja x={52} y={18} w={56} />
    <text x={8} y={31}>Cálculo:</text>
    <Tarja x={52} y={27} w={72} />
    <text x={8} y={40}>Competência:</text>
    <Tarja x={52} y={36} w={32} />
    {comComplemento ? (
      <>
        <text x={8} y={49}>Complemento:</text>
        <Tarja x={52} y={45} w={24} />
      </>
    ) : null}
    <text x={222} y={13}>Página:</text>
    <Tarja x={258} y={9} w={18} />
    <text x={222} y={22}>Emissão:</text>
    <Tarja x={258} y={18} w={22} />
  </g>
);

/** Linha de rubrica: código, nome e as colunas de valor, todos tarjados. */
const LinhaRubrica = ({ y, larguraNome = 70 }: { y: number; larguraNome?: number }) => (
  <g>
    <Tarja x={12} y={y} w={12} />
    <Tarja x={40} y={y} w={larguraNome} />
    <Tarja x={162} y={y} w={8} />
    <Tarja x={206} y={y} w={24} />
    <Tarja x={254} y={y} w={26} />
  </g>
);

export const LayoutResumoFolha = memo(function LayoutResumoFolha() {
  return (
    <svg
      viewBox="0 0 292 186"
      role="img"
      aria-label="Layout do relatório Resumo da Folha do Domínio"
      className="w-full h-auto"
    >
      <rect x={0} y={0} width={292} height={186} fill={FUNDO} stroke={BORDA} />
      <Cabecalho comComplemento />

      <text x={146} y={64} fontSize={6.5} textAnchor="middle" fontWeight="bold" fill={TEXTO} fontFamily={MONO}>
        RESUMO DA FOLHA
      </text>

      <line x1={8} y1={72} x2={284} y2={72} stroke={BORDA} />
      <g fontFamily={MONO} fontSize={4.2} fill={ROTULO}>
        <text x={12} y={79}>Rubrica</text>
        <text x={40} y={79}>Nome da Rubrica</text>
        <text x={140} y={79}>Nº Empregados</text>
        <text x={192} y={79}>Valor informado</text>
        <text x={240} y={79}>Valor Calculado</text>
      </g>
      <line x1={8} y1={82} x2={284} y2={82} stroke={BORDA} />

      <text x={10} y={91} fontSize={5} fontWeight="bold" fill={TEXTO} fontFamily={MONO}>PROVENTOS</text>
      <LinhaRubrica y={95} />
      <LinhaRubrica y={102} larguraNome={54} />
      <LinhaRubrica y={109} larguraNome={78} />
      <text x={230} y={122} fontSize={4.2} fill={ROTULO} fontFamily={MONO}>Total:</text>
      <Tarja x={254} y={118} w={26} />

      <text x={10} y={136} fontSize={5} fontWeight="bold" fill={TEXTO} fontFamily={MONO}>DESCONTOS</text>
      <LinhaRubrica y={140} larguraNome={84} />
      <LinhaRubrica y={147} larguraNome={44} />
      <text x={230} y={160} fontSize={4.2} fill={ROTULO} fontFamily={MONO}>Total:</text>
      <Tarja x={254} y={156} w={26} />

      <text x={10} y={174} fontSize={5} fontWeight="bold" fill={TEXTO} fontFamily={MONO}>INFORMATIVA</text>
      <LinhaRubrica y={178} larguraNome={62} />
    </svg>
  );
});

export const LayoutApuracaoTributos = memo(function LayoutApuracaoTributos() {
  /** Onde começa a coluna realçada — a que vira o valor do lançamento. */
  const xSaldo = 228;

  return (
    <svg
      viewBox="0 0 292 186"
      role="img"
      aria-label="Layout do relatório Apuração de Tributos Federais do Domínio"
      className="w-full h-auto"
    >
      <rect x={0} y={0} width={292} height={186} fill={FUNDO} stroke={BORDA} />
      <Cabecalho />

      <text x={146} y={58} fontSize={6.5} textAnchor="middle" fontWeight="bold" fill={TEXTO} fontFamily={MONO}>
        APURAÇÃO DE TRIBUTOS FEDERAIS
      </text>

      <rect x={8} y={68} width={276} height={9} fill="#f1f1f1" />
      <text x={12} y={74.5} fontSize={4.2} fill={ROTULO} fontFamily={MONO}>Saldo a compensar</text>
      <text x={12} y={86} fontSize={4.2} fill={ROTULO} fontFamily={MONO}>(-)Compensação DCOMP:</text>
      <Tarja x={112} y={82} w={14} />
      <text x={150} y={86} fontSize={4.2} fill={ROTULO} fontFamily={MONO}>(-)Salário Família:</text>
      <Tarja x={236} y={82} w={18} />

      <line x1={8} y1={96} x2={284} y2={96} stroke={BORDA} />
      <g fontFamily={MONO} fontSize={4.2} fill={ROTULO}>
        <text x={12} y={103}>Encargos</text>
        <text x={78} y={103}>Valor</text>
        <text x={104} y={103}>(-)DCOMP</text>
        <text x={142} y={103}>(-)Sal.Família</text>
        <text x={190} y={103}>(-)Retenções</text>
      </g>

      {/* A coluna que vira o valor do lançamento */}
      <rect x={xSaldo} y={97} width={54} height={45} fill={REALCE} opacity={0.45} />
      <rect x={xSaldo} y={97} width={54} height={45} fill="none" stroke={REALCE_BORDA} strokeWidth={0.8} />
      <text x={xSaldo + 3} y={103} fontSize={4.2} fontWeight="bold" fill={TEXTO} fontFamily={MONO}>
        Saldo a recolher
      </text>
      <line x1={8} y1={106} x2={284} y2={106} stroke={BORDA} />

      {/* Retenção do empregado — não é importada */}
      <text x={12} y={114} fontSize={4} fill={ROTULO} fontFamily={MONO}>INSS Segurados Folha</text>
      <Tarja x={78} y={110} w={18} />
      <Tarja x={108} y={110} w={14} />
      <Tarja x={148} y={110} w={16} />
      <Tarja x={194} y={110} w={14} />
      <Tarja x={xSaldo + 26} y={110} w={26} />

      {/* Os dois encargos da empresa, que são os importados */}
      <rect x={8} y={117} width={xSaldo - 8} height={9} fill={REALCE} opacity={0.45} />
      <text x={12} y={123.5} fontSize={4} fontWeight="bold" fill={TEXTO} fontFamily={MONO}>
        INSS Empresa e RAT Folha
      </text>
      <Tarja x={78} y={119.5} w={18} />
      <Tarja x={108} y={119.5} w={14} />
      <Tarja x={148} y={119.5} w={16} />
      <Tarja x={194} y={119.5} w={14} />
      <Tarja x={xSaldo + 26} y={119.5} w={26} />

      <rect x={8} y={128} width={xSaldo - 8} height={9} fill={REALCE} opacity={0.45} />
      <text x={12} y={134.5} fontSize={4} fontWeight="bold" fill={TEXTO} fontFamily={MONO}>PIS Folha</text>
      <Tarja x={78} y={130.5} w={18} />
      <Tarja x={108} y={130.5} w={14} />
      <Tarja x={148} y={130.5} w={16} />
      <Tarja x={194} y={130.5} w={14} />
      <Tarja x={xSaldo + 26} y={130.5} w={26} />

      <line x1={8} y1={143} x2={284} y2={143} stroke={BORDA} />
      <text x={12} y={151} fontSize={4.2} fontWeight="bold" fill={TEXTO} fontFamily={MONO}>
        Total saldo à recolher:
      </text>
      <Tarja x={xSaldo + 26} y={147} w={26} />

      <rect x={9} y={162} width={7} height={5} fill={REALCE} stroke={REALCE_BORDA} strokeWidth={0.6} />
      <g fontFamily={MONO} fontSize={4.2} fill={ROTULO}>
        <text x={20} y={166.5}>O que entra: encargos da empresa, pela coluna Saldo a recolher.</text>
        <text x={20} y={175}>O INSS dos segurados fica de fora — já vem no Resumo da Folha.</text>
      </g>
    </svg>
  );
});
