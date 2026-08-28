PRAGMA foreign_keys = ON;

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pricing (
  code TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  updated_at TEXT NOT NULL
);

INSERT INTO pricing (code, amount_cents, updated_at) VALUES
  ('STARTER', 2900, datetime('now')),
  ('ESSENTIAL', 4900, datetime('now')),
  ('BUSINESS', 6900, datetime('now')),
  ('CUSTOM', 8900, datetime('now')),
  ('LOGO', 200, datetime('now'));

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  tracking_token TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES clients(id),
  package_code TEXT NOT NULL,
  pages INTEGER NOT NULL CHECK(pages > 0),
  features_json TEXT NOT NULL,
  website_information_json TEXT NOT NULL,
  deadline TEXT NOT NULL,
  logo_addon INTEGER NOT NULL DEFAULT 0,
  package_price_snapshot_cents INTEGER NOT NULL,
  addon_price_snapshot_cents INTEGER NOT NULL,
  total_price_snapshot_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','approved','in_progress','almost_done','delivered')),
  admin_notes TEXT NOT NULL DEFAULT '',
  notification_state TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE order_status_history (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_orders_client ON orders(client_id);
CREATE INDEX idx_orders_tracking ON orders(tracking_token);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
