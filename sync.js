'use strict';

/**
 * Copia os pedidos da Nerix para o banco. Na primeira vez (e de 6 em 6 horas)
 * le todas as paginas; no resto do tempo so as 3 primeiras, que sao as mais
 * recentes e as unicas que ainda mudam de status.
 *
 * O filtro payment_status da API e ignorado pela Nerix, por isso pago e
 * decidido aqui pelo proprio pedido.
 */

const banco = require('./banco');

const NERIX = 'https://api.nerix.com.br/api/public';
const CHAVE = (process.env.NERIX_KEY || '').trim();
const CATEGORIAS = { 1472: 'Nintendo', 1474: 'Steam', 4625: 'PlayStation' };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function nerix(rota) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(NERIX + rota, { headers: { 'X-nerixkey': CHAVE } });
    const t = await r.text();
    let j = null;
    try {
      j = JSON.parse(t);
    } catch (e) {}
    if (r.status === 429) {
      await espera(((j && j.retryAfter) || 20) * 1000 + 500);
      continue;
    }
    if ((r.status === 401 || r.status >= 500) && i < 4) {
      await espera(10000 * (i + 1));
      continue;
    }
    if (!r.ok) throw new Error('Nerix ' + r.status + ' em ' + rota.split('?')[0]);
    return j;
  }
  throw new Error('Nerix ocupada (429)');
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const data = (v) => (v ? new Date(v) : null);

function lerJson(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return {};
  }
}

function converter(o) {
  const pag = o.payment || {};
  const md = lerJson(pag.metadata);
  const fees = md.fees || {};
  const liq = md.card_settlement || md.wallet_card_settlement || {};
  const meta = lerJson(o.metadata);
  const pago = String(o.payment_status || '').toLowerCase() === 'paid';
  return {
    numero: o.order_number,
    nerix_id: o.id,
    criado_em: data(o.created_at),
    atualizado_em: data(o.updated_at),
    status: o.status || '',
    pagamento: o.payment_status || '',
    metodo: o.payment_method || '',
    pago,
    total: num(o.total) || 0,
    subtotal: num(o.subtotal) || 0,
    desconto: num(o.discount) || 0,
    cupom: o.coupon_id || null,
    afiliado: o.affiliate_code || null,
    liquido: pago ? num(fees.net_amount) : null,
    taxas: pago ? num(fees.total_fees) : null,
    taxa_gateway: pago ? num(fees.gateway_fee) : null,
    taxa_plataforma: pago ? num(fees.platform_fee) : null,
    parcelas: num(fees.installments || md.card_installments || meta.installments),
    creditado_em: data(md.credited_at),
    disponivel_em: data(liq.available_at),
    disponivel_valor: num(liq.available_amount),
    reserva_em: data(liq.reserve_at),
    reserva_valor: num(liq.reserve_amount),
    entregue_em: data(o.delivered_at),
    cancelado_em: data(o.cancelled_at),
    cliente: o.customer_name || '',
    email: o.customer_email || '',
    telefone: o.customer_phone || '',
    dispositivo: meta.device_type || '',
    itens: (o.items || []).map((i) => ({
      produto: i.product_id,
      variante: i.variant_id || null,
      nome: i.product_name,
      qtd: Number(i.quantity) || 1,
      preco: num(i.price) || 0,
      total: num(i.total) || 0,
    })),
  };
}

const COLUNAS = [
  'numero', 'nerix_id', 'criado_em', 'atualizado_em', 'status', 'pagamento', 'metodo', 'pago', 'total', 'subtotal', 'desconto',
  'cupom', 'afiliado', 'liquido', 'taxas', 'taxa_gateway', 'taxa_plataforma', 'parcelas', 'creditado_em', 'disponivel_em',
  'disponivel_valor', 'reserva_em', 'reserva_valor', 'entregue_em', 'cancelado_em', 'cliente', 'email', 'telefone', 'dispositivo', 'itens',
];

async function gravar(pedidos) {
  if (!pedidos.length) return;
  const valores = [];
  const linhas = pedidos.map((p, n) => {
    const base = n * COLUNAS.length;
    for (const c of COLUNAS) valores.push(c === 'itens' ? JSON.stringify(p.itens) : p[c]);
    return '(' + COLUNAS.map((_, i) => '$' + (base + i + 1)).join(',') + ', now())';
  });
  await banco.q(
    `INSERT INTO fin_pedidos (${COLUNAS.join(',')}, sincronizado_em) VALUES ${linhas.join(',')}
     ON CONFLICT (numero) DO UPDATE SET ${COLUNAS.filter((c) => c !== 'numero').map((c) => c + ' = EXCLUDED.' + c).join(', ')}, sincronizado_em = now()`,
    valores,
  );
}

async function sincronizarProdutos() {
  const j = await nerix('/products');
  const lista = Array.isArray(j) ? j : (j && j.data) || [];
  for (const p of lista) {
    const cat = CATEGORIAS[p.category_id] || 'Outros';
    await banco.q('INSERT INTO fin_produtos (id, nome, categoria, pai) VALUES ($1,$2,$3,NULL) ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria', [p.id, p.name, cat]);
    for (const v of p.variants || []) {
      await banco.q('INSERT INTO fin_produtos (id, nome, categoria, pai) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria, pai = EXCLUDED.pai', [v.id, p.name + ' · ' + v.name, cat, p.id]);
    }
  }
  return lista.length;
}

let rodando = null;
let status = { ultima: null, completa: null, pedidos: 0, erro: '' };

async function sincronizar(completo) {
  if (rodando) return rodando;
  rodando = (async () => {
    try {
      const ultimaCompleta = await banco.estado('ultima_completa');
      const fazerTudo = completo || !ultimaCompleta || Date.now() - Date.parse(ultimaCompleta) > 6 * 3600 * 1000;
      let pagina = 1;
      let totalPaginas = 1;
      let lidos = 0;
      do {
        const j = await nerix('/orders?limit=100&page=' + pagina);
        const lista = (j && j.data) || [];
        totalPaginas = (j && j.meta && j.meta.totalPages) || 1;
        await gravar(lista.filter((o) => o.order_number && o.created_at).map(converter));
        lidos += lista.length;
        pagina++;
        if (pagina <= totalPaginas) await espera(800);
      } while (pagina <= totalPaginas && (fazerTudo || pagina <= 3));
      if (fazerTudo) {
        await sincronizarProdutos().catch((e) => console.warn('[produtos]', e.message));
        await banco.gravarEstado('ultima_completa', new Date().toISOString());
      }
      status = { ultima: new Date().toISOString(), completa: fazerTudo ? new Date().toISOString() : ultimaCompleta, pedidos: lidos, erro: '' };
      console.log('[sync] ' + lidos + ' pedidos lidos' + (fazerTudo ? ' (completo)' : ''));
    } catch (e) {
      status.erro = e.message;
      console.warn('[sync]', e.message);
    } finally {
      rodando = null;
    }
  })();
  return rodando;
}

module.exports = { sincronizar, converter, situacao: () => status, configurado: () => !!CHAVE };
