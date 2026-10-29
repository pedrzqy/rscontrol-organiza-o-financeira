'use strict';

/**
 * Numeros da visao geral, com filtro de plataforma e de forma de pagamento.
 *
 * Com plataforma escolhida, cada pedido entra so com a fatia dos itens
 * daquela plataforma: um pedido de R$ 100 com R$ 60 de Nintendo conta
 * R$ 60 de bruto e 60% do liquido e das taxas.
 */

const banco = require('./banco');

const FUSO = 'America/Sao_Paulo';
const PLATAFORMAS = ['Nintendo', 'Steam', 'PlayStation'];
const n = (v) => (v == null ? 0 : Number(v));

function cte(comCorte) {
  return `WITH b AS (
      SELECT p.*,
             CASE WHEN $3::text = '' THEN 1
                  ELSE coalesce((SELECT sum((i->>'total')::numeric) FROM jsonb_array_elements(p.itens) i
                                  JOIN fin_produtos pr ON pr.id = (i->>'produto')::bigint WHERE pr.categoria = $3), 0) / nullif(p.subtotal, 0)
             END AS f
        FROM fin_pedidos p
       WHERE p.criado_em >= ($1::date::timestamp AT TIME ZONE '${FUSO}')
         AND p.criado_em < (($2::date + 1)::timestamp AT TIME ZONE '${FUSO}')
         AND ($4::text = '' OR p.metodo = $4)
         ${comCorte ? 'AND p.criado_em < $5' : ''}
    ), base AS (SELECT * FROM b WHERE f > 0)`;
}

function filtros(req) {
  const plataforma = PLATAFORMAS.includes(req.query.plataforma) ? req.query.plataforma : '';
  const metodo = ['pix', 'card'].includes(req.query.metodo) ? req.query.metodo : '';
  return { plataforma, metodo };
}

async function totais(de, ate, f, corte) {
  const args = [de, ate, f.plataforma, f.metodo];
  if (corte) args.push(corte);
  const r = await banco.q(
    `${cte(!!corte)}
     SELECT count(*) FILTER (WHERE pago)::int AS pagos,
            count(*)::int AS criados,
            coalesce(sum(total * f) FILTER (WHERE pago), 0) AS bruto,
            coalesce(sum(coalesce(liquido, total) * f) FILTER (WHERE pago), 0) AS liquido,
            coalesce(sum(coalesce(taxas, 0) * f) FILTER (WHERE pago), 0) AS taxas,
            coalesce(sum(desconto * f) FILTER (WHERE pago), 0) AS descontos,
            coalesce(sum(f * CASE WHEN disponivel_em IS NULL THEN coalesce(liquido, total)
                              ELSE (CASE WHEN disponivel_em <= now() THEN coalesce(disponivel_valor, 0) ELSE 0 END)
                                 + (CASE WHEN reserva_em <= now() THEN coalesce(reserva_valor, 0) ELSE 0 END) END) FILTER (WHERE pago), 0) AS liberado,
            count(*) FILTER (WHERE NOT pago AND pagamento = 'pending')::int AS abertos,
            coalesce(sum(total * f) FILTER (WHERE NOT pago AND pagamento = 'pending'), 0) AS abertos_valor,
            count(DISTINCT lower(nullif(email, ''))) FILTER (WHERE pago)::int AS clientes
       FROM base`,
    args,
  );
  const d = await banco.q("SELECT coalesce(sum(valor), 0) AS total FROM fin_despesas WHERE tipo = 'despesa' AND data BETWEEN $1 AND $2", [de, ate]);
  const t = r.rows[0];
  const liquido = n(t.liquido);
  const despesas = f.plataforma || f.metodo ? 0 : n(d.rows[0].total);
  return {
    pagos: t.pagos,
    criados: t.criados,
    bruto: n(t.bruto),
    liquido,
    taxas: n(t.taxas),
    liberado: Math.min(n(t.liberado), liquido),
    aLiberar: Math.max(0, liquido - n(t.liberado)),
    descontos: n(t.descontos),
    abertos: t.abertos,
    abertosValor: n(t.abertos_valor),
    clientes: t.clientes,
    ticket: t.pagos ? n(t.bruto) / t.pagos : 0,
    conversao: t.criados ? t.pagos / t.criados : 0,
    despesas,
    lucro: liquido - despesas,
  };
}

async function serieDiaria(de, ate, f) {
  const r = await banco.q(
    `${cte(false)}
     SELECT to_char(d, 'YYYY-MM-DD') AS dia,
            coalesce(sum(b.total * b.f) FILTER (WHERE b.pago), 0) AS bruto,
            coalesce(sum(coalesce(b.liquido, b.total) * b.f) FILTER (WHERE b.pago), 0) AS liquido,
            count(b.numero) FILTER (WHERE b.pago)::int AS pedidos,
            count(b.numero)::int AS criados
       FROM generate_series($1::date, $2::date, interval '1 day') d
       LEFT JOIN base b ON (b.criado_em AT TIME ZONE '${FUSO}')::date = d::date
      GROUP BY d ORDER BY d`,
    [de, ate, f.plataforma, f.metodo],
  );
  const desp = await banco.q(
    "SELECT to_char(data, 'YYYY-MM-DD') AS dia, sum(valor) AS total FROM fin_despesas WHERE tipo = 'despesa' AND data BETWEEN $1 AND $2 GROUP BY 1",
    [de, ate],
  );
  const porDia = {};
  for (const x of desp.rows) porDia[x.dia] = n(x.total);
  return r.rows.map((x) => ({ dia: x.dia, bruto: n(x.bruto), liquido: n(x.liquido), pedidos: x.pedidos, criados: x.criados, despesas: f.plataforma || f.metodo ? 0 : porDia[x.dia] || 0 }));
}

async function resumo(p, f, hoje) {
  const mesmoHorario = p.ate === hoje;
  const corte = mesmoHorario ? new Date(Date.now() - p.dias * 86400000) : null;
  const args = [p.de, p.ate, f.plataforma, f.metodo];
  const [atual, anterior, serie, serieAnterior, porMetodo, porCategoria, topJogos, calor, despesasCat, clientes] = await Promise.all([
    totais(p.de, p.ate, f),
    totais(p.antesDe, p.antesAte, f, corte),
    serieDiaria(p.de, p.ate, f),
    serieDiaria(p.antesDe, p.antesAte, f),
    banco.q(
      `${cte(false)} SELECT metodo, count(*)::int AS pedidos, sum(total * f) AS bruto, sum(coalesce(liquido, total) * f) AS liquido, coalesce(sum(coalesce(taxas, 0) * f), 0) AS taxas
         FROM base WHERE pago GROUP BY metodo ORDER BY bruto DESC`,
      args,
    ),
    banco.q(
      `${cte(false)} SELECT coalesce(pr.categoria, 'Outros') AS categoria, sum((i->>'total')::numeric * coalesce(b.total / nullif(b.subtotal, 0), 1)) AS receita, sum((i->>'qtd')::int)::int AS qtd, count(DISTINCT b.numero)::int AS pedidos
         FROM base b, jsonb_array_elements(b.itens) i
         LEFT JOIN fin_produtos pr ON pr.id = (i->>'produto')::bigint
        WHERE b.pago AND ($3::text = '' OR pr.categoria = $3)
        GROUP BY 1 ORDER BY receita DESC`,
      args,
    ),
    banco.q(
      `${cte(false)} SELECT coalesce(pai.nome, pr.nome, i->>'nome') AS nome, coalesce(pr.categoria, 'Outros') AS categoria,
              sum((i->>'qtd')::int)::int AS qtd, sum((i->>'total')::numeric * coalesce(b.total / nullif(b.subtotal, 0), 1)) AS receita
         FROM base b, jsonb_array_elements(b.itens) i
         LEFT JOIN fin_produtos pr ON pr.id = (i->>'produto')::bigint
         LEFT JOIN fin_produtos pai ON pai.id = pr.pai
        WHERE b.pago AND ($3::text = '' OR pr.categoria = $3)
        GROUP BY 1, 2 ORDER BY receita DESC LIMIT 15`,
      args,
    ),
    banco.q(
      `${cte(false)} SELECT extract(isodow FROM criado_em AT TIME ZONE '${FUSO}')::int AS dia, extract(hour FROM criado_em AT TIME ZONE '${FUSO}')::int AS hora,
              count(*)::int AS pedidos, sum(total * f) AS bruto
         FROM base WHERE pago GROUP BY 1, 2`,
      args,
    ),
    banco.q("SELECT categoria, sum(valor) AS total FROM fin_despesas WHERE tipo = 'despesa' AND data BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC", [p.de, p.ate]),
    banco.q(
      `${cte(false)}, primeiro AS (SELECT lower(email) AS e, min(criado_em) AS em FROM fin_pedidos WHERE pago AND email <> '' GROUP BY 1)
       SELECT count(*) FILTER (WHERE pr.em >= ($1::date::timestamp AT TIME ZONE '${FUSO}'))::int AS novos,
              count(*) FILTER (WHERE pr.em < ($1::date::timestamp AT TIME ZONE '${FUSO}'))::int AS voltaram
         FROM (SELECT DISTINCT lower(email) AS e FROM base WHERE pago AND email <> '') x JOIN primeiro pr ON pr.e = x.e`,
      args,
    ),
  ]);
  const num = (rows, campos) => rows.map((r) => Object.assign({}, r, Object.fromEntries(campos.map((c) => [c, n(r[c])]))));
  return {
    periodo: Object.assign({ mesmoHorario }, p),
    filtros: f,
    atual,
    anterior,
    serie,
    serieAnterior,
    porMetodo: num(porMetodo.rows, ['bruto', 'liquido', 'taxas']),
    porCategoria: num(porCategoria.rows, ['receita']),
    topJogos: num(topJogos.rows, ['receita']),
    calor: num(calor.rows, ['bruto']),
    despesasCat: num(despesasCat.rows, ['total']),
    clientes: clientes.rows[0],
  };
}

module.exports = { PLATAFORMAS, filtros, totais, resumo };
