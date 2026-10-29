'use strict';

/**
 * Painel financeiro privado da Phaze Games (so admin).
 *
 * Os pedidos vem da Nerix e ficam copiados no banco (sync.js), com o liquido
 * e as taxas que a propria Nerix calcula em cada pagamento. Despesas sao
 * lancadas aqui. Todas as datas sao agrupadas no horario de Brasilia.
 */

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const banco = require('./banco');
const sync = require('./sync');
const lancamentos = require('./lancamentos');
const analise = require('./analise');
const custos = require('./custos');

const USUARIO = (process.env.FIN_USUARIO || '').trim();
const SENHA = (process.env.FIN_SENHA || '').trim();
const SEGREDO = (process.env.SESSAO_SEGREDO || '').trim() || crypto.randomBytes(32).toString('hex');
const PORTA = Number(process.env.PORT || 3000);
const DURACAO_SESSAO = 7 * 24 * 60 * 60 * 1000;
const FUSO = 'America/Sao_Paulo';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const pronto = !!(USUARIO && SENHA && banco.configurado() && sync.configurado());

// ─── sessao (mesmo modelo do painel de estoque) ──────────────────────

const assinar = (valor) => crypto.createHmac('sha256', SEGREDO + '|' + SENHA).update(valor).digest('base64url');
function criarSessao() {
  const ate = String(Date.now() + DURACAO_SESSAO);
  return ate + '.' + assinar(ate);
}
function sessaoValida(cookie) {
  if (!cookie) return false;
  const [ate, assinatura] = cookie.split('.');
  if (!ate || !assinatura || Number(ate) < Date.now()) return false;
  const a = Buffer.from(assinar(ate));
  const b = Buffer.from(assinatura);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function lerCookie(req, nome) {
  for (const parte of (req.get('cookie') || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return '';
}
function iguais(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
const tentativas = new Map();
function bloqueado(ip) {
  const t = tentativas.get(ip);
  if (!t) return false;
  if (Date.now() - t.desde > 15 * 60 * 1000) {
    tentativas.delete(ip);
    return false;
  }
  return t.erros >= 8;
}
function errou(ip) {
  const t = tentativas.get(ip) || { erros: 0, desde: Date.now() };
  t.erros++;
  tentativas.set(ip, t);
}

const falhou = (res, e) => {
  console.warn('[api]', e.message);
  res.status(e.status || 500).json({ ok: false, erro: e.status ? e.message : 'Erro no servidor.' });
};

// ─── periodo ─────────────────────────────────────────────────────────

const dataValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));
function hojeBR(quando) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(quando ? new Date(quando) : new Date());
}
function periodo(req) {
  const ate = dataValida(req.query.ate) ? req.query.ate : hojeBR();
  const de = dataValida(req.query.de) ? req.query.de : ate;
  if (de > ate) throw Object.assign(new Error('A data inicial e depois da final.'), { status: 400 });
  const dias = Math.round((Date.parse(ate) - Date.parse(de)) / 86400000) + 1;
  if (dias > 800) throw Object.assign(new Error('Periodo grande demais.'), { status: 400 });
  const antesAte = new Date(Date.parse(de) - 86400000).toISOString().slice(0, 10);
  const antesDe = new Date(Date.parse(de) - dias * 86400000).toISOString().slice(0, 10);
  return { de, ate, dias, antesDe, antesAte };
}
const JANELA = `criado_em >= ($1::date::timestamp AT TIME ZONE '${FUSO}') AND criado_em < (($2::date + 1)::timestamp AT TIME ZONE '${FUSO}')`;
const n = (v) => (v == null ? 0 : Number(v));

// ─── app ─────────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  );
  next();
});

let bancoPronto = false;
app.get('/saude', (_req, res) => res.json({ ok: true, configurado: pronto, banco: bancoPronto, sync: sync.situacao() }));

app.post('/entrar', (req, res) => {
  const ip = req.ip;
  if (!pronto) return res.status(503).json({ ok: false, erro: 'Painel sem configuracao no servidor.' });
  if (bloqueado(ip)) return res.status(429).json({ ok: false, erro: 'Muitas tentativas. Espere 15 minutos.' });
  const { usuario, senha } = req.body || {};
  if (!(iguais(usuario || '', USUARIO) & iguais(senha || '', SENHA))) {
    errou(ip);
    banco.registrar('login_errado', { ip });
    return res.status(401).json({ ok: false, erro: 'Usuario ou senha incorretos.' });
  }
  tentativas.delete(ip);
  banco.registrar('login', { ip });
  res.set('Set-Cookie', 'fin=' + encodeURIComponent(criarSessao()) + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + DURACAO_SESSAO / 1000);
  res.json({ ok: true });
});

app.post('/sair', (_req, res) => {
  res.set('Set-Cookie', 'fin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!sessaoValida(lerCookie(req, 'fin'))) return res.status(401).json({ ok: false, erro: 'Entre de novo.' });
  if (!bancoPronto) return res.status(503).json({ ok: false, erro: 'O banco de dados nao conectou.' });
  next();
});

app.get('/api/resumo', async (req, res) => {
  try {
    const p = periodo(req);
    const f = analise.filtros(req);
    const r = await analise.resumo(p, f, hojeBR());
    const total = f.plataforma || f.metodo ? await analise.totais(p.de, p.ate, { plataforma: '', metodo: '' }) : r.atual;
    const divisao = await lancamentos.divisao(p.de, p.ate, total.liberado, total.aLiberar);
    res.json(Object.assign({ ok: true, divisao, sync: sync.situacao() }, r));
  } catch (e) {
    falhou(res, e);
  }
});

app.get('/api/receber', async (_req, res) => {
  try {
    const r = await banco.q(
      `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, sum(valor) AS valor, string_agg(DISTINCT tipo, ',') AS tipos FROM (
         SELECT (disponivel_em AT TIME ZONE '${FUSO}')::date AS dia, disponivel_valor AS valor, 'cartao' AS tipo FROM fin_pedidos WHERE pago AND disponivel_em > now() AND disponivel_valor > 0
         UNION ALL
         SELECT (reserva_em AT TIME ZONE '${FUSO}')::date, reserva_valor, 'reserva' FROM fin_pedidos WHERE pago AND reserva_em > now() AND reserva_valor > 0
       ) x GROUP BY dia ORDER BY dia LIMIT 60`,
    );
    const t = await banco.q(
      `SELECT coalesce(sum(disponivel_valor) FILTER (WHERE disponivel_em > now()), 0) AS cartao,
              coalesce(sum(reserva_valor) FILTER (WHERE reserva_em > now()), 0) AS reserva,
              coalesce(sum(disponivel_valor) FILTER (WHERE disponivel_em > now() AND disponivel_em < now() + interval '7 days'), 0) AS semana
         FROM fin_pedidos WHERE pago`,
    );
    const x = t.rows[0];
    res.json({ ok: true, dias: r.rows.map((d) => ({ dia: d.dia, valor: n(d.valor), tipos: d.tipos })), cartao: n(x.cartao), reserva: n(x.reserva), semana: n(x.semana) });
  } catch (e) {
    falhou(res, e);
  }
});

function filtroPedidos(req) {
  const p = periodo(req);
  const onde = [JANELA];
  const args = [p.de, p.ate];
  const st = String(req.query.status || '');
  if (st === 'pago' || st === 'semcusto') onde.push('pago');
  else if (st === 'aberto') onde.push("NOT pago AND pagamento = 'pending'");
  else if (st === 'cancelado') onde.push("NOT pago AND pagamento <> 'pending'");
  const metodo = String(req.query.metodo || '');
  if (metodo === 'pix' || metodo === 'card') {
    args.push(metodo);
    onde.push('metodo = $' + args.length);
  }
  const busca = String(req.query.q || '').trim().toLowerCase().slice(0, 80);
  if (busca) {
    args.push('%' + busca + '%');
    const i = '$' + args.length;
    onde.push(`(lower(numero) LIKE ${i} OR lower(cliente) LIKE ${i} OR lower(email) LIKE ${i} OR telefone LIKE ${i} OR lower(itens::text) LIKE ${i} OR nerix_id::text LIKE ${i})`);
  }
  return { onde: onde.join(' AND '), args };
}

/** Custo do fornecedor dos pedidos pagos a partir da data em que o custo por venda passou a valer. */
async function comCusto(pedidos) {
  const cfg = await custos.config();
  const contam = pedidos.filter((p) => p.pago && hojeBR(p.criado_em) >= cfg.desde);
  const c = await custos.dosPedidos(contam);
  return pedidos.map((p) => {
    const x = c[p.numero];
    return x ? Object.assign({}, p, { custo: { reais: x.yuan * cfg.cotacao, yuan: x.yuan, completo: x.completo, fonte: x.fonte } }) : p;
  });
}

const SQL_LISTA = 'SELECT numero, nerix_id, criado_em, status, pagamento, metodo, pago, total, liquido, taxas, parcelas, cliente, itens FROM fin_pedidos';
const numeros = (r) => Object.assign({}, r, { total: n(r.total), liquido: r.liquido == null ? null : n(r.liquido), taxas: r.taxas == null ? null : n(r.taxas) });

app.get('/api/pedidos', async (req, res) => {
  try {
    const { onde, args } = filtroPedidos(req);
    const pagina = Math.max(1, Math.min(200, Number(req.query.pagina) || 1));
    if (req.query.status === 'semcusto') {
      const todos = await comCusto((await banco.q(`${SQL_LISTA} WHERE ${onde} ORDER BY criado_em DESC LIMIT 3000`, args)).rows.map(numeros));
      const sem = todos.filter((p) => p.custo && !p.custo.completo);
      return res.json({ ok: true, pagina, total: sem.length, bruto: sem.reduce((s, p) => s + p.total, 0), pedidos: sem.slice((pagina - 1) * 50, pagina * 50) });
    }
    const [lista, total] = await Promise.all([
      banco.q(`${SQL_LISTA} WHERE ${onde} ORDER BY criado_em DESC LIMIT 50 OFFSET ${(pagina - 1) * 50}`, args),
      banco.q(`SELECT count(*)::int AS n, coalesce(sum(total) FILTER (WHERE pago), 0) AS bruto FROM fin_pedidos WHERE ${onde}`, args),
    ]);
    res.json({
      ok: true,
      pagina,
      total: total.rows[0].n,
      bruto: n(total.rows[0].bruto),
      pedidos: await comCusto(lista.rows.map(numeros)),
    });
  } catch (e) {
    falhou(res, e);
  }
});

app.get('/api/pedidos/:numero', async (req, res) => {
  try {
    const r = await banco.q('SELECT * FROM fin_pedidos WHERE numero = $1', [String(req.params.numero)]);
    if (!r.rows[0]) return res.status(404).json({ ok: false, erro: 'Pedido nao encontrado.' });
    const p = r.rows[0];
    const outros = p.email
      ? await banco.q('SELECT count(*)::int AS n, coalesce(sum(total), 0) AS total FROM fin_pedidos WHERE pago AND lower(email) = lower($1)', [p.email])
      : { rows: [{ n: 0, total: 0 }] };
    for (const c of ['total', 'subtotal', 'desconto', 'liquido', 'taxas', 'taxa_gateway', 'taxa_plataforma', 'disponivel_valor', 'reserva_valor']) if (p[c] != null) p[c] = n(p[c]);
    const cfg = await custos.config();
    let custo = null;
    if (p.pago) {
      const c = (await custos.dosPedidos([p]))[p.numero];
      custo = Object.assign({ reais: c.yuan * cfg.cotacao, cotacao: cfg.cotacao, conta: hojeBR(p.criado_em) >= cfg.desde, desde: cfg.desde }, c);
    }
    res.json({ ok: true, pedido: p, custo, cliente: { pedidos: outros.rows[0].n, total: n(outros.rows[0].total) } });
  } catch (e) {
    falhou(res, e);
  }
});

app.get('/api/custos/jogos', async (_req, res) => {
  try {
    const [jogos, cfg] = await Promise.all([custos.jogosComPreco(), custos.config()]);
    res.json({ ok: true, jogos, cotacao: cfg.cotacao, desde: cfg.desde, estoque: cfg.estoque });
  } catch (e) {
    falhou(res, e);
  }
});

app.post('/api/pedidos/:numero/custo', async (req, res) => {
  try {
    const numero = String(req.params.numero);
    const produtos = Array.isArray(req.body && req.body.produtos) ? req.body.produtos.map(Number).filter((x) => x > 0).slice(0, 20) : [];
    if (!produtos.length) return res.status(400).json({ ok: false, erro: 'Escolha pelo menos um jogo.' });
    const r = await banco.q('SELECT numero FROM fin_pedidos WHERE numero = $1', [numero]);
    if (!r.rows[0]) return res.status(404).json({ ok: false, erro: 'Pedido nao encontrado.' });
    const jogos = await custos.escolher(numero, produtos);
    banco.registrar('custo_escolhido', { ip: req.ip, numero, jogos: jogos.map((j) => j.nome + ' ' + j.yuan) });
    res.json({ ok: true, jogos });
  } catch (e) {
    falhou(res, e);
  }
});

app.delete('/api/pedidos/:numero/custo', async (req, res) => {
  try {
    await custos.voltarAoAutomatico(String(req.params.numero));
    banco.registrar('custo_automatico', { ip: req.ip, numero: String(req.params.numero) });
    res.json({ ok: true });
  } catch (e) {
    falhou(res, e);
  }
});

app.put('/api/custos/desde', async (req, res) => {
  try {
    const data = String((req.body && req.body.data) || '');
    if (!dataValida(data)) return res.status(400).json({ ok: false, erro: 'Data invalida.' });
    await banco.gravarEstado('custo_desde', data);
    banco.registrar('custo_desde', { ip: req.ip, data });
    res.json({ ok: true, desde: data });
  } catch (e) {
    falhou(res, e);
  }
});

app.get('/api/exportar', async (req, res) => {
  try {
    const { onde, args } = filtroPedidos(req);
    const r = await banco.q(
      `SELECT numero, nerix_id, to_char(criado_em AT TIME ZONE '${FUSO}', 'DD/MM/YYYY HH24:MI') AS data, pagamento, metodo, parcelas, total, desconto, taxas, liquido,
              cliente, email, telefone, itens FROM fin_pedidos WHERE ${onde} ORDER BY criado_em`,
      args,
    );
    const cel = (v) => {
      const s = v == null ? '' : String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const dinheiro = (v) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','));
    const linhas = ['Pedido;ID;Data;Pagamento;Metodo;Parcelas;Total;Desconto;Taxas;Liquido;Cliente;Email;Telefone;Jogos'];
    for (const p of r.rows) {
      linhas.push(
        [p.numero, p.nerix_id, p.data, p.pagamento, p.metodo, p.parcelas || '', dinheiro(p.total), dinheiro(p.desconto), dinheiro(p.taxas), dinheiro(p.liquido), p.cliente, p.email, p.telefone, p.itens.map((i) => i.qtd + 'x ' + i.nome).join(' + ')]
          .map(cel)
          .join(';'),
      );
    }
    const p = periodo(req);
    banco.registrar('exportou', { ip: req.ip, de: p.de, ate: p.ate, linhas: r.rows.length });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="pedidos-${p.de}-a-${p.ate}.csv"`);
    res.send('﻿' + linhas.join('\r\n'));
  } catch (e) {
    falhou(res, e);
  }
});

lancamentos.rotas(app, { periodo, falhou });

app.post('/api/sincronizar', (req, res) => {
  sync.sincronizar(!!(req.body && req.body.completo));
  res.json({ ok: true, sync: sync.situacao() });
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0 }));

async function iniciar() {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await banco.preparar();
      await custos.preparar();
      bancoPronto = true;
      console.log('[banco] conectado');
      break;
    } catch (e) {
      console.warn('[banco] tentativa ' + tentativa + ' falhou: ' + e.message);
      await espera(Math.min(60, tentativa * 5) * 1000);
    }
  }
  await lancamentos.gerarRecorrentes().catch((e) => console.warn('[fixos]', e.message));
  setInterval(() => lancamentos.gerarRecorrentes().catch(() => {}), 60 * 60 * 1000);
  await sync.sincronizar(false);
  setInterval(() => sync.sincronizar(false), 3 * 60 * 1000);
}

if (require.main === module) {
  app.listen(PORTA, () => {
    console.log('Painel financeiro na porta ' + PORTA + (pronto ? '' : ' (FALTA configurar FIN_USUARIO, FIN_SENHA, NERIX_KEY e DATABASE_URL)'));
    if (pronto) iniciar();
  });
}

module.exports = { app, periodo };
