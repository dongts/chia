-- Used inside a single D1 batch to abort writes based on a stale snapshot.
CREATE TABLE IF NOT EXISTS _finance_assertions (
  token TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

CREATE TRIGGER IF NOT EXISTS finance_balance_after_insert
AFTER INSERT ON fund_transactions
WHEN NEW.type IN ('expense', 'withdraw')
BEGIN
  SELECT CASE WHEN (
    SELECT COALESCE(SUM(CASE WHEN type = 'contribute' THEN amount
      WHEN type IN ('expense', 'withdraw') THEN -amount ELSE 0 END), 0)
    FROM fund_transactions WHERE fund_id = NEW.fund_id
  ) < 0 THEN RAISE(ABORT, 'Insufficient fund balance') END;
END;

CREATE TRIGGER IF NOT EXISTS finance_balance_after_update
AFTER UPDATE OF amount, type, fund_id ON fund_transactions
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT fund_id FROM fund_transactions
    WHERE fund_id IN (OLD.fund_id, NEW.fund_id)
    GROUP BY fund_id
    HAVING SUM(CASE WHEN type = 'contribute' THEN amount
      WHEN type IN ('expense', 'withdraw') THEN -amount ELSE 0 END) < 0
  ) THEN RAISE(ABORT, 'Insufficient fund balance') END;
END;

CREATE TRIGGER IF NOT EXISTS finance_balance_after_delete
AFTER DELETE ON fund_transactions
WHEN OLD.type = 'contribute' AND EXISTS (SELECT 1 FROM funds WHERE id = OLD.fund_id)
BEGIN
  SELECT CASE WHEN (
    SELECT COALESCE(SUM(CASE WHEN type = 'contribute' THEN amount
      WHEN type IN ('expense', 'withdraw') THEN -amount ELSE 0 END), 0)
    FROM fund_transactions WHERE fund_id = OLD.fund_id
  ) < 0 THEN RAISE(ABORT, 'Insufficient fund balance') END;
END;
