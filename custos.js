'use strict';

/**
 * Custo de cada venda no fornecedor (Taobao), em yuan, convertido pela
 * cotacao do painel de estoque. Os precos e as entregas moram nas tabelas do
 * estoque (custos, ajustes, entregas, contas), no mesmo banco.
 *
 * Custo de um pedido, nesta ordem:
 *   1. jogos escolhidos a mao aqui (fin_custos_pedido), para combo ou pedido
 *      entregue por fora;
 *   2. a entrega do estoque daquele pedido, com o custo que cada jogo gravou
 *      quando saiu (pega os jogos certos do combo);
 *   3. o preco de tabela de cada item do pedido.
 * Se algum jogo fica sem preco, o pedido conta como "sem custo".
 *
 * Vale a partir de `desde`: antes dessa data, o custo das contas ja esta nas
 * despesas "Compra de contas". Depois dela, essas despesas viram so a
 * conferencia do que o fornecedor cobrou.
 */

const banco = require('./banco');

const FUSO = 'America/Sao_Paulo';
const DESDE_PADRAO = '2026-10-29';
const COTACAO_PADRAO = 0.76;
const COMPRA_DE_CONTAS = 'Compra de contas';
const n = (v) => (v == null ? 0 : Number(v));

async function preparar() {
  await banco.q(`
    CREATE TABLE IF NOT EXISTS fin_custos_pedido (
      numero TEXT PRIMARY KEY,
      jogos JSONB NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/** As tabelas do estoque so existem depois que o painel de estoque com custos subiu. */
let estoque = { em: 0, ok: false };
async function temEstoque() {
  if (Date.now() - estoque.em < 5 * 60 * 1000) return estoque.ok;
  const r = await banco.q(`SELECT to_regclass('custos') IS NOT NULL AND to_regclass('entregas') IS NOT NULL AND to_regclass('ajustes') IS NOT NULL AS ok`);
  estoque = { em: Date.now(), ok: !!r.rows[0].ok };
  return estoque.ok;
}

async function config() {
  const [desde, ok] = await Promise.all([banco.estado('custo_desde'), temEstoque()]);
  let cotacao = COTACAO_PADRAO;
  if (ok) {
    const r = await banco.q(`SELECT valor FROM ajustes WHERE chave = 'cotacao'`);
    if (r.rows[0] && Number(r.rows[0].valor) > 0) cotacao = Number(r.rows[0].valor);
  }
  return { desde: typeof desde === 'string' ? desde : DESDE_PADRAO, cotacao, estoque: ok };
}

async function precos() {
  if (!(await temEstoque())) return {};
  const r = await banco.q('SELECT produto_id, yuan FROM custos');
  const mapa = {};
  for (const l of r.rows) mapa[l.produto_id] = n(l.yuan);
  return mapa;
}

async function pais() {
  const r = await banco.q('SELECT id, pai FROM fin_produtos WHERE pai IS NOT NULL');
  const mapa = {};
  for (const l of r.rows) mapa[l.id] = Number(l.pai);
  return mapa;
}

/**
 * Custo de cada pedido (lista de { numero, itens }). Devolve um mapa
 * numero -> { yuan, completo, fonte, jogos: [{ nome, yuan }] }.
 */
async function dosPedidos(pedidos) {
  const saida = {};
  if (!pedidos.length) return saida;
  const numeros = pedidos.map((p) => p.numero);
  const ok = await temEstoque();
  const [manuais, entregas, tabela, pai] = await Promise.all([
    banco.q('SELECT numero, jogos FROM fin_custos_pedido WHERE numero = ANY($1)', [numeros]),
    ok ? banco.q(`SELECT pedido, itens, falta FROM entregas WHERE pedido = ANY($1) AND estado <> 'devolvida'`, [numeros]) : { rows: [] },
    precos(),
    pais(),
  ]);
  const manual = {};
  for (const m of manuais.rows) manual[m.numero] = m.jogos;
  const entrega = {};
  for (const e of entregas.rows) entrega[e.pedido] = e;

  for (const p of pedidos) {
    let jogos;
    let fonte;
    let completo = true;
    if (manual[p.numero]) {
      fonte = 'manual';
      jogos = manual[p.numero].map((j) => ({ produto: j.produto, nome: j.nome, yuan: j.yuan == null ? null : n(j.yuan) }));
    } else if (entrega[p.numero] && (entrega[p.numero].itens.length || entrega[p.numero].falta.length)) {
      fonte = 'entrega';
      const e = entrega[p.numero];
      jogos = e.itens.map((i) => ({ produto: i.produto, nome: i.nome, yuan: i.custo == null ? null : n(i.custo) }));
      for (const f of e.falta) jogos.push({ produto: f.produto || null, nome: f.nome || 'Jogo que faltou', yuan: null });
    } else {
      fonte = 'tabela';
      jogos = [];
      for (const i of p.itens || []) {
        const id = pai[i.produto] || Number(i.produto);
        for (let k = 0; k < (i.qtd || 1); k++) jogos.push({ produto: id, nome: i.nome, yuan: tabela[id] == null ? null : tabela[id] });
      }
    }
    if (!jogos.length || jogos.some((j) => j.yuan == null)) completo = false;
    saida[p.numero] = { yuan: jogos.reduce((s, j) => s + (j.yuan || 0), 0), completo, fonte, jogos };
  }
  return saida;
}

const inicioDoDia = `($1::date::timestamp AT TIME ZONE '${FUSO}')`;

/**
 * Custo dos pedidos pagos do periodo (a partir de `desde`), ja com a fatia
 * `f` da plataforma filtrada. Tambem devolve o custo por dia, para o grafico.
 */
async function doPeriodo(de, ate, filtros, cte, corte) {
  const cfg = await config();
  const inicio = de > cfg.desde ? de : cfg.desde;
  const vazio = { yuan: 0, reais: 0, pedidos: 0, semCusto: 0, porDia: {}, desde: cfg.desde, cotacao: cfg.cotacao, estoque: cfg.estoque };
  if (inicio > ate) return vazio;
  const args = [inicio, ate, filtros.plataforma, filtros.metodo];
  if (corte) args.push(corte);
  const r = await banco.q(`${cte} SELECT numero, itens, f, to_char(criado_em AT TIME ZONE '${FUSO}', 'YYYY-MM-DD') AS dia FROM base WHERE pago`, args);
  const custo = await dosPedidos(r.rows);
  const t = vazio;
  for (const p of r.rows) {
    const c = custo[p.numero];
    const y = c.yuan * n(p.f);
    t.yuan += y;
    t.pedidos++;
    if (!c.completo) t.semCusto++;
    t.porDia[p.dia] = (t.porDia[p.dia] || 0) + y * cfg.cotacao;
  }
  t.reais = t.yuan * cfg.cotacao;
  return t;
}

/**
 * Conferencia do fornecedor no periodo: as contas que entraram no estoque
 * (coladas no painel ou digitadas na hora de entregar) pelo preco de tabela,
 * contra o que foi lancado em "Compra de contas".
 */
async function conferencia(de, ate) {
  const cfg = await config();
  const inicio = de > cfg.desde ? de : cfg.desde;
  const saida = { desde: cfg.desde, cotacao: cfg.cotacao, contas: 0, semPreco: 0, esperadoYuan: 0, esperado: 0, pago: 0, diferenca: 0 };
  if (inicio > ate || !cfg.estoque) return saida;
  const [contas, tabela, pago] = await Promise.all([
    banco.q(
      `SELECT produto_id, count(*)::int AS n FROM contas
        WHERE origem IN ('painel', 'manual') AND criada_em >= ${inicioDoDia} AND criada_em < (($2::date + 1)::timestamp AT TIME ZONE '${FUSO}')
        GROUP BY 1`,
      [inicio, ate],
    ),
    precos(),
    banco.q(`SELECT coalesce(sum(valor), 0) AS total FROM fin_despesas WHERE tipo = 'despesa' AND categoria = $3 AND data BETWEEN $1 AND $2`, [inicio, ate, COMPRA_DE_CONTAS]),
  ]);
  for (const c of contas.rows) {
    saida.contas += c.n;
    if (tabela[c.produto_id] == null) saida.semPreco += c.n;
    else saida.esperadoYuan += tabela[c.produto_id] * c.n;
  }
  saida.esperado = saida.esperadoYuan * cfg.cotacao;
  saida.pago = n(pago.rows[0].total);
  saida.diferenca = saida.pago - saida.esperado;
  return saida;
}

/** "Compra de contas" lancada a partir de `desde`: sai do lucro, porque o custo ja vem de cada venda. */
async function compraDeContas(de, ate) {
  const cfg = await config();
  const inicio = de > cfg.desde ? de : cfg.desde;
  if (inicio > ate) return { total: 0, porDia: {} };
  const r = await banco.q(
    `SELECT to_char(data, 'YYYY-MM-DD') AS dia, sum(valor) AS total FROM fin_despesas WHERE tipo = 'despesa' AND categoria = $3 AND data BETWEEN $1 AND $2 GROUP BY 1`,
    [inicio, ate, COMPRA_DE_CONTAS],
  );
  const porDia = {};
  let total = 0;
  for (const l of r.rows) {
    porDia[l.dia] = n(l.total);
    total += n(l.total);
  }
  return { total, porDia };
}

/** Jogos com preco, para escolher os de um combo. */
async function jogosComPreco() {
  if (!(await temEstoque())) return [];
  const r = await banco.q(
    `SELECT c.produto_id AS id, coalesce(p.nome, 'Jogo ' || c.produto_id) AS nome, c.yuan
       FROM custos c LEFT JOIN fin_produtos p ON p.id = c.produto_id
      ORDER BY 2`,
  );
  return r.rows.map((l) => ({ id: Number(l.id), nome: l.nome, yuan: n(l.yuan) }));
}

async function escolher(numero, produtos) {
  const tabela = await precos();
  const nomes = await banco.q('SELECT id, nome FROM fin_produtos WHERE id = ANY($1)', [produtos.map(Number)]);
  const nome = {};
  for (const l of nomes.rows) nome[l.id] = l.nome;
  const jogos = produtos.map((id) => ({ produto: Number(id), nome: nome[id] || 'Jogo ' + id, yuan: tabela[id] == null ? null : tabela[id] }));
  await banco.q(
    `INSERT INTO fin_custos_pedido (numero, jogos) VALUES ($1, $2) ON CONFLICT (numero) DO UPDATE SET jogos = EXCLUDED.jogos, atualizado_em = now()`,
    [numero, JSON.stringify(jogos)],
  );
  return jogos;
}

async function voltarAoAutomatico(numero) {
  await banco.q('DELETE FROM fin_custos_pedido WHERE numero = $1', [numero]);
}

module.exports = { COMPRA_DE_CONTAS, preparar, config, dosPedidos, doPeriodo, conferencia, compraDeContas, jogosComPreco, escolher, voltarAoAutomatico };
