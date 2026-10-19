import uuid
from decimal import ROUND_HALF_UP, Decimal
from fastapi import APIRouter, Depends, Query, UploadFile
from chia_api.common import (Context, auth_context, get_group, require_member, require_role,
    new_id, now, notify_commands, upload_file)
from chia_api.finance_common import (CENT, active_members, member_names, member_guard, guard,
    record, transaction, log_expense, snapshot, positive, reject)
from chia_api.ledger import fund_balance
from shared.schemas.expense import ExpenseCreate, ExpenseUpdate, ExpenseRead, ExpenseLogRead
from shared.split_calculator import calculate_splits

router = APIRouter(prefix='/api/v1/groups/{group_id}/expenses')


async def expense_reads(db, expenses, currency):
    if not expenses:
        return []
    group_id = expenses[0]['group_id']
    names = await member_names(db, group_id)
    funds = {fund['id']: fund['name'] for fund in await db.rows('funds', 'group_id = ?', (group_id,))}
    splits_by_expense = {expense['id']: [] for expense in expenses}
    deductions_by_expense = {expense['id']: [] for expense in expenses}
    identifiers = list(splits_by_expense)
    for start in range(0, len(identifiers), 90):
        chunk = identifiers[start:start + 90]
        where = 'expense_id IN (' + ','.join('?' for _ in chunk) + ')'
        for split in await db.rows('expense_splits', where, tuple(chunk)):
            splits_by_expense[split['expense_id']].append(dict(split, member_name=names.get(split['group_member_id'])))
        for deduction in await db.rows('expense_fund_deductions', where, tuple(chunk)):
            deductions_by_expense[deduction['expense_id']].append(dict(deduction, fund_name=funds.get(deduction['fund_id'], 'Unknown')))
    return [dict(expense, group_currency=currency, payer_name=names.get(expense['paid_by']),
        splits=splits_by_expense[expense['id']], fund_deductions=deductions_by_expense[expense['id']])
        for expense in expenses]


async def expense_read(db, expense, currency):
    return (await expense_reads(db, [expense], currency))[0]


async def validate_category(db, group_id, category_id):
    category = await db.one('categories', 'id = ? AND (group_id IS NULL OR group_id = ?)', (str(category_id), str(group_id)))
    if not category:
        reject('Category not found in this group')


async def currency_rate(db, group, currency, requested_rate=None):
    currency = (currency or group['currency_code']).upper().strip()
    if currency == group['currency_code']:
        return currency, Decimal('1')
    allowed = await db.one('group_currencies', 'group_id = ? AND currency_code = ?', (group['id'], currency))
    if not allowed:
        reject(f'{currency} is not an allowed currency for this group. Add it in group settings first.')
    rate = requested_rate if requested_rate is not None else allowed['exchange_rate']
    positive(rate, 'Exchange rate')
    return currency, rate


def stored_value(value):
    # expense_splits.value is NUMERIC(12,4); Postgres rounded e.g. the client's 1/3 silently.
    return value.quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)


def resolve(amount, split_type, splits):
    if not splits:
        reject('At least one split is required')
    ids = [str(split['group_member_id']) for split in splits]
    if len(set(ids)) != len(ids):
        reject('Duplicate member in splits')
    if amount < 0:
        reject('Total fund deductions exceed expense amount')
    if any(not split['value'].is_finite() or split['value'] < 0 for split in splits):
        reject('Split values must be nonnegative')
    if amount == 0:
        return {member: Decimal('0') for member in ids}
    try:
        return calculate_splits(amount, split_type, {str(split['group_member_id']): split['value'] for split in splits})
    except (ValueError, ArithmeticError) as exc:
        reject(str(exc))


async def validate_deductions(db, group_id, deductions, converted, previous=()):
    seen = set()
    old = {d['fund_id']: d['amount'] for d in previous}
    guards = []
    total = Decimal('0')
    for deduction in deductions:
        fid = str(deduction['fund_id'])
        if fid in seen:
            reject('Duplicate fund in deductions')
        seen.add(fid)
        positive(deduction['amount'], 'Fund deduction amount')
        fund = await db.one('funds', 'id = ? AND group_id = ? AND is_active = 1', (fid, str(group_id)))
        if not fund:
            reject(f'Fund {fid} not found or inactive')
        available = await fund_balance(db, fid) + old.get(fid, Decimal('0'))
        if deduction['amount'] > available:
            reject(f"Fund '{fund['name']}' has insufficient balance ({available} available, {deduction['amount']} requested)")
        guards += guard(db, 'funds', fund, ('id', 'group_id', 'is_active'))
        total += deduction['amount']
    if total > converted:
        reject(f'Total fund deductions ({total}) exceed expense amount ({converted})')
    return total, guards


def deduction_commands(db, expense, current, desired, previous=()):
    """Preserve retained deduction IDs; remove debits before replacements."""
    commands = []
    old = {d['fund_id']: d for d in previous}
    requested = {str(d['fund_id']) for d in desired}
    for fid, deduction in old.items():
        if fid not in requested:
            commands.append(db.delete('fund_transactions', 'deduction_id = ?', (deduction['id'],)))
            commands.append(db.delete('expense_fund_deductions', 'id = ?', (deduction['id'],)))
    rows = []
    # Reductions precede increases, so an atomic reassignment never temporarily overspends.
    ordered = sorted(desired, key=lambda d: d['amount'] - old.get(str(d['fund_id']), {}).get('amount', Decimal('0')))
    for supplied in ordered:
        fid = str(supplied['fund_id'])
        amount = supplied['amount']
        if fid in old:
            deduction = old[fid] | {'amount': amount}
            commands.append(db.update('expense_fund_deductions', {'amount': amount}, 'id = ?', (deduction['id'],)))
            commands.append(db.update('fund_transactions', {'amount': amount, 'member_id': expense['paid_by'], 'note': expense['description']}, 'deduction_id = ?', (deduction['id'],)))
        else:
            deduction = dict(id=new_id(), expense_id=expense['id'], fund_id=fid,
                amount=amount, created_by=current['id'], created_at=now())
            commands.append(db.insert('expense_fund_deductions', deduction))
            commands.append(transaction(db, fid, 'expense', amount, expense['paid_by'], current['id'],
                expense_id=expense['id'], deduction_id=deduction['id'], note=expense['description']))
        rows.append(deduction)
    return commands, rows


@router.post('', response_model=ExpenseRead)
async def create_expense(group_id: uuid.UUID, data: ExpenseCreate, ctx: Context = Depends(auth_context)):
    group = await get_group(ctx.db, group_id)
    current = await require_member(ctx, group_id)
    if str(data.paid_by) != current['id'] and current['role'] == 'member' and not group['allow_log_on_behalf']:
        reject('This group does not allow logging expenses on behalf of others', 403)
    positive(data.amount)
    await validate_category(ctx.db, group_id, data.category_id)
    members = await active_members(ctx.db, group_id, [data.paid_by, *(s.group_member_id for s in data.splits)])
    currency, rate = await currency_rate(ctx.db, group, data.currency_code, data.exchange_rate)
    converted = (data.amount * rate).quantize(CENT)
    desired = [d.model_dump() for d in data.fund_deductions]
    total, fund_guards = await validate_deductions(ctx.db, group_id, desired, converted)
    inputs = [s.model_dump() for s in data.splits]
    resolved = resolve(converted - total, data.split_type.value, inputs)
    timestamp = now()
    expense = dict(id=new_id(), group_id=str(group_id), paid_by=str(data.paid_by),
        created_by=current['id'], description=data.description, amount=data.amount,
        currency_code=currency, exchange_rate=rate, converted_amount=converted,
        category_id=str(data.category_id), date=data.date, receipt_url=None,
        created_at=timestamp, updated_at=timestamp)
    commands = member_guard(ctx.db, current) + guard(ctx.db, 'groups', group, ('id', 'is_deleted', 'allow_log_on_behalf', 'currency_code')) + fund_guards
    for member in members.values():
        commands += member_guard(ctx.db, member)
    commands.append(ctx.db.insert('expenses', expense))
    deductions, _ = deduction_commands(ctx.db, expense, current, desired)
    commands += deductions
    for split in inputs:
        commands.append(ctx.db.insert('expense_splits', dict(id=new_id(), expense_id=expense['id'],
            group_member_id=str(split['group_member_id']), split_type=data.split_type.value,
            value=stored_value(split['value']), resolved_amount=resolved[str(split['group_member_id'])])))
    commands.append(log_expense(ctx.db, expense, current, 'created', dict(description=data.description,
        amount=str(data.amount), currency_code=currency, paid_by=str(data.paid_by))))
    commands += await notify_commands(ctx.db, members.keys(), str(group_id), 'expense_added',
        dict(description=data.description, amount=str(data.amount), payer=current['display_name']), exclude_user_id=ctx.user['id'])
    await ctx.db.batch(commands)
    return await expense_read(ctx.db, expense, group['currency_code'])


@router.get('', response_model=list[ExpenseRead])
async def list_expenses(group_id: uuid.UUID, category_id: uuid.UUID | None = Query(None), member_id: uuid.UUID | None = Query(None), limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), ctx: Context = Depends(auth_context)):
    group = await get_group(ctx.db, group_id)
    await require_member(ctx, group_id)
    where, params = 'group_id = ?', [str(group_id)]
    for field, value in [('category_id', category_id), ('paid_by', member_id)]:
        if value is not None:
            where += f' AND {field} = ?'
            params.append(str(value))
    expenses = await ctx.db.rows('expenses', where, tuple(params), f'date DESC, created_at DESC, id DESC LIMIT {limit} OFFSET {offset}')
    return await expense_reads(ctx.db, expenses, group['currency_code'])


@router.get('/{expense_id}', response_model=ExpenseRead)
async def get_expense(group_id: uuid.UUID, expense_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    group = await get_group(ctx.db, group_id)
    await require_member(ctx, group_id)
    expense = await record(ctx.db, 'expenses', group_id, expense_id, 'Expense')
    return await expense_read(ctx.db, expense, group['currency_code'])


@router.get('/{expense_id}/logs', response_model=list[ExpenseLogRead])
async def list_expense_logs(group_id: uuid.UUID, expense_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    await require_member(ctx, group_id)
    await record(ctx.db, 'expenses', group_id, expense_id, 'Expense')
    logs = await ctx.db.rows('expense_logs', 'expense_id = ?', (str(expense_id),), 'created_at ASC')
    names = await member_names(ctx.db, group_id)
    return [dict(log, actor_name=names.get(log['actor_member_id'])) for log in logs]


@router.patch('/{expense_id}', response_model=ExpenseRead)
async def update_expense(group_id: uuid.UUID, expense_id: uuid.UUID, data: ExpenseUpdate, ctx: Context = Depends(auth_context)):
    group = await get_group(ctx.db, group_id)
    current = await require_member(ctx, group_id)
    previous = await record(ctx.db, 'expenses', group_id, expense_id, 'Expense')
    old_splits = await ctx.db.rows('expense_splits', 'expense_id = ?', (str(expense_id),))
    old_deductions = await ctx.db.rows('expense_fund_deductions', 'expense_id = ?', (str(expense_id),))
    before = snapshot(previous, old_splits, old_deductions)
    changes = data.model_dump(exclude_none=True, exclude={'fund_deductions', 'splits', 'split_type'})
    for key in ('paid_by', 'category_id'):
        if key in changes:
            changes[key] = str(changes[key])
    expense = previous | changes
    positive(expense['amount'])
    if data.category_id is not None:
        await validate_category(ctx.db, group_id, data.category_id)
    money_changed = any(value is not None for value in (data.amount, data.exchange_rate, data.currency_code))
    if money_changed:
        # Preserve a saved rate when changing only the amount; newly chosen currencies use their configured rate.
        requested_rate = data.exchange_rate
        if requested_rate is None and (data.currency_code is None or data.currency_code.upper().strip() == previous['currency_code']):
            requested_rate = previous['exchange_rate']
        currency, rate = await currency_rate(ctx.db, group, expense['currency_code'], requested_rate)
        changes.update(currency_code=currency, exchange_rate=rate,
            converted_amount=(expense['amount'] * rate).quantize(CENT))
        expense.update(changes)
    commands = member_guard(ctx.db, current) + guard(ctx.db, 'expenses', previous)
    commands += guard(ctx.db, 'groups', group, ('id', 'is_deleted', 'currency_code'))
    if data.paid_by is not None:
        members = await active_members(ctx.db, group_id, [data.paid_by])
        commands += member_guard(ctx.db, members[str(data.paid_by)])
    desired = [d.model_dump() for d in data.fund_deductions] if data.fund_deductions is not None else old_deductions
    total = sum((d['amount'] for d in desired), Decimal('0'))
    new_deductions = old_deductions
    if data.fund_deductions is not None:
        total, fund_guards = await validate_deductions(ctx.db, group_id, desired, expense['converted_amount'], old_deductions)
        commands += fund_guards
        deduction_writes, new_deductions = deduction_commands(ctx.db, expense, current, desired, old_deductions)
        commands += deduction_writes
    if total > expense['converted_amount']:
        reject('Total fund deductions exceed expense amount')
    split_changed = data.splits is not None and data.split_type is not None
    new_splits = old_splits
    if (data.splits is None) != (data.split_type is None):
        reject('Provide both splits and split_type when changing splits')
    if money_changed or split_changed or data.fund_deductions is not None or data.paid_by is not None:
        # A member can only leave with a zero ledger. Rewriting an old expense
        # must not recreate debt on an inactive member, including when that
        # member leaves between our reads and the atomic write.
        affected = {previous['paid_by'], expense['paid_by'], *(s['group_member_id'] for s in old_splits)}
        participants = await active_members(ctx.db, group_id, affected)
        for participant in participants.values():
            commands += member_guard(ctx.db, participant)
    if split_changed:
        inputs = [s.model_dump() for s in data.splits]
        members = await active_members(ctx.db, group_id, [s['group_member_id'] for s in inputs])
        for member in members.values():
            commands += member_guard(ctx.db, member)
        resolved = resolve(expense['converted_amount'] - total, data.split_type.value, inputs)
        commands.append(ctx.db.delete('expense_splits', 'expense_id = ?', (str(expense_id),)))
        new_splits = [dict(id=new_id(), expense_id=str(expense_id), group_member_id=str(s['group_member_id']),
            split_type=data.split_type.value, value=stored_value(s['value']), resolved_amount=resolved[str(s['group_member_id'])]) for s in inputs]
        commands += [ctx.db.insert('expense_splits', split) for split in new_splits]
    elif (money_changed or data.fund_deductions is not None) and old_splits:
        resolved = resolve(expense['converted_amount'] - total, old_splits[0]['split_type'], old_splits)
        new_splits = [split | {'resolved_amount': resolved[split['group_member_id']]} for split in old_splits]
        commands += [ctx.db.update('expense_splits', {'resolved_amount': split['resolved_amount']}, 'id = ?', (split['id'],)) for split in new_splits]
    changes['updated_at'] = now()
    expense.update(changes)
    commands.append(ctx.db.update('expenses', changes, 'id = ?', (str(expense_id),)))
    after = snapshot(expense, new_splits, new_deductions)
    difference = {key: {'from': before.get(key), 'to': after.get(key)} for key in before.keys() | after.keys() if before.get(key) != after.get(key)}
    if difference:
        commands.append(log_expense(ctx.db, expense, current, 'updated', difference))
    involved = {expense['paid_by'], *(s['group_member_id'] for s in new_splits)}
    commands += await notify_commands(ctx.db, involved, str(group_id), 'expense_updated',
        dict(description=expense['description'], amount=str(expense['amount']), editor=current['display_name']), exclude_user_id=ctx.user['id'])
    await ctx.db.batch(commands)
    return await expense_read(ctx.db, expense, group['currency_code'])


@router.delete('/{expense_id}')
async def delete_expense(group_id: uuid.UUID, expense_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    current = await require_member(ctx, group_id)
    expense = await record(ctx.db, 'expenses', group_id, expense_id, 'Expense')
    if expense['created_by'] != current['id']:
        require_role(current, 'owner', 'admin')
    splits = await ctx.db.rows('expense_splits', 'expense_id = ?', (str(expense_id),))
    involved = {expense['paid_by'], *(s['group_member_id'] for s in splits)}
    participants = await active_members(ctx.db, group_id, involved)
    commands = member_guard(ctx.db, current) + guard(ctx.db, 'expenses', expense)
    for participant in participants.values():
        commands += member_guard(ctx.db, participant)
    commands += await notify_commands(ctx.db, involved, str(group_id), 'expense_deleted',
        dict(description=expense['description'], amount=str(expense['amount'])), exclude_user_id=ctx.user['id'])
    commands += [ctx.db.delete('fund_transactions', 'expense_id = ?', (str(expense_id),)),
        ctx.db.delete('expenses', 'id = ?', (str(expense_id),))]
    await ctx.db.batch(commands)
    return {'detail': 'Expense deleted'}


async def change_receipt(ctx, group_id, expense_id, file=None):
    group = await get_group(ctx.db, group_id)
    current = await require_member(ctx, group_id)
    expense = await record(ctx.db, 'expenses', group_id, expense_id, 'Expense')
    if expense['created_by'] != current['id']:
        require_role(current, 'owner', 'admin')
    url = await upload_file(ctx, file) if file is not None else None
    changes = dict(receipt_url=url, updated_at=now())
    commands = member_guard(ctx.db, current) + guard(ctx.db, 'expenses', expense)
    commands += [ctx.db.update('expenses', changes, 'id = ?', (str(expense_id),)),
        log_expense(ctx.db, expense, current, 'receipt_uploaded' if file else 'receipt_deleted',
            {'receipt_url': {'from': expense['receipt_url'], 'to': url}})]
    await ctx.db.batch(commands)
    return await expense_read(ctx.db, expense | changes, group['currency_code'])


@router.post('/{expense_id}/receipt', response_model=ExpenseRead)
async def upload_receipt(group_id: uuid.UUID, expense_id: uuid.UUID, file: UploadFile, ctx: Context = Depends(auth_context)):
    return await change_receipt(ctx, group_id, expense_id, file)


@router.delete('/{expense_id}/receipt', response_model=ExpenseRead)
async def delete_receipt(group_id: uuid.UUID, expense_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    return await change_receipt(ctx, group_id, expense_id)
