# Conciliação do extrato — regra inegociável

**A conciliação pertence ao usuário. Nenhum código pode alterá-la sozinho.**

Esta regra existe porque o contrário já aconteceu e destruiu horas de trabalho
conciliado à mão: agentes automáticos rodavam o resolver de contas por cima das
linhas já fechadas e gravavam o palpite no lugar do que o usuário tinha feito.

## Proibido

- **Reaplicação automática em background.** Nenhum `useEffect`, timer, listener
  ou "sincronização" pode chamar o resolver de contas sobre lançamentos que já
  existem. Não importa se a empresa, o banco, o plano ou as regras mudaram.
- **Rodar o resolver ao abrir um extrato salvo.** Pasta salva é trabalho
  conferido: restaura byte a byte o que está gravado.
- **Sobrescrever linha fechada.** Linha com débito **e** crédito preenchidos é
  intocável por qualquer caminho automático — inclusive por regra cadastrada que
  case com o histórico.
- **Completar linha incompleta com palpite e deixá-la parecendo conciliada.**
  Linha com um lado só continua PENDENTE. O sistema não inventa contrapartida.
- **Filtrar/descartar lançamento na exportação.** O TXT+ sai igual à tabela,
  linha por linha. Se está na tela, está no arquivo.

## Permitido (só por ação explícita do usuário)

| Ação | O que pode fazer |
|---|---|
| Editar a conta na tabela | altera aquela linha |
| Botão "Reaplicar contas" | reprocessa tudo pelas regras — o usuário pediu |
| Importar arquivo novo | resolve as linhas novas, que chegam em branco |
| Modal "sem nota" | completa as pendentes; não toca em linha fechada |
| Criar regra de conta | preenche apenas linhas totalmente em branco |

## Onde isso está travado no código

- `src/contabilfacil/logic/extratoContaResolver.ts` — opção
  `preservarContasExistentes`: devolve a linha intacta quando débito e crédito já
  estão preenchidos. Ligada em todo caminho não-explícito.
- `src/contabilfacil/components/ManagerModule.tsx` — o efeito de reaplicação
  automática foi **removido**; no lugar há um comentário explicando por quê.
  `handleSelectExtratoPasta` restaura sem resolver.
- `src/contabilfacil/logic/dominioTxtIO.ts` — `buildTxtPlusFromExtratoRows` usa
  `resolveExtratoRowContas`, a mesma função da tabela, e não descarta linha.

## Testes que protegem isso

- `src/contabilfacil/logic/__tests__/extratoResolverPreservaContas.test.ts`
- `src/contabilfacil/logic/__tests__/extratoTxtPlusComoTabela.test.ts`

Se um desses quebrar, a mudança está errada — não o teste.
