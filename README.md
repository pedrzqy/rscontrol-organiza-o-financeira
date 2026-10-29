# Finanças Phaze

Painel financeiro privado da Phaze Games, só para admin. Instala na tela inicial
do celular como app (sem notificações).

## O que tem

- **Visão geral** por período (hoje, ontem, 7 dias, 30 dias, este mês, mês passado
  ou datas livres): faturamento bruto e líquido, taxas, lucro (líquido menos
  despesas), pedidos pagos, ticket médio, conversão, valor parado aguardando
  pagamento, gráfico por dia, Pix x cartão, por plataforma, jogos que mais
  faturaram, horário das vendas, clientes novos x que voltaram. Tudo comparado
  com o período anterior (no dia de hoje, até o mesmo horário).
- **Pedidos:** lista com busca (pedido, cliente, e-mail, telefone, jogo), filtros
  de situação e forma de pagamento, detalhe com taxas e liberação, e planilha
  (CSV que abre no Excel).
- **A receber:** quanto do cartão libera em cada dia e a reserva de 30 dias.
- **Lucro já liberado x a liberar:** Pix conta na hora; do cartão, 90% libera em 2
  dias e 10% em 30 dias. O lucro liberado é o que já caiu na carteira menos as
  despesas; o previsto soma o que o cartão ainda vai soltar.
- **Despesas e sócios:** lançamentos de despesa (paga por Pedro, Arthur ou pela
  Loja), retirada e aporte de cada sócio, custos fixos que entram sozinhos todo
  mês, filtros por quem, tipo e categoria, e planilha.
- **Quanto vai para cada conta:** para Pedro e para Arthur, parte do lucro já
  liberado (divisão configurável, padrão 50/50) + despesas que pagou do bolso +
  aportes − retiradas. Mostra também quanto entra quando o cartão liberar.
- **Lucro real das vendas:** líquido − custo dos jogos no fornecedor (Taobao) −
  outras despesas. Vale a partir de uma data (padrão 29/10/2026, muda em "mudar"):
  dessa data em diante, "Compra de contas" sai do lucro, porque o custo já vem de
  cada venda. O acerto entre os sócios continua pelo dinheiro que entrou e saiu.
- **Conferência do fornecedor:** contas que entraram no estoque pelo painel × preço
  de tabela, contra o que foi lançado em "Compra de contas". Mostra se o fornecedor
  cobrou a mais ou a menos.
- **Custo de cada pedido:** jogos escolhidos à mão aqui > entrega do painel de
  estoque (pega os jogos certos do combo) > preço de tabela dos itens. Combo sem
  entrega fica "sem custo" até você escolher os jogos no detalhe do pedido (ou pelo
  filtro "Pagos sem custo").

## De onde vêm os números

Os pedidos são copiados da Nerix a cada 3 minutos (as 3 páginas mais recentes) e
por completo a cada 6 horas. O líquido e as taxas são os que a própria Nerix
calcula em cada pagamento. Datas no horário de Brasília. Cobranças manuais (MPX)
não aparecem na listagem de pedidos da Nerix e por isso não entram aqui.

## Subir no Square Cloud

1. Crie um app novo e envie o zip.
2. Em Variáveis de ambiente, cadastre as cinco que estão em `financas-acesso.txt`:

```
FIN_USUARIO=
FIN_SENHA=
SESSAO_SEGREDO=
NERIX_KEY=
DATABASE_URL=
```

3. Reinicie e abra `https://phaze-financas.squareweb.app/saude`. Tem que responder
   `"configurado":true,"banco":true`. A primeira cópia completa dos pedidos leva
   uns 5 minutos.

Usa o mesmo banco do painel de estoque (tabelas `fin_*`, e lê `custos`, `ajustes`, `entregas` e `contas` do estoque) e os mesmos certificados
da pasta `certificados/`. Não compartilhe o zip.
