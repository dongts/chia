import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, Query
from chia_api.common import Context, auth_context, require_member, require_role, new_id, now
from chia_api.finance_common import active_members, member_names, member_guard, guard, record, transaction, positive, reject
from shared.schemas.fund import (FundCreate, FundDetailRead, FundRead, FundTransactionCreate,
    FundTransactionRead, FundUpdate)

router = APIRouter(prefix='/api/v1/groups/{group_id}/funds')


async def fund_reads(db, funds):
    if not funds:
        return []
    names = await member_names(db, funds[0]['group_id'])
    totals = {}
    identifiers = [fund['id'] for fund in funds]
    for start in range(0, len(identifiers), 90):
        chunk = identifiers[start:start + 90]
        placeholders = ','.join('?' for _ in chunk)
        rows = await db.all("SELECT fund_id,COUNT(*) AS transaction_count,"
            " CAST(COALESCE(SUM(CASE WHEN type = 'contribute' THEN amount "
            "WHEN type IN ('withdraw', 'expense') THEN -amount ELSE 0 END),0) AS TEXT) AS balance"
            f" FROM fund_transactions WHERE fund_id IN ({placeholders}) GROUP BY fund_id", tuple(chunk))
        totals.update({row['fund_id']: row for row in rows})
    return [dict(fund, holder_name=names.get(fund['holder_id']),
        balance=Decimal(totals.get(fund['id'], {}).get('balance', '0')) / 100,
        transaction_count=totals.get(fund['id'], {}).get('transaction_count', 0)) for fund in funds]


async def fund_read(db, fund):
    return (await fund_reads(db, [fund]))[0]


def transaction_read(tx, names):
    return dict(tx, member_name=names.get(tx['member_id']), created_by_name=names.get(tx['created_by']))


@router.post('', response_model=FundRead)
async def create_fund(group_id: uuid.UUID, data: FundCreate, ctx: Context = Depends(auth_context)):
    current = await require_member(ctx, group_id)
    holder_id = str(data.holder_id or current['id'])
    members = await active_members(ctx.db, group_id, [holder_id])
    timestamp = now()
    fund = dict(id=new_id(), group_id=str(group_id), name=data.name, description=data.description,
        holder_id=holder_id, created_by=current['id'], is_active=True, created_at=timestamp, updated_at=timestamp)
    commands = member_guard(ctx.db, current) + member_guard(ctx.db, members[holder_id])
    commands.append(ctx.db.insert('funds', fund))
    await ctx.db.batch(commands)
    return await fund_read(ctx.db, fund)


@router.get('', response_model=list[FundRead])
async def list_funds(group_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    await require_member(ctx, group_id)
    funds = await ctx.db.rows('funds', 'group_id = ?', (str(group_id),), 'is_active DESC, created_at DESC')
    return await fund_reads(ctx.db, funds)


@router.get('/{fund_id}', response_model=FundDetailRead)
async def get_fund(group_id: uuid.UUID, fund_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    await require_member(ctx, group_id)
    fund = await record(ctx.db, 'funds', group_id, fund_id, 'Fund')
    contributions = await ctx.db.all("SELECT member_id, CAST(SUM(amount) AS TEXT) AS total FROM fund_transactions WHERE fund_id = ? AND type = 'contribute' GROUP BY member_id", (str(fund_id),))
    names = await member_names(ctx.db, group_id)
    result = await fund_read(ctx.db, fund)
    result['contributions_by_member'] = [dict(member_id=row['member_id'], member_name=names.get(row['member_id'], 'Unknown'), total=Decimal(row['total']) / 100) for row in contributions]
    return result


@router.patch('/{fund_id}', response_model=FundRead)
async def update_fund(group_id: uuid.UUID, fund_id: uuid.UUID, data: FundUpdate, ctx: Context = Depends(auth_context)):
    current = await require_member(ctx, group_id)
    fund = await record(ctx.db, 'funds', group_id, fund_id, 'Fund')
    changes = data.model_dump(exclude_none=True)
    commands = member_guard(ctx.db, current) + guard(ctx.db, 'funds', fund)
    if data.holder_id is not None and str(data.holder_id) != fund['holder_id']:
        if current['role'] not in ('owner', 'admin') and current['id'] != fund['holder_id']:
            reject('Only admin/owner or current holder can change the fund holder', 403)
        members = await active_members(ctx.db, group_id, [data.holder_id])
        commands += member_guard(ctx.db, members[str(data.holder_id)])
        commands.append(transaction(ctx.db, fund_id, 'holder_change', Decimal('0'), data.holder_id,
            current['id'], note=f'Holder changed to {data.holder_id}'))
    if data.is_active is not None and data.is_active != fund['is_active']:
        require_role(current, 'admin', 'owner')
    if data.holder_id is not None:
        changes['holder_id'] = str(data.holder_id)
    changes['updated_at'] = now()
    commands.append(ctx.db.update('funds', changes, 'id = ?', (str(fund_id),)))
    await ctx.db.batch(commands)
    return await fund_read(ctx.db, fund | changes)


@router.delete('/{fund_id}', response_model=FundRead)
async def delete_fund(group_id: uuid.UUID, fund_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    current = await require_member(ctx, group_id)
    require_role(current, 'admin', 'owner')
    fund = await record(ctx.db, 'funds', group_id, fund_id, 'Fund')
    changes = dict(is_active=False, updated_at=now())
    await ctx.db.batch(member_guard(ctx.db, current) + guard(ctx.db, 'funds', fund) + [ctx.db.update('funds', changes, 'id = ?', (str(fund_id),))])
    return await fund_read(ctx.db, fund | changes)


@router.post('/{fund_id}/transactions', response_model=FundTransactionRead)
async def create_transaction(group_id: uuid.UUID, fund_id: uuid.UUID, data: FundTransactionCreate, ctx: Context = Depends(auth_context)):
    current = await require_member(ctx, group_id)
    fund = await record(ctx.db, 'funds', group_id, fund_id, 'Fund')
    if not fund['is_active']:
        reject('Cannot add transactions to a closed fund')
    kind = data.type.value
    if kind not in ('contribute', 'withdraw'):
        reject("Transaction type must be 'contribute' or 'withdraw'")
    positive(data.amount)
    members = await active_members(ctx.db, group_id, [data.member_id])
    row = dict(id=new_id(), fund_id=str(fund_id), type=kind, amount=data.amount,
        member_id=str(data.member_id), note=data.note, created_by=current['id'],
        created_at=now(), expense_id=None, deduction_id=None)
    commands = member_guard(ctx.db, current) + member_guard(ctx.db, members[str(data.member_id)])
    commands += guard(ctx.db, 'funds', fund, ('id', 'group_id', 'is_active'))
    commands.append(ctx.db.insert('fund_transactions', row))
    await ctx.db.batch(commands)
    return transaction_read(row, {current['id']: current['display_name'], str(data.member_id): members[str(data.member_id)]['display_name']})


@router.get('/{fund_id}/transactions', response_model=list[FundTransactionRead])
async def list_transactions(group_id: uuid.UUID, fund_id: uuid.UUID, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), ctx: Context = Depends(auth_context)):
    await require_member(ctx, group_id)
    await record(ctx.db, 'funds', group_id, fund_id, 'Fund')
    rows = await ctx.db.rows('fund_transactions', 'fund_id = ?', (str(fund_id),), f'created_at DESC, id DESC LIMIT {limit} OFFSET {offset}')
    names = await member_names(ctx.db, group_id)
    return [transaction_read(row, names) for row in rows]


@router.delete('/{fund_id}/transactions/{transaction_id}')
async def delete_transaction(group_id: uuid.UUID, fund_id: uuid.UUID, transaction_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    current = await require_member(ctx, group_id)
    await record(ctx.db, 'funds', group_id, fund_id, 'Fund')
    tx = await ctx.db.one('fund_transactions', 'id = ? AND fund_id = ?', (str(transaction_id), str(fund_id)))
    if not tx:
        reject('Transaction not found', 404)
    if tx['expense_id'] is not None:
        reject('Cannot delete expense-linked transactions')
    if tx['type'] == 'holder_change':
        reject('Cannot delete holder change transactions')
    if tx['created_by'] != current['id'] and current['role'] not in ('owner', 'admin'):
        reject('You can only delete your own transactions', 403)
    await ctx.db.batch(member_guard(ctx.db, current) + guard(ctx.db, 'fund_transactions', tx) + [ctx.db.delete('fund_transactions', 'id = ?', (str(transaction_id),))])
    return {'detail': 'Transaction deleted'}
