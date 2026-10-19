"""D1 loaders for the shared, authoritative Decimal ledger."""
from decimal import Decimal
from chia_api.db import Command
from shared.balances import calculate_balances


async def dashboard_balances(db, user_id):
    """Read every accessible group and ledger in one fixed-size D1 snapshot."""
    accessible = '''SELECT g.id FROM groups g
        JOIN group_members mine ON mine.group_id = g.id
        WHERE mine.user_id = ? AND mine.is_active = 1 AND g.is_deleted = 0'''
    groups_sql = '''SELECT g.*, COUNT(active.id) AS member_count, mine.id AS my_member_id
        FROM groups g
        JOIN group_members mine ON mine.group_id = g.id
          AND mine.user_id = ? AND mine.is_active = 1
        JOIN group_members active ON active.group_id = g.id AND active.is_active = 1
        WHERE g.is_deleted = 0
        GROUP BY g.id, mine.id
        ORDER BY g.created_at'''
    specifications = [
        ('group_members', f'SELECT * FROM group_members WHERE group_id IN ({accessible})'),
        ('expenses', f'SELECT * FROM expenses WHERE group_id IN ({accessible})'),
        ('expense_splits', f'''SELECT s.*, e.group_id FROM expense_splits s
            JOIN expenses e ON e.id = s.expense_id WHERE e.group_id IN ({accessible})'''),
        ('expense_fund_deductions', f'''SELECT d.*, e.group_id FROM expense_fund_deductions d
            JOIN expenses e ON e.id = d.expense_id WHERE e.group_id IN ({accessible})'''),
        ('settlements', f'SELECT * FROM settlements WHERE group_id IN ({accessible})'),
    ]
    results = await db.batch([
        Command(sql, (str(user_id),))
        for sql in [groups_sql, *(sql for _, sql in specifications)]
    ])
    rows = results[0]['results']
    datasets = {row['id']: [[] for _ in specifications] for row in rows}
    for index, ((table, _), result) in enumerate(zip(specifications, results[1:], strict=True)):
        for raw in result['results']:
            row = db.decode(table, raw)
            datasets[row['group_id']][index].append(row)
    return rows, {group_id: calculate_balances(*data) for group_id, data in datasets.items()}


async def balances(db, group_id):
    specifications = [
        ('group_members', 'SELECT * FROM group_members WHERE group_id = ?'),
        ('expenses', 'SELECT * FROM expenses WHERE group_id = ?'),
        ('expense_splits', 'SELECT s.* FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = ?'),
        ('expense_fund_deductions', 'SELECT d.* FROM expense_fund_deductions d JOIN expenses e ON e.id = d.expense_id WHERE e.group_id = ?'),
        ('settlements', 'SELECT * FROM settlements WHERE group_id = ?'),
    ]
    results = await db.batch([Command(sql, (str(group_id),)) for _, sql in specifications])
    datasets = [[db.decode(table, row) for row in result['results']]
                for (table, _), result in zip(specifications, results, strict=True)]
    return calculate_balances(*datasets)


async def fund_balance(db, fund_id):
    # TEXT prevents a large integer aggregate losing precision at the JS boundary.
    value = await db.scalar('''SELECT CAST(COALESCE(SUM(CASE
        WHEN type = 'contribute' THEN amount
        WHEN type IN ('withdraw', 'expense') THEN -amount ELSE 0 END), 0) AS TEXT)
        FROM fund_transactions WHERE fund_id = ?''', (str(fund_id),))
    return Decimal(value or '0') / 100
