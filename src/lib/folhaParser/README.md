# Parser de Folha de Pagamento

Sistema completo para importação de PDFs de Folha de Pagamento com mapeamento automático de contas contábeis.

## Arquivos

- **folhaPDFParser.ts** - Parser base que extrai dados do PDF
- **folhaContaMapping.ts** - Mapeamento de rubricas para contas contábeis
- **folhaLancamentoMapper.ts** - Conversão para lançamentos contábeis (VisionBalanceteRow)
- **folhaPDFParser.test.ts** - Testes do parser

## Como Funciona

### 1. Extração de Dados (folhaPDFParser.ts)

```typescript
import { parseFolhaText, getLastDayOfMonth } from './folhaPDFParser';

const textFromPDF = `
Competência: 01/2026
Empresa: 36 - BESSA & GOMIDE LTDA
CNPJ: 33.369.075/0001-01

PROVENTOS
1 SALARIO EMPREGADO 1 28:00 206,08

DESCONTOS
812 INSS FERIAS1 1 7,50 72,07
`;

const result = parseFolhaText(textFromPDF);
// result.competencia = "01/2026"
// result.data = "31/01/2026"
// result.lancements = [...]
```

**Estrutura de Lançamento:**
```typescript
{
  rubrica: "1",
  nomeRubrica: "SALARIO EMPREGADO",
  valor: 206.08,
  natureza: "C",  // D = Débito, C = Crédito
  tipo: "PROVENTOS",  // PROVENTOS | DESCONTOS | INFORMATIVA
  nEmpregados: 1
}
```

**Regras de Natureza:**
- **PROVENTOS** → Crédito (C)
- **DESCONTOS** → Débito (D)
- **INFORMATIVA** → Crédito (C)

### 2. Cálculo de Data

A data é sempre o **último dia do mês** da competência:
- 01/2026 → 31/01/2026
- 02/2025 → 28/02/2025 (não bissexto)
- 02/2024 → 29/02/2024 (bissexto)

Função: `getLastDayOfMonth(competencia: string): string`

### 3. Mapeamento de Contas (folhaContaMapping.ts)

Há dois tipos de mapeamento:

#### A. Regras Padrão (FOLHA_REGRAS_PADRAO)

Predefinidas para rubricas comuns:

```typescript
{
  rubrica: "1",
  nomeRubrica: "SALARIO EMPREGADO",
  tipo: "PROVENTOS",
  contaCredito: "6101.01.01"  // Despesa com Salários
}
```

#### B. Mapeamento Customizado

Salvo por empresa no localStorage:

```typescript
import { setFolhaRubricaConta, readFolhaContaMap } from './folhaContaMapping';

// Definir mapeamento
setFolhaRubricaConta("BESSA & GOMIDE", "1", "6101.01.01");

// Ler mapeamento
const map = readFolhaContaMap("BESSA & GOMIDE");
// map["1"] = "6101.01.01"
```

### 4. Geração de Lançamentos (folhaLancamentoMapper.ts)

```typescript
import { mapFolhaParseResultParaVisionBalancete } from './folhaLancamentoMapper';

const { items, erros } = mapFolhaParseResultParaVisionBalancete(
  parseResult,
  "BESSA & GOMIDE"
);

// items[] contém VisionBalanceteRow (formato do sistema)
```

**Resultado:**
```typescript
{
  codigo: "6101.01.01",
  classificacao: "6101.01.01",
  nome: "SALARIO EMPREGADO",
  data: "31/01/2026",
  debito: 0,
  credito: 206.08,
  saldoFinal: 206.08,
  naturezaSaldoFinal: "C",
  tipo: "A",
  historico: "1 - SALARIO EMPREGADO"
}
```

## Funções Principais

### folhaPDFParser.ts

```typescript
// Parse de texto PDF
parseFolhaText(text: string): FolhaParserResult

// Cálculo de data
getLastDayOfMonth(competencia: string): string

// Parse de valor brasileiro
parseBrValue(valueStr: string): number

// Conversão para formato OcrRow
folhaLancamentosToGenericOcrRows(result: FolhaParserResult): GenericOcrRow[]
```

### folhaContaMapping.ts

```typescript
// Ler/salvar mapeamento
readFolhaContaMap(empresa: string): FolhaContaMap
saveFolhaContaMap(empresa: string, map: FolhaContaMap): void

// Definir mapeamento de rubrica
setFolhaRubricaConta(empresa: string, rubrica: string, conta: string): void
removeFolhaRubricaConta(empresa: string, rubrica: string): void
getFolhaRubricaConta(empresa: string, rubrica: string): string | undefined

// Detectar tipo de rubrica
detectFolhaRubricaTipo(nomeRubrica: string): FolhaTipoRubrica | null

// Aplicar mapeamento
aplicarMapeamentoFolha(lancamento: FolhaLancamento, empresa: string): {
  contaDebito?: string;
  contaCredito?: string;
}

// Regras padrão
getFolhaRegraPadrao(rubrica: string): FolhaRegraMapping | undefined
listarFolhaRegrasDoTipo(tipo: FolhaTipoRubrica): FolhaRegraMapping[]
```

### folhaLancamentoMapper.ts

```typescript
// Mapear para lançamento contábil
mapFolhaLancamentoParaContabil(lance, result, empresa, ordem): FolhaLancamentoContabil

// Converter para VisionBalanceteRow
mapFolhaParseResultParaVisionBalancete(result, empresa): {
  items: VisionBalanceteRow[]
  erros: string[]
}

// Validar mapeamento
validarMapeamentoFolha(lancements): { valido: boolean; avisos: string[] }

// Gerar sumário
gerarSumarioFolha(result): FolhaLancamentoSumario

// Exportar CSV
exportarFolhaCSV(result, empresa): string
```

## Exemplo Completo

```typescript
import { 
  parseFolhaText,
  folhaLancamentosToGenericOcrRows
} from './folhaPDFParser';
import { 
  mapFolhaParseResultParaVisionBalancete,
  gerarSumarioFolha
} from './folhaLancamentoMapper';

// 1. Parse do PDF
const textoPDF = await extrairTextoDoPDF(file);
const result = parseFolhaText(textoPDF);

// 2. Validar
if (result.errors.length > 0) {
  console.error("Erros:", result.errors);
  return;
}

// 3. Mapear para lançamentos contábeis
const { items, erros } = mapFolhaParseResultParaVisionBalancete(
  result,
  "BESSA & GOMIDE"
);

// 4. Gerar sumário
const sumario = gerarSumarioFolha(result);

// 5. Usar os items como lançamentos
console.log(`${items.length} lançamentos importados`);
console.log(`Total proventos: ${sumario.totalProventos}`);
console.log(`Total descontos: ${sumario.totalDescontos}`);
```

## Rubricas Padrão

| Rubrica | Nome | Tipo | Conta Crédito | Conta Débito |
|---------|------|------|---------------|--------------|
| 1 | SALARIO EMPREGADO | PROVENTOS | 6101.01.01 | - |
| 3 | HORAS FERIAS | PROVENTOS | 6101.01.02 | - |
| 9380 | PRO-LABORE DIAS | PROVENTOS | 6101.02.01 | - |
| 242 | GRATIFICAÇÃO DE CAIXA | PROVENTOS | 6101.01.03 | - |
| 812 | INSS FERIAS1 | DESCONTOS | - | 2101.02.01 |
| 843 | INSS EMPREGADOR | DESCONTOS | - | 2101.02.01 |
| 937 | ADIANTAMENTO DE FERIAS | DESCONTOS | - | 2201.01.01 |
| 998 | I.N.S.S. | DESCONTOS | - | 2101.02.02 |
| 813 | FGTS FERIAS1 | INFORMATIVA | 2105.01.01 | - |
| 996 | F.G.T.S DO MES | INFORMATIVA | 2105.01.01 | - |

## Integração com Interface

Component: `FolhaImportModal.tsx`

```typescript
<FolhaImportModal
  companyName="BESSA & GOMIDE"
  onCancel={() => {}}
  onConfirm={(rows, sumario) => {
    console.log(`${rows.length} lançamentos importados`);
  }}
/>
```

**Passos do Modal:**
1. Upload de PDF
2. Preview de lançamentos
3. Mapeamento de contas
4. Confirmação de import

## Testes

```bash
npm run test -- folhaPDFParser.test
```

Testes cobrindo:
- Cálculo de data (incluindo bissextos)
- Parse de valores brasileiros
- Extração de lançamentos (PROVENTOS, DESCONTOS, INFORMATIVA)
- Conversão para formato OcrRow
