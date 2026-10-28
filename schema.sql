CREATE TABLE IF NOT EXISTS trades(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT, ticker TEXT, strategy TEXT, mc TEXT, exit_mc TEXT, price TEXT,
  entry_time TEXT, sl TEXT, tp TEXT, rrr TEXT, pnl TEXT, exit_time TEXT,
  review TEXT, tags TEXT, notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(date);

-- PIN login attempt tracking 
CREATE TABLE IF NOT EXISTS login_attempts(ip TEXT, ts INTEGER);

