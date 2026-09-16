-- HustleKit schema — run against the shared mehyar_leads_prod D1 database (where billing_products/billing_payments live).
-- D1 enforces foreign keys: these tables reference nothing and nothing
-- references them, so plain CREATE TABLE IF NOT EXISTS is safe.

CREATE TABLE IF NOT EXISTS hustlekit_orders (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER UNIQUE NOT NULL,
  product_id TEXT NOT NULL,
  email TEXT NOT NULL,
  inputs_json TEXT,
  status TEXT NOT NULL DEFAULT 'paid',
  access_token TEXT UNIQUE NOT NULL,
  output_json TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ready_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_hustlekit_orders_token ON hustlekit_orders(access_token);

CREATE TABLE IF NOT EXISTS hustlekit_teasers (
  ip TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (ip, day)
);
