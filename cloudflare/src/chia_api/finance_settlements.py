import uuid
from decimal import Decimal, ROUND_DOWN
from fastapi import APIRouter, Depends, Query
from chia_api.common import Context, auth_context, get_group, require_member, new_id, now, notify_commands
from chia_api.finance_common import active_members, member_names, member_guard, guard, record, positive, reject
from chia_api.ledger import balances
from shared.balances import ZERO_DECIMAL_CURRENCIES
from shared.debt_simplifier import simplify_debts
from shared.schemas.settlement import (BalanceRead, DistributionCreate, SettlementCreate,
    SettlementRead, SettlementUpdate, SuggestedSettlement)

router = APIRouter(prefix='/api/v1/groups/{group_id}')


def _distribution_amounts(amount, count, mode, currency_code):
    if mode == 'per_recipient':
        return [amount] * count
    unit = Decimal('1') if currency_code.upper() in ZERO_DECIMAL_CURRENCIES else Decimal('0.01')
    base = (amount / count).quantize(unit, rounding=ROUND_DOWN)
    remainder = int((amount - base * count) / unit)
    return [base + (unit if index < remainder else Decimal('0')) for index in range(count)]


def settlement_read(row, names):
    return dict(row, from_member_name=names.get(row['from_member']),
        to_member_name=names.get(row['to_member']), type=row['type'] or 'settle_up')


@router.get('/balances', response_model=list[BalanceRead])
async def get_balances(group_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    await require_member(ctx, group_id)
    result = await balances(ctx.db, group_id)
    names = await member_names(ctx.db, group_id)
    return [dict(member_id=mid, member_name=names[mid], balance=amount.quantize(Decimal('0.01')))
        for mid, amount in result.items() if mid in names]


@router.get('/settlements/suggested', response_model=list[SuggestedSettlement])
async def suggested(group_id: uuid.UUID, ctx: Context = Depends(auth_context)):
    await require_member(ctx, group_id)
    result = await balances(ctx.db, group_id)
    names = await member_names(ctx.db, group_id)
    transfers = simplify_debts({key: value.quantize(Decimal('0.01')) for key, value in result.items()})
    return [dict(from_member=sender, from_member_name=names[sender], to_member=recipient,
        to_member_name=names[recipient], amount=amount) for sender, recipient, amount in transfers]


@router.post('/settlements', response_model=SettlementRead)
async def create_settlement(group_id: uuid.UUID, data: SettlementCreate, ctx: Context = Depends(auth_context)):
    current = await require_member(ctx, group_id)
    positive(data.amount)
    if data.from_member == data.to_member:
        reject('Sender and recipient must be different')
    members = await active_members(ctx.db, group_id, [data.from_member, data.to_member])
    row = dict(id=new_id(), group_id=str(group_id), from_member=str(data.from_member),
        to_member=str(data.to_member), amount=data.amount, description=data.description,
        type=data.type, created_by=current['id'], settled_at=now())
    commands = member_guard(ctx.db, current)
    for member in members.values():
        commands += member_guard(ctx.db, member)
    commands.append(ctx.db.insert('settlements', row))
    commands += await notify_commands(ctx.db, members.keys(), str(group_id), 'settlement_recorded',
        {'from': members[row['from_member']]['display_name'], 'to': members[row['to_member']]['display_name'], 'amount': str(data.amount)},
        exclude_user_id=ctx.user['id'])
    await ctx.db.batch(commands)
    return settlement_read(row, {key: m['display_name'] for key, m in members.items()})


@router.post('/distributions', response_model=list[SettlementRead])
async def create_distribution(group_id: uuid.UUID, data: DistributionCreate, ctx: Context = Depends(auth_context)):
    current = await require_member(ctx, group_id)
    group = await get_group(ctx.db, group_id)
    members = await active_members(ctx.db, group_id, [data.from_member, *data.recipient_ids])
    amounts = _distribution_amounts(data.amount, len(data.recipient_ids), data.amount_mode, group['currency_code'])
    if any(amount <= 0 for amount in amounts):
        reject('Amount is too small to distribute among the selected recipients')
    rows = [dict(id=new_id(), group_id=str(group_id), from_member=str(data.from_member),
        to_member=str(recipient), amount=amount, description=data.description, type='gift',
        created_by=current['id'], settled_at=now()) for recipient, amount in zip(data.recipient_ids, amounts, strict=True)]
    commands = member_guard(ctx.db, current)
    for member in members.values():
        commands += member_guard(ctx.db, member)
    commands += [ctx.db.insert('settlements', row) for row in rows]
    commands += await notify_commands(ctx.db, members.keys(), str(group_id), 'distribution_recorded',
        {'from': members[str(data.from_member)]['display_name'], 'recipient_count': len(data.recipient_ids), 'total': str(sum(amounts, Decimal('0')))},
        exclude_user_id=ctx.user['id'])
    await ctx.db.batch(commands)
    names = {key: member['display_name'] for key, member in members.items()}
    return [settlement_read(row, names) for row in rows]


@router.patch('/settlements/{settlement_id}', response_model=SettlementRead)
async def update_settlement(group_id: uuid.UUID, settlement_id: uuid.UUID, data: SettlementUpdate, ctx: Context = Depends(auth_context)):
    current = await require_member(ctx, group_id)
    row = await record(ctx.db, 'settlements', group_id, settlement_id, 'Settlement')
    changes = data.model_dump(exclude_none=True)
    changes = {key: str(value) if isinstance(value, uuid.UUID) else value for key, value in changes.items()}
    updated = row | changes
    positive(updated['amount'])
    if updated['from_member'] == updated['to_member']:
        reject('Sender and recipient must be different')
    members = await active_members(ctx.db, group_id, [
        row['from_member'], row['to_member'], updated['from_member'], updated['to_member'],
    ])
    commands = member_guard(ctx.db, current) + guard(ctx.db, 'settlements', row)
    for member in members.values():
        commands += member_guard(ctx.db, member)
    if changes:
        commands.append(ctx.db.update('settlements', changes, 'id = ?', (str(settlement_id),)))
    await ctx.db.batch(commands)
    return settlement_read(updated, await member_names(ctx.db, group_id))


@router.get('/settlements', response_model=list[SettlementRead])
async def list_settlements(group_id: uuid.UUID, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), ctx: Context = Depends(auth_context)):
    await require_member(ctx, group_id)
    rows = await ctx.db.rows('settlements', 'group_id = ?', (str(group_id),), f'settled_at DESC, id DESC LIMIT {limit} OFFSET {offset}')
    names = await member_names(ctx.db, group_id)
    return [settlement_read(row, names) for row in rows]
