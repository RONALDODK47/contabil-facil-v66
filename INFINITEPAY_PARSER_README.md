# Parser JSON da InfinitePay

## 📋 Descrição

Este documento descreve a implementação do parser JSON da InfinitePay no conversor de extratos bancários do Contabil Fácil.

## ✨ Funcionalidades Implementadas

### 1. Parser JSON (`parseInfinitePayJSON`)
- Converte JSON estruturado do formato InfinitePay diretamente para o formato interno
- Suporta transações com campos: `date`, `description`, `amount`, `balance`, `category`
- Extrai metadata: `bank_name`, `account_number`, `period`

### 2. Conversor com Suporte a JSON (`convertJSONFileToStatement`)
- Nova função no conversor que processa arquivos JSON
- Mantém compatibilidade com conversão de PDF
- Integração automática com o parser JSON da InfinitePay

### 3. UI Melhorada no Modal
- Detecção automática de tipo de arquivo (PDF ou JSON)
- Quando InfinitePay é selecionado, o upload aceita ambos os formatos
- Mensagens de erro atualizadas para orientar o usuário

### 4. Visual do Layout
- Adicionada imagem de referência do layout em `/public/infinitepay-layout.png`
- Arquivo de exemplo JSON em `/public/exemplo-infinitepay.json`
- Preview do layout no seletor de layouts

## 📝 Formato JSON Esperado

```json
{
  "transactions": [
    {
      "date": "2026-05-01",
      "description": "Pix Paulo Henrique Souza Lima (Enviado)",
      "amount": -100,
      "balance": 67824.29,
      "category": "Transferência"
    },
    {
      "date": "2026-05-04",
      "description": "Depósito de vendas Vendas (Depósito InfinitePay)",
      "amount": 5200.58,
      "balance": null,
      "category": "Receita"
    }
  ],
  "metadata": {
    "bank_name": "InfinitePay (Cloudwalk)",
    "account_number": "0001 - 16455473-6",
    "period": "05/2026"
  }
}
```

### Campos Obrigatórios em Cada Transação:
- **date**: YYYY-MM-DD (ISO 8601)
- **description**: Descrição da transação
- **amount**: Número (pode ser positivo ou negativo)
- **category**: Categoria da transação

### Campos Opcionais:
- **balance**: Saldo após a transação (pode ser `null`)

## 🚀 Como Usar

### Passo 1: Abrir o Conversor
1. Na interface do Contabil Fácil
2. Acesse a seção de "Conversor de Extratos Bancários"
3. Clique em "Novo" ou no botão de conversão

### Passo 2: Selecionar o Banco
- Escolha **"InfinitePay (Cloudwalk)"**

### Passo 3: Escolher o Layout
- Selecione **"Relatório de Movimentações"**
- Você verá um preview da imagem do layout

### Passo 4: Upload do Arquivo
- Clique para fazer upload
- Você pode selecionar:
  - Arquivo **PDF** (extrato em formato PDF)
  - Arquivo **JSON** (dados estruturados)

### Passo 5: Selecionar Conta
- Escolha a conta do banco no plano de contas
- Este campo é **obrigatório**

### Passo 6: Converter
- Clique em **"Converter PDF"** ou **"Converter JSON"**
- O sistema processará o arquivo

### Passo 7: Validar Resultado
- Verifique o resumo do extrato
- Adicione o saldo anterior se necessário
- Revise as transações

### Passo 8: Exportar
- Baixar em formato **OFX**
- Ou **Importar para Conciliação** no sistema

## 🧪 Testes Realizados

### Parser JSON (`parseInfinitePayJSON`)
✅ Testado e funcional
- Converte 3 transações de teste corretamente
- Extrai metadata apropriadamente
- Mantém informações de saldo quando presente

### Classificação de Transações
✅ Automática e acurada
- "Transferência" para Pix enviados
- "Receita" para depósitos e Pix recebidos
- "Serviços" para pagamentos de serviços

### Validação
✅ Rigorosa e informativa
- Valida formato de data (YYYY-MM-DD)
- Verifica presença de descrição e valor
- Assegura tipo de dados correto

## 📁 Arquivos Modificados

### Núcleo do Parser
- `src/lib/extratoParser/bankParsers.ts` - Adicionado `parseInfinitePayJSON()`
- `src/lib/extratoParser/conversor.ts` - Adicionado `convertJSONFileToStatement()`
- `src/lib/extratoParser/bankFormats.ts` - Adicionada URL de imagem para layout

### Interface
- `src/contabilfacil/components/ExtratoConversorModal.tsx` - Suporte a JSON
- `src/contabilfacil/components/LayoutSelector.tsx` - Atualizada URL de imagem

### Arquivos Públicos
- `public/infinitepay-layout.png` - Imagem do layout
- `public/exemplo-infinitepay.json` - Arquivo de exemplo

## 🔧 Detalhes Técnicos

### Detecção Automática de Tipo
```typescript
const isJson = file.type === 'application/json' || file.name.endsWith('.json');
const isPdf = file.type === 'application/pdf';
```

### Fluxo de Conversão JSON
1. Lê arquivo JSON com `file.text()`
2. Faz parse JSON
3. Passa para `parseInfinitePayJSON()`
4. Processa com `finalizeStatement()`
5. Classifica transações automaticamente
6. Valida resultado

## ⚠️ Troubleshooting

### Problema: "0 transações" após upload

**Causa Possível**: Arquivo não está sendo detectado como JSON

**Solução**:
1. Certifique-se que o arquivo tem extensão `.json`
2. Verifique que o JSON está válido (sem erros de sintaxe)
3. Confirme que InfinitePay está selecionado como banco

### Problema: "Erro ao converter arquivo"

**Causa Possível**: JSON está mal formatado

**Solução**:
1. Valide o JSON em um validador JSON online
2. Certifique-se de que todos os campos obrigatórios estão presentes
3. Verifique formato de datas (YYYY-MM-DD)

### Problema: Transações com categoria incorreta

**Causa Possível**: Descrição não corresponde aos padrões esperados

**Solução**:
- Após importação, você pode editar categorias manualmente no sistema
- As categorias automáticas são baseadas em palavras-chave na descrição

## 📚 Exemplo Completo

Ver arquivo: `public/exemplo-infinitepay.json`

## 🔗 Relacionados

- [Conversor de Extratos](src/lib/extratoParser/)
- [Tipos de Transação](src/lib/extratoParser/categoryClassifier.ts)
- [OFX Export](src/lib/extratoParser/toOfx.ts)

## 📝 Notas

- O sistema mantém total compatibilidade com PDFs
- JSON é uma alternativa rápida quando você já tem dados estruturados
- Todas as validações do PDF também aplicam-se ao JSON
- O export para OFX funciona identicamente para ambos os formatos
