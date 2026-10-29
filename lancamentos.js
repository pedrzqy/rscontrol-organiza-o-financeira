'use strict';

/**
 * Controle de caixa dos socios: despesas, retiradas e aportes de Pedro e
 * Arthur (ou pagos pela propria loja), custos fixos que se repetem todo mes
 * e a divisao do lucro entre os dois.
 *
 * Conta de cada socio no periodo:
 *   precisa receber agora = parte do lucro ja liberado na carteira
 *                         + despesas que ele pagou do bolso
 *                         + aportes que ele fez
 *                         - retiradas que ele ja fez
 *   quando liberar        = parte do que o cartao ainda vai liberar
 */

const banco = require('./banco');

const SOCIOS = ['Pedro', 'Arthur'];
const PAGADORES = SOCIOS.concat(['Loja']);
const TIPOS = ['despesa', 'retirada', 'aporte', 'saque'];
const CATEGORIAS = ['Anúncios', 'Compra de contas', 'Ferramentas e sistemas', 'Hospedagem e domínios', 'Equipe', 'Impostos e taxas', 'Fornecedores', 'Outros'];
const FORMAS = ['Pix', 'Cartão de crédito', 'Boleto', 'Transferência', 'Dinheiro', 'Saldo da Nerix'];
const FUSO = 'America/Sao_Paulo';

const n = (v) => (v == null ? 0 : Number(v));
const mesAtual = () => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date()).slice(0, 7);
const erro = (msg, status) => Object.assign(new Error(msg), { status: status || 400 });

async function divisaoConfig() {
  const v = await banco.estado('divisao');
  const padrao = { Pedro: 50, Arthur: 50 };
  if (!v || typeof v !== 'object') return padrao;
  const p = Number(v.Pedro);
  return Number.isFinite(p) && p >= 0 && p <= 100 ? { Pedro: p, Arthur: 100 - p } : padrao;
}

function validar(b, parcial) {
  const tipo = TIPOS.includes(b.tipo) ? b.tipo : 'despesa';
  const pessoa = String(b.pessoa || '');
  const valor = typeof b.valor === 'number' ? b.valor : Number(String(b.valor || '').replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data || '')) || Number.isNaN(Date.parse(b.data))) throw erro('Data invalida.');
  if (!(valor > 0 && valor < 10000000)) throw erro('Valor invalido.');
  if (tipo === 'despesa' ? !PAGADORES.includes(pessoa) : !SOCIOS.includes(pessoa)) throw erro(tipo === 'despesa' ? 'Escolha quem pagou.' : 'Escolha o socio.');
  const categoria = tipo === 'despesa' ? String(b.categoria || '') : { retirada: 'Retirada', aporte: 'Aporte', saque: 'Saque' }[tipo];
  if (tipo === 'despesa' && !CATEGORIAS.includes(categoria)) throw erro('Escolha uma categoria.');
  const forma = FORMAS.includes(b.forma) ? b.forma : tipo === 'despesa' && pessoa === 'Loja' ? 'Saldo da Nerix' : '';
  return { tipo, pessoa, valor: valor.toFixed(2), data: b.data, categoria, forma, descricao: String(b.descricao || '').trim().slice(0, 200) };
}

/** Lanca os custos fixos do mes corrente que ainda nao foram lancados. */
async function gerarRecorrentes() {
  const mes = mesAtual();
  const r = await banco.q('SELECT * FROM fin_recorrentes WHERE ativo AND desde <= $1', [mes]);
  let novos = 0;
  for (const c of r.rows) {
    const ultimoDia = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
    const data = mes + '-' + String(Math.min(c.dia, ultimoDia)).padStart(2, '0');
    const x = await banco.q(
      `INSERT INTO fin_despesas (data, tipo, pessoa, categoria, forma, descricao, valor, recorrente_id, mes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [data, c.tipo, c.pessoa, c.categoria, c.forma, c.descricao, c.valor, c.id, mes],
    );
    novos += x.rowCount;
  }
  return novos;
}

/** Totais de despesas, retiradas e aportes por pessoa no periodo. */
async function porPessoa(de, ate) {
  const r = await banco.q(
    `SELECT pessoa, tipo, coalesce(sum(valor), 0) AS total, count(*)::int AS n FROM fin_despesas WHERE data BETWEEN $1 AND $2 GROUP BY 1, 2`,
    [de, ate],
  );
  const saida = {};
  for (const p of PAGADORES) saida[p] = { despesas: 0, retiradas: 0, aportes: 0, saques: 0, lancamentos: 0 };
  let despesas = 0;
  for (const l of r.rows) {
    const quem = saida[l.pessoa] || (saida[l.pessoa || 'Sem nome'] = { despesas: 0, retiradas: 0, aportes: 0, saques: 0, lancamentos: 0 });
    const v = n(l.total);
    if (l.tipo === 'retirada') quem.retiradas += v;
    else if (l.tipo === 'saque') quem.saques += v;
    else if (l.tipo === 'aporte') quem.aportes += v;
    else {
      quem.despesas += v;
      despesas += v;
    }
    quem.lancamentos += l.n;
  }
  return { pessoas: saida, despesas };
}

/**
 * A divisao do periodo. `liberado` e `aLiberar` sao o liquido das vendas que
 * ja caiu na carteira e o que o cartao ainda vai soltar.
 */
/**
 * Quando o periodo e um mes (inteiro ou ate hoje) e existe a conferencia da
 * carteira daquele mes, a divisao usa o dinheiro real da carteira da Nerix
 * (saques + liberado, e o pendente) em vez do calculo pelos pedidos.
 */
async function carteiraDoPeriodo(de, ate) {
  if (de.slice(8) !== '01' || de.slice(0, 7) !== ate.slice(0, 7)) return null;
  const r = await banco.q('SELECT * FROM fin_carteira WHERE mes = $1', [de.slice(0, 7)]);
  const c = r.rows[0];
  return c ? { mes: c.mes, saques: n(c.saques), liberado: n(c.liberado), pendente: n(c.pendente), atualizadoEm: c.atualizado_em } : null;
}

async function divisao(de, ate, liberadoPedidos, aLiberarPedidos) {
  const [cfg, pp, cart] = await Promise.all([divisaoConfig(), porPessoa(de, ate), carteiraDoPeriodo(de, ate)]);
  const liberado = cart ? cart.saques + cart.liberado : liberadoPedidos;
  const aLiberar = cart ? cart.pendente : aLiberarPedidos;
  const lucroLiberado = liberado - pp.despesas;
  const centavos = (v) => Math.round(v * 100);
  const repartir = (total) => {
    const cents = centavos(total);
    const arthur = Math.round((cents * cfg.Arthur) / 100);
    return SOCIOS.map((nome) => (nome === 'Arthur' ? arthur : cents - arthur) / 100);
  };
  const partes = repartir(lucroLiberado);
  const depois = repartir(aLiberar);
  const socios = SOCIOS.map((nome, i) => {
    const p = pp.pessoas[nome];
    const agora = Math.round((partes[i] + p.despesas + p.aportes - p.retiradas) * 100) / 100;
    return { nome, pct: cfg[nome], parteLucro: partes[i], reembolso: p.despesas, aportes: p.aportes, retiradas: p.retiradas, agora, depois: depois[i], total: Math.round((agora + depois[i]) * 100) / 100 };
  });
  return {
    fonte: cart ? 'carteira' : 'pedidos',
    carteira: cart,
    mes: de.slice(0, 7) === ate.slice(0, 7) ? ate.slice(0, 7) : null,
    liberado,
    pelosPedidos: { liberado: liberadoPedidos, aLiberar: aLiberarPedidos },
    lucroLiberado,
    aLiberar,
    lucroPrevisto: lucroLiberado + aLiberar,
    despesas: pp.despesas,
    pagoPelaLoja: pp.pessoas.Loja.despesas,
    retiradas: SOCIOS.reduce((s, x) => s + pp.pessoas[x].retiradas, 0),
    saquesLancados: SOCIOS.reduce((s, x) => s + pp.pessoas[x].saques, 0),
    aportes: SOCIOS.reduce((s, x) => s + pp.pessoas[x].aportes, 0),
    socios,
  };
}

function rotas(app, { periodo, falhou }) {
  app.get('/api/lancamentos', async (req, res) => {
    try {
      await gerarRecorrentes();
      const p = periodo(req);
      const onde = ['data BETWEEN $1 AND $2'];
      const args = [p.de, p.ate];
      if (PAGADORES.includes(req.query.pessoa)) {
        args.push(req.query.pessoa);
        onde.push('pessoa = $' + args.length);
      }
      if (TIPOS.includes(req.query.tipo)) {
        args.push(req.query.tipo);
        onde.push('tipo = $' + args.length);
      }
      const busca = String(req.query.q || '').trim().toLowerCase().slice(0, 60);
      if (busca) {
        args.push('%' + busca + '%');
        onde.push(`(lower(descricao) LIKE $${args.length} OR lower(categoria) LIKE $${args.length})`);
      }
      const [lista, cats, pp, rec, cfg] = await Promise.all([
        banco.q(`SELECT id, to_char(data, 'YYYY-MM-DD') AS data, tipo, pessoa, categoria, forma, descricao, valor, recorrente_id FROM fin_despesas WHERE ${onde.join(' AND ')} ORDER BY data DESC, id DESC LIMIT 500`, args),
        banco.q(`SELECT categoria, sum(valor) AS total FROM fin_despesas WHERE tipo = 'despesa' AND ${onde.join(' AND ')} GROUP BY 1 ORDER BY 2 DESC`, args),
        porPessoa(p.de, p.ate),
        banco.q('SELECT id, tipo, pessoa, categoria, forma, descricao, valor, dia, ativo, desde FROM fin_recorrentes ORDER BY ativo DESC, dia'),
        divisaoConfig(),
      ]);
      res.json({
        ok: true,
        opcoes: { socios: SOCIOS, pagadores: PAGADORES, categorias: CATEGORIAS, formas: FORMAS },
        lancamentos: lista.rows.map((d) => Object.assign({}, d, { valor: n(d.valor) })),
        porCategoria: cats.rows.map((c) => ({ categoria: c.categoria, total: n(c.total) })),
        porPessoa: pp.pessoas,
        despesas: pp.despesas,
        recorrentes: rec.rows.map((r) => Object.assign({}, r, { valor: n(r.valor) })),
        divisao: cfg,
      });
    } catch (e) {
      falhou(res, e);
    }
  });

  app.post('/api/lancamentos', async (req, res) => {
    try {
      const d = validar(req.body || {});
      let recorrenteId = null;
      if (req.body && req.body.repetir) {
        const dia = Number(d.data.slice(8, 10));
        const r = await banco.q(
          'INSERT INTO fin_recorrentes (tipo, pessoa, categoria, forma, descricao, valor, dia, desde) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
          [d.tipo, d.pessoa, d.categoria, d.forma, d.descricao, d.valor, dia, d.data.slice(0, 7)],
        );
        recorrenteId = r.rows[0].id;
      }
      const r = await banco.q(
        'INSERT INTO fin_despesas (data, tipo, pessoa, categoria, forma, descricao, valor, recorrente_id, mes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
        [d.data, d.tipo, d.pessoa, d.categoria, d.forma, d.descricao, d.valor, recorrenteId, recorrenteId ? d.data.slice(0, 7) : null],
      );
      banco.registrar('lancamento_criado', Object.assign({ ip: req.ip, id: r.rows[0].id, repetir: !!recorrenteId }, d));
      res.json({ ok: true, id: r.rows[0].id });
    } catch (e) {
      falhou(res, e);
    }
  });

  app.put('/api/lancamentos/:id', async (req, res) => {
    try {
      const d = validar(req.body || {});
      const r = await banco.q(
        'UPDATE fin_despesas SET data = $2, tipo = $3, pessoa = $4, categoria = $5, forma = $6, descricao = $7, valor = $8, atualizada_em = now() WHERE id = $1 RETURNING id',
        [Number(req.params.id), d.data, d.tipo, d.pessoa, d.categoria, d.forma, d.descricao, d.valor],
      );
      if (!r.rowCount) throw erro('Lancamento nao encontrado.', 404);
      banco.registrar('lancamento_editado', Object.assign({ ip: req.ip, id: Number(req.params.id) }, d));
      res.json({ ok: true });
    } catch (e) {
      falhou(res, e);
    }
  });

  app.delete('/api/lancamentos/:id', async (req, res) => {
    try {
      const r = await banco.q('DELETE FROM fin_despesas WHERE id = $1 RETURNING tipo, pessoa, categoria, valor, data', [Number(req.params.id)]);
      if (!r.rowCount) throw erro('Lancamento nao encontrado.', 404);
      banco.registrar('lancamento_apagado', Object.assign({ ip: req.ip, id: Number(req.params.id) }, r.rows[0]));
      res.json({ ok: true });
    } catch (e) {
      falhou(res, e);
    }
  });

  app.put('/api/recorrentes/:id', async (req, res) => {
    try {
      const b = req.body || {};
      const campos = [];
      const args = [Number(req.params.id)];
      if (typeof b.ativo === 'boolean') {
        args.push(b.ativo);
        campos.push('ativo = $' + args.length);
      }
      if (b.valor != null) {
        const v = Number(String(b.valor).replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
        if (!(v > 0 && v < 10000000)) throw erro('Valor invalido.');
        args.push(v.toFixed(2));
        campos.push('valor = $' + args.length);
      }
      if (!campos.length) throw erro('Nada para mudar.');
      const r = await banco.q(`UPDATE fin_recorrentes SET ${campos.join(', ')} WHERE id = $1 RETURNING id`, args);
      if (!r.rowCount) throw erro('Custo fixo nao encontrado.', 404);
      banco.registrar('recorrente_editado', { ip: req.ip, id: Number(req.params.id), ativo: b.ativo, valor: b.valor });
      res.json({ ok: true });
    } catch (e) {
      falhou(res, e);
    }
  });

  app.delete('/api/recorrentes/:id', async (req, res) => {
    try {
      const r = await banco.q('DELETE FROM fin_recorrentes WHERE id = $1 RETURNING descricao, valor', [Number(req.params.id)]);
      if (!r.rowCount) throw erro('Custo fixo nao encontrado.', 404);
      banco.registrar('recorrente_apagado', Object.assign({ ip: req.ip, id: Number(req.params.id) }, r.rows[0]));
      res.json({ ok: true });
    } catch (e) {
      falhou(res, e);
    }
  });

  app.put('/api/divisao', async (req, res) => {
    try {
      const p = Number(req.body && req.body.Pedro);
      if (!(Number.isFinite(p) && p >= 0 && p <= 100)) throw erro('Percentual invalido.');
      await banco.gravarEstado('divisao', { Pedro: p, Arthur: 100 - p });
      banco.registrar('divisao_mudou', { ip: req.ip, Pedro: p, Arthur: 100 - p });
      res.json({ ok: true });
    } catch (e) {
      falhou(res, e);
    }
  });

  app.put('/api/carteira/:mes', async (req, res) => {
    try {
      const mes = String(req.params.mes);
      if (!/^\d{4}-\d{2}$/.test(mes)) throw erro('Mes invalido.');
      const b = req.body || {};
      const num = (v) => {
        const x = typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
        if (!(x >= 0 && x < 100000000)) throw erro('Valor invalido.');
        return x.toFixed(2);
      };
      const v = [num(b.saques), num(b.liberado), num(b.pendente)];
      await banco.q(
        `INSERT INTO fin_carteira (mes, saques, liberado, pendente, atualizado_em) VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (mes) DO UPDATE SET saques = EXCLUDED.saques, liberado = EXCLUDED.liberado, pendente = EXCLUDED.pendente, atualizado_em = now()`,
        [mes].concat(v),
      );
      banco.registrar('carteira_conferida', { ip: req.ip, mes, saques: v[0], liberado: v[1], pendente: v[2] });
      res.json({ ok: true });
    } catch (e) {
      falhou(res, e);
    }
  });

  app.delete('/api/carteira/:mes', async (req, res) => {
    try {
      await banco.q('DELETE FROM fin_carteira WHERE mes = $1', [String(req.params.mes)]);
      banco.registrar('carteira_removida', { ip: req.ip, mes: String(req.params.mes) });
      res.json({ ok: true });
    } catch (e) {
      falhou(res, e);
    }
  });

  app.get('/api/lancamentos/planilha', async (req, res) => {
    try {
      const p = periodo(req);
      const r = await banco.q(`SELECT to_char(data, 'DD/MM/YYYY') AS data, tipo, pessoa, categoria, forma, descricao, valor, recorrente_id FROM fin_despesas WHERE data BETWEEN $1 AND $2 ORDER BY data, id`, [p.de, p.ate]);
      const cel = (v) => {
        const s = v == null ? '' : String(v);
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const linhas = ['Data;Tipo;Quem;Categoria;Forma;Descricao;Valor;Fixo mensal'];
      for (const d of r.rows) linhas.push([d.data, d.tipo, d.pessoa, d.categoria, d.forma, d.descricao, Number(d.valor).toFixed(2).replace('.', ','), d.recorrente_id ? 'sim' : ''].map(cel).join(';'));
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="lancamentos-${p.de}-a-${p.ate}.csv"`);
      res.send('﻿' + linhas.join('\r\n'));
    } catch (e) {
      falhou(res, e);
    }
  });
}

module.exports = { SOCIOS, rotas, divisao, gerarRecorrentes, porPessoa };
