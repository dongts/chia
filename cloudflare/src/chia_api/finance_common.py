"""Small persistence operations shared by the financial endpoints."""
from decimal import Decimal
from fastapi import HTTPException
from chia_api.common import new_id, now
from chia_api.db import Command

CENT = Decimal('0.01')


def reject(detail, status=400):
    raise HTTPException(status, detail)


def positive(value, label='Amount'):
    if not value.is_finite() or value <= 0:
        reject(f'{label} must be greater than zero')


def guard(db, table, row, fields=None):
    """Abort the entire D1 batch if a record changed since authorization/read."""
    fields = fields or tuple(row)
    encoded = db.encode(table, {key: row[key] for key in fields})
    token = new_id()
    predicate = ' AND '.join(f'{key} IS ?' for key in encoded)
    return [
        Command(f'INSERT INTO _finance_assertions(token,ok) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM {table} WHERE {predicate}) THEN 1 ELSE 0 END', (token, *encoded.values())),
        Command('DELETE FROM _finance_assertions WHERE token = ?', (token,)),
    ]


def member_guard(db, member):
    return guard(db, 'group_members', member, ('id', 'group_id', 'user_id', 'is_active', 'role'))


async def record(db, table, group_id, identifier, label):
    row = await db.one(table, 'id = ? AND group_id = ?', (str(identifier), str(group_id)))
    if row is None:
        reject(f'{label} not found', 404)
    return row


async def active_members(db, group_id, identifiers):
    ids = {str(identifier) for identifier in identifiers}
    if not ids:
        return {}
    rows = []
    ordered_ids = sorted(ids)
    for start in range(0, len(ordered_ids), 90):
        chunk = ordered_ids[start:start + 90]
        placeholders = ','.join('?' for _ in chunk)
        rows += await db.rows('group_members', f'group_id = ? AND is_active = 1 AND id IN ({placeholders})', (str(group_id), *chunk))
    if len(rows) != len(ids):
        reject('Members must be active members of this group')
    return {row['id']: row for row in rows}


async def member_names(db, group_id):
    return {row['id']: row['display_name'] for row in await db.rows('group_members', 'group_id = ?', (str(group_id),))}


def transaction(db, fund_id, kind, amount, member_id, created_by, **extra):
    return db.insert('fund_transactions', dict(
        id=new_id(), fund_id=str(fund_id), type=kind, amount=amount,
        member_id=str(member_id), created_by=str(created_by), created_at=now(),
        expense_id=None, deduction_id=None, note=None,
    ) | extra)


def log_expense(db, expense, actor, action, changes):
    return db.insert('expense_logs', dict(id=new_id(), expense_id=expense['id'],
        group_id=expense['group_id'], actor_member_id=actor['id'], action=action,
        changes=changes or None, created_at=now()))


def snapshot(expense, splits, deductions):
    fields = ('description', 'amount', 'currency_code', 'exchange_rate',
              'converted_amount', 'date', 'paid_by', 'category_id', 'receipt_url')
    def jsonable(value):
        return None if value is None else str(value)
    result = {key: jsonable(expense.get(key)) for key in fields}
    result['splits'] = sorted([dict(member_id=str(s['group_member_id']),
        split_type=str(s['split_type']), value=str(s['value']),
        resolved_amount=str(s['resolved_amount'])) for s in splits], key=lambda x: x['member_id'])
    result['fund_deductions'] = sorted([dict(fund_id=str(d['fund_id']), amount=str(d['amount']))
        for d in deductions], key=lambda x: x['fund_id'])
    return result
