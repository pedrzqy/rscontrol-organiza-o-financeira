'use strict';

/**
 * Banco do painel financeiro: o mesmo PostgreSQL do estoque, em tabelas com
 * prefixo fin_. Os pedidos sao uma copia dos da Nerix (a Nerix continua sendo
 * a fonte); despesas e registro so existem aqui.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PASTA_CERT = path.join(__dirname, 'certificados');
const URL_BANCO = (process.env.DATABASE_URL || '').trim();

function lerCert(arquivo, variavel) {
  const env = (process.env[variavel] || '').trim();
  if (env) return env.includes('-----BEGIN') ? env.replace(/\\n/g, '\n') : Buffer.from(env, 'base64').toString('utf8');
  try {
    return fs.readFileSync(path.join(PASTA_CERT, arquivo), 'utf8');
  } catch (e) {
    return '';
  }
}

let pool = null;
function conectar() {
  if (pool || !URL_BANCO) return pool;
  const host = new URL(URL_BANCO).hostname;
  const cert = lerCert('certificate.pem', 'DB_CERT');
  const key = lerCert('private-key.key', 'DB_KEY');
  const ca = lerCert('ca-certificate.crt', 'DB_CA');
  pool = new Pool({
    connectionString: URL_BANCO,
    ssl: cert && key ? { cert, key, ca: ca || undefined, servername: host, rejectUnauthorized: !!ca } : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (e) => console.warn('[banco]', e.message));
  return pool;
}

const configurado = () => !!URL_BANCO;
const q = (sql, params) => conectar().query(sql, params);

async function preparar() {
  await q(`
    CREATE TABLE IF NOT EXISTS fin_pedidos (
      numero TEXT PRIMARY KEY,
      nerix_id BIGINT,
      criado_em TIMESTAMPTZ NOT NULL,
      atualizado_em TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT '',
      pagamento TEXT NOT NULL DEFAULT '',
      metodo TEXT NOT NULL DEFAULT '',
      pago BOOLEAN NOT NULL DEFAULT false,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      desconto NUMERIC(12,2) NOT NULL DEFAULT 0,
      cupom BIGINT,
      afiliado TEXT,
      liquido NUMERIC(12,2),
      taxas NUMERIC(12,4),
      taxa_gateway NUMERIC(12,4),
      taxa_plataforma NUMERIC(12,4),
      parcelas INT,
      creditado_em TIMESTAMPTZ,
      disponivel_em TIMESTAMPTZ,
      disponivel_valor NUMERIC(12,2),
      reserva_em TIMESTAMPTZ,
      reserva_valor NUMERIC(12,2),
      entregue_em TIMESTAMPTZ,
      cancelado_em TIMESTAMPTZ,
      cliente TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      telefone TEXT NOT NULL DEFAULT '',
      dispositivo TEXT NOT NULL DEFAULT '',
      itens JSONB NOT NULL DEFAULT '[]',
      sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS fin_pedidos_criado ON fin_pedidos (criado_em DESC);
    CREATE INDEX IF NOT EXISTS fin_pedidos_pago ON fin_pedidos (pago, criado_em);
    CREATE INDEX IF NOT EXISTS fin_pedidos_email ON fin_pedidos (lower(email));
    CREATE TABLE IF NOT EXISTS fin_produtos (
      id BIGINT PRIMARY KEY,
      nome TEXT NOT NULL,
      categoria TEXT NOT NULL DEFAULT 'Outros',
      pai BIGINT
    );
    CREATE TABLE IF NOT EXISTS fin_despesas (
      id BIGSERIAL PRIMARY KEY,
      data DATE NOT NULL,
      categoria TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      valor NUMERIC(12,2) NOT NULL,
      criada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS fin_despesas_data ON fin_despesas (data);
    ALTER TABLE fin_despesas ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'despesa';
    ALTER TABLE fin_despesas ADD COLUMN IF NOT EXISTS pessoa TEXT NOT NULL DEFAULT '';
    ALTER TABLE fin_despesas ADD COLUMN IF NOT EXISTS forma TEXT NOT NULL DEFAULT '';
    ALTER TABLE fin_despesas ADD COLUMN IF NOT EXISTS recorrente_id BIGINT;
    ALTER TABLE fin_despesas ADD COLUMN IF NOT EXISTS mes TEXT;
    ALTER TABLE fin_despesas ADD COLUMN IF NOT EXISTS atualizada_em TIMESTAMPTZ;
    CREATE UNIQUE INDEX IF NOT EXISTS fin_despesas_recorrente_mes ON fin_despesas (recorrente_id, mes) WHERE recorrente_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS fin_recorrentes (
      id BIGSERIAL PRIMARY KEY,
      tipo TEXT NOT NULL DEFAULT 'despesa',
      pessoa TEXT NOT NULL,
      categoria TEXT NOT NULL,
      forma TEXT NOT NULL DEFAULT '',
      descricao TEXT NOT NULL DEFAULT '',
      valor NUMERIC(12,2) NOT NULL,
      dia INT NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT true,
      desde TEXT NOT NULL,
      criada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS fin_estado (chave TEXT PRIMARY KEY, valor JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS fin_carteira (
      mes TEXT PRIMARY KEY,
      saques NUMERIC(12,2) NOT NULL DEFAULT 0,
      liberado NUMERIC(12,2) NOT NULL DEFAULT 0,
      pendente NUMERIC(12,2) NOT NULL DEFAULT 0,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS fin_registro (
      id BIGSERIAL PRIMARY KEY,
      em TIMESTAMPTZ NOT NULL DEFAULT now(),
      evento TEXT NOT NULL,
      dados JSONB NOT NULL DEFAULT '{}'
    );
  `);
}

function registrar(evento, dados) {
  if (!configurado()) return;
  q('INSERT INTO fin_registro (evento, dados) VALUES ($1, $2)', [evento, dados || {}]).catch((e) => console.warn('[registro]', e.message));
}

async function estado(chave) {
  const r = await q('SELECT valor FROM fin_estado WHERE chave = $1', [chave]);
  return r.rows[0] ? r.rows[0].valor : null;
}

async function gravarEstado(chave, valor) {
  await q('INSERT INTO fin_estado (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor', [chave, JSON.stringify(valor)]);
}

module.exports = { configurado, q, preparar, registrar, estado, gravarEstado };
