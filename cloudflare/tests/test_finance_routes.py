"""Endpoint integration against SQLite, using the production Store codecs."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'cloudflare/src'))


def test_financial_routes_cover_existing_api():
    path = ROOT / 'cloudflare/src/chia_api/routes_finance.py'
    assert path.exists(), 'Financial D1 routes must exist'
    from chia_api.routes_finance import router
    operations = {(method, route.path) for route in router.routes for method in route.methods}
    required = {
        ('POST', '/api/v1/groups/{group_id}/expenses'),
        ('PATCH', '/api/v1/groups/{group_id}/expenses/{expense_id}'),
        ('DELETE', '/api/v1/groups/{group_id}/expenses/{expense_id}'),
        ('POST', '/api/v1/groups/{group_id}/expenses/{expense_id}/receipt'),
        ('GET', '/api/v1/groups/{group_id}/expenses/{expense_id}/logs'),
        ('POST', '/api/v1/groups/{group_id}/funds'),
        ('POST', '/api/v1/groups/{group_id}/funds/{fund_id}/transactions'),
        ('DELETE', '/api/v1/groups/{group_id}/funds/{fund_id}/transactions/{transaction_id}'),
        ('GET', '/api/v1/groups/{group_id}/balances'),
        ('POST', '/api/v1/groups/{group_id}/settlements'),
        ('POST', '/api/v1/groups/{group_id}/distributions'),
    }
    assert required <= operations

import sqlite3
import uuid
from decimal import Decimal
from types import SimpleNamespace
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chia_api.common import Context, auth_context
from chia_api.db import Store


class Statement:
    def __init__(self, binding, sql, params=()):
        self.binding, self.sql, self.params = binding, sql, params

    def bind(self, *params):
        return Statement(self.binding, self.sql, params)

    async def all(self):
        return self.binding.run(self)


class SQLiteBinding:
    """A real SQLite transaction implementing the same boundary as a D1 binding."""
    def __init__(self):
        self.connection = sqlite3.connect(':memory:', check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.before_batch = None
        self.statements_executed = 0
        self.connection.executescript((ROOT / 'cloudflare/migrations/0001_initial.sql').read_text())
        self.connection.executescript((ROOT / 'cloudflare/finance_triggers.sql').read_text())

    def prepare(self, sql):
        return Statement(self, sql)

    def run(self, statement):
        self.statements_executed += 1
        assert len(statement.params) <= 100, 'D1 supports at most 100 bound parameters per statement'
        cursor = self.connection.execute(statement.sql, statement.params)
        return {'results': [dict(row) for row in cursor.fetchall()] if cursor.description else [],
                'success': True, 'meta': {'changes': cursor.rowcount}}

    async def batch(self, statements):
        if self.before_batch is not None:
            callback, self.before_batch = self.before_batch, None
            callback(self.connection)
            self.connection.commit()
        with self.connection:
            return [self.run(statement) for statement in statements]


@pytest.fixture
def finance_api():
    from chia_api.routes_finance import router
    binding = SQLiteBinding()
    db = Store(binding)
    ids = {key: str(uuid.uuid4()) for key in ('group', 'category', 'a', 'b', 'c', 'user_a', 'user_b', 'user_c')}
    connection = binding.connection
    connection.execute('INSERT INTO groups(id,name,invite_code) VALUES (?,?,?)', (ids['group'], 'Trip', 'finance-test'))
    connection.execute('INSERT INTO categories(id,name) VALUES (?,?)', (ids['category'], 'Food'))
    for name in ('a', 'b', 'c'):
        connection.execute('INSERT INTO users(id,display_name) VALUES (?,?)', (ids['user_' + name], name.upper()))
        connection.execute('INSERT INTO group_members(id,group_id,user_id,display_name,role) VALUES (?,?,?,?,?)',
            (ids[name], ids['group'], ids['user_' + name], name.upper(), 'owner' if name == 'a' else 'member'))
    connection.commit()
    ctx = Context(db, {}, {'id': ids['user_a']})
    app = FastAPI()
    app.include_router(router)
    async def context():
        return ctx
    app.dependency_overrides[auth_context] = context
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, binding=binding, db=db, ids=ids, ctx=ctx, base=f"/api/v1/groups/{ids['group']}")


def create_fund(api, amount='100'):
    response = api.client.post(api.base + '/funds', json={'name': 'Travel kitty'})
    assert response.status_code == 200, response.text
    fund_id = response.json()['id']
    response = api.client.post(api.base + f'/funds/{fund_id}/transactions',
        json={'type': 'contribute', 'member_id': api.ids['a'], 'amount': amount})
    assert response.status_code == 200, response.text
    return fund_id, response.json()['id']


def expense_payload(api, amount='80', deductions=None):
    return {'description': 'Dinner', 'amount': amount, 'date': '2026-09-18',
        'paid_by': api.ids['a'], 'category_id': api.ids['category'],
        'split_type': 'equal', 'splits': [{'group_member_id': api.ids[m], 'value': '1'} for m in ('a', 'b')],
        'fund_deductions': deductions or []}


def current_balances(api):
    response = api.client.get(api.base + '/balances')
    assert response.status_code == 200, response.text
    return {row['member_id']: Decimal(row['balance']) for row in response.json()}


def test_expense_lifecycle_restores_fund_and_keeps_audit_notifications(finance_api):
    api = finance_api
    fid, _ = create_fund(api)
    response = api.client.post(api.base + '/expenses', json=expense_payload(api, deductions=[{'fund_id': fid, 'amount': '20'}]))
    assert response.status_code == 200, response.text
    eid = response.json()['id']
    deduction_id = response.json()['fund_deductions'][0]['id']
    assert [Decimal(s['resolved_amount']) for s in response.json()['splits']] == [Decimal('30'), Decimal('30')]
    assert current_balances(api)[api.ids['a']] == Decimal('30')
    response = api.client.patch(api.base + f'/expenses/{eid}', json={'amount': '100', 'fund_deductions': [{'fund_id': fid, 'amount': '40'}]})
    assert response.status_code == 200, response.text
    assert response.json()['fund_deductions'][0]['id'] == deduction_id
    assert Decimal(api.client.get(api.base + f'/funds/{fid}').json()['balance']) == Decimal('60')
    assert current_balances(api)[api.ids['b']] == Decimal('-30')
    response = api.client.patch(api.base + f'/expenses/{eid}', json={'fund_deductions': []})
    assert response.status_code == 200, response.text
    assert current_balances(api)[api.ids['a']] == Decimal('50')
    assert Decimal(api.client.get(api.base + f'/funds/{fid}').json()['balance']) == Decimal('100')
    logs = api.client.get(api.base + f'/expenses/{eid}/logs').json()
    assert [log['action'] for log in logs] == ['created', 'updated', 'updated']
    assert 'fund_deductions' in logs[-1]['changes']
    response = api.client.patch(api.base + f'/expenses/{eid}', json={'fund_deductions': [{'fund_id': fid, 'amount': '30'}]})
    assert response.status_code == 200, response.text
    assert api.client.delete(api.base + f'/expenses/{eid}').status_code == 200
    assert Decimal(api.client.get(api.base + f'/funds/{fid}').json()['balance']) == Decimal('100')
    assert all(amount == 0 for amount in current_balances(api).values())
    notification_types = [row[0] for row in api.binding.connection.execute('SELECT type FROM notifications ORDER BY created_at')]
    assert notification_types == ['expense_added', 'expense_updated', 'expense_updated', 'expense_updated', 'expense_deleted']


def test_gifts_repayments_distribution_update_and_suggestions(finance_api):
    api = finance_api
    response = api.client.post(api.base + '/distributions', json={
        'from_member': api.ids['a'], 'recipient_ids': [api.ids['b'], api.ids['c']],
        'amount': '10.01', 'amount_mode': 'total'})
    assert response.status_code == 200, response.text
    assert [Decimal(row['amount']) for row in response.json()] == [Decimal('5.01'), Decimal('5')]
    assert current_balances(api) == {api.ids['a']: Decimal('-10.01'), api.ids['b']: Decimal('5.01'), api.ids['c']: Decimal('5')}
    response = api.client.post(api.base + '/settlements', json={'from_member': api.ids['a'], 'to_member': api.ids['b'], 'amount': '5.01'})
    assert response.status_code == 200, response.text
    sid = response.json()['id']
    assert current_balances(api)[api.ids['b']] == 0
    response = api.client.patch(api.base + f'/settlements/{sid}', json={'amount': '4.01'})
    assert response.status_code == 200, response.text
    assert current_balances(api)[api.ids['b']] == 1
    suggestions = api.client.get(api.base + '/settlements/suggested').json()
    assert sum(Decimal(row['amount']) for row in suggestions) == Decimal('6')
    assert len(api.client.get(api.base + '/settlements?limit=2').json()) == 2


def test_competing_spend_rejects_and_rolls_back_expense_split_audit_notification(finance_api):
    api = finance_api
    fid, _ = create_fund(api)
    def competing_spend(connection):
        connection.execute('INSERT INTO fund_transactions(id,fund_id,type,amount,member_id,created_by) VALUES (?,?,?,?,?,?)',
            (str(uuid.uuid4()), fid, 'withdraw', 7000, api.ids['a'], api.ids['a']))
    api.binding.before_batch = competing_spend
    response = api.client.post(api.base + '/expenses', json=expense_payload(api, deductions=[{'fund_id': fid, 'amount': '80'}]))
    assert response.status_code == 409, response.text
    for table in ('expenses', 'expense_splits', 'expense_fund_deductions', 'expense_logs', 'notifications'):
        assert api.binding.connection.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0
    assert Decimal(api.client.get(api.base + f'/funds/{fid}').json()['balance']) == Decimal('30')


def test_stale_expense_edit_cannot_overwrite_newer_amount_or_splits(finance_api):
    api = finance_api
    response = api.client.post(api.base + '/expenses', json=expense_payload(api))
    eid = response.json()['id']
    def competing_edit(connection):
        connection.execute('UPDATE expenses SET description=?, updated_at=? WHERE id=?', ('Newer edit', '2026-09-18T12:00:01Z', eid))
    api.binding.before_batch = competing_edit
    response = api.client.patch(api.base + f'/expenses/{eid}', json={'amount': '90'})
    assert response.status_code == 409, response.text
    row = api.client.get(api.base + f'/expenses/{eid}').json()
    assert row['description'] == 'Newer edit'
    assert Decimal(row['amount']) == Decimal('80')
    assert [Decimal(split['resolved_amount']) for split in row['splits']] == [Decimal('40'), Decimal('40')]


def test_closed_fund_and_spent_contribution_cannot_be_removed(finance_api):
    api = finance_api
    fid, tid = create_fund(api)
    response = api.client.post(api.base + f'/funds/{fid}/transactions', json={'type': 'withdraw', 'amount': '80', 'member_id': api.ids['b']})
    assert response.status_code == 200, response.text
    assert api.client.delete(api.base + f'/funds/{fid}/transactions/{tid}').status_code == 409
    assert api.client.delete(api.base + f'/funds/{fid}').status_code == 200
    response = api.client.post(api.base + f'/funds/{fid}/transactions', json={'type': 'contribute', 'amount': '80', 'member_id': api.ids['b']})
    assert response.status_code == 400


def test_cross_group_payer_and_split_are_rejected(finance_api):
    api = finance_api
    payload = expense_payload(api)
    payload['paid_by'] = str(uuid.uuid4())
    response = api.client.post(api.base + '/expenses', json=payload)
    assert response.status_code == 400
    assert api.binding.connection.execute('SELECT COUNT(*) FROM expenses').fetchone()[0] == 0


def test_hundred_member_distribution_stays_within_d1_parameter_limit(finance_api):
    api = finance_api
    recipients = [api.ids['b'], api.ids['c']]
    for index in range(97):
        mid = str(uuid.uuid4())
        api.binding.connection.execute('INSERT INTO group_members(id,group_id,display_name,role) VALUES (?,?,?,?)',
            (mid, api.ids['group'], f'Guest {index}', 'member'))
        recipients.append(mid)
    api.binding.connection.commit()
    response = api.client.post(api.base + '/distributions', json={
        'from_member': api.ids['a'], 'recipient_ids': recipients, 'amount': '99', 'amount_mode': 'total'})
    assert response.status_code == 200, response.text
    assert len(response.json()) == 99
    assert sum(Decimal(row['amount']) for row in response.json()) == Decimal('99')


def test_expense_listing_does_not_exceed_d1_query_budget(finance_api):
    api = finance_api
    for _ in range(15):
        response = api.client.post(api.base + '/expenses', json=expense_payload(api))
        assert response.status_code == 200, response.text
    api.binding.statements_executed = 0
    response = api.client.get(api.base + '/expenses?limit=100')
    assert response.status_code == 200, response.text
    assert len(response.json()) == 15
    assert api.binding.statements_executed <= 50, 'List hydration must batch related rows to respect the D1 query budget'


def test_receipt_delete_audits_and_respects_creator_permission(finance_api):
    api = finance_api
    response = api.client.post(api.base + '/expenses', json=expense_payload(api))
    eid = response.json()['id']
    api.binding.connection.execute('UPDATE expenses SET receipt_url = ? WHERE id = ?', ('/uploads/receipt.jpg', eid))
    api.binding.connection.commit()
    api.ctx.user = {'id': api.ids['user_b']}
    assert api.client.delete(api.base + f'/expenses/{eid}/receipt').status_code == 403
    assert api.client.delete(api.base + f'/expenses/{eid}').status_code == 403
    api.ctx.user = {'id': api.ids['user_a']}
    response = api.client.delete(api.base + f'/expenses/{eid}/receipt')
    assert response.status_code == 200, response.text
    assert response.json()['receipt_url'] is None
    logs = api.client.get(api.base + f'/expenses/{eid}/logs').json()
    assert logs[-1]['changes']['receipt_url'] == {'from': '/uploads/receipt.jpg', 'to': None}


def test_foreign_currency_conversion_exact_splits_and_filters(finance_api):
    api = finance_api
    api.binding.connection.execute('INSERT INTO group_currencies(id,group_id,currency_code,exchange_rate) VALUES (?,?,?,?)',
        (str(uuid.uuid4()), api.ids['group'], 'EUR', 1234567))
    api.binding.connection.commit()
    payload = expense_payload(api, amount='10')
    payload.update(currency_code='EUR', split_type='exact', splits=[
        {'group_member_id': api.ids['a'], 'value': '6.35'}, {'group_member_id': api.ids['b'], 'value': '6'}])
    response = api.client.post(api.base + '/expenses', json=payload)
    assert response.status_code == 200, response.text
    eid = response.json()['id']
    assert Decimal(response.json()['converted_amount']) == Decimal('12.35')
    assert current_balances(api)[api.ids['a']] == Decimal('6')
    payload = {'amount': '20', 'split_type': 'shares', 'splits': [
        {'group_member_id': api.ids['a'], 'value': '1'}, {'group_member_id': api.ids['b'], 'value': '2'}]}
    response = api.client.patch(api.base + f'/expenses/{eid}', json=payload)
    assert response.status_code == 200, response.text
    assert Decimal(response.json()['converted_amount']) == Decimal('24.69')
    assert [Decimal(row['resolved_amount']) for row in response.json()['splits']] == [Decimal('8.23'), Decimal('16.46')]
    response = api.client.get(api.base + '/expenses', params={'category_id': api.ids['category'], 'member_id': api.ids['a']})
    assert len(response.json()) == 1
    response = api.client.get(api.base + '/expenses', params={'member_id': api.ids['b']})
    assert response.json() == []


def test_holder_change_permissions_and_contribution_report(finance_api):
    api = finance_api
    fid, _ = create_fund(api)
    response = api.client.patch(api.base + f'/funds/{fid}', json={'holder_id': api.ids['b']})
    assert response.status_code == 200, response.text
    api.ctx.user = {'id': api.ids['user_b']}
    response = api.client.patch(api.base + f'/funds/{fid}', json={'holder_id': api.ids['c']})
    assert response.status_code == 200, response.text
    response = api.client.patch(api.base + f'/funds/{fid}', json={'holder_id': api.ids['a']})
    assert response.status_code == 403
    report = api.client.get(api.base + f'/funds/{fid}').json()
    assert report['transaction_count'] == 3
    assert report['contributions_by_member'] == [{'member_id': api.ids['a'], 'member_name': 'A', 'total': '100'}]
    transactions = api.client.get(api.base + f'/funds/{fid}/transactions').json()
    assert transactions[0]['created_by_name'] == 'B'


@pytest.mark.parametrize('operation', ['update', 'delete'])
def test_financial_mutation_cannot_recreate_debt_for_concurrently_deactivated_member(finance_api, operation):
    api = finance_api
    response = api.client.post(api.base + '/expenses', json=expense_payload(api))
    eid = response.json()['id']
    response = api.client.post(api.base + '/settlements', json={
        'from_member': api.ids['b'], 'to_member': api.ids['a'], 'amount': '40'})
    assert response.status_code == 200
    assert all(value == 0 for value in current_balances(api).values())
    def deactivate(connection):
        connection.execute('UPDATE group_members SET is_active=0 WHERE id=?', (api.ids['b'],))
    api.binding.before_batch = deactivate
    response = api.client.patch(api.base + f'/expenses/{eid}', json={'amount': '100'}) if operation == 'update' else api.client.delete(api.base + f'/expenses/{eid}')
    assert response.status_code == 409, 'A deactivated member must not acquire hidden debt'
    assert all(value == 0 for value in current_balances(api).values())
    assert Decimal(api.client.get(api.base + f'/expenses/{eid}').json()['amount']) == Decimal('80')


def test_settlement_cannot_be_reassigned_away_from_inactive_member(finance_api):
    api = finance_api
    response = api.client.post(api.base + '/expenses', json=expense_payload(api))
    assert response.status_code == 200
    response = api.client.post(api.base + '/settlements', json={
        'from_member': api.ids['b'], 'to_member': api.ids['a'], 'amount': '40'})
    sid = response.json()['id']
    api.binding.connection.execute('UPDATE group_members SET is_active=0 WHERE id=?', (api.ids['b'],))
    api.binding.connection.commit()
    response = api.client.patch(api.base + f'/settlements/{sid}', json={'from_member': api.ids['c']})
    assert response.status_code == 400
    assert all(value == 0 for value in current_balances(api).values())


def test_fund_listing_stays_within_paid_d1_query_budget(finance_api):
    api = finance_api
    for index in range(334):
        api.binding.connection.execute('INSERT INTO funds(id,group_id,name,holder_id,created_by) VALUES (?,?,?,?,?)',
            (str(uuid.uuid4()), api.ids['group'], f'Fund {index}', api.ids['a'], api.ids['a']))
    api.binding.connection.commit()
    api.binding.statements_executed = 0
    response = api.client.get(api.base + '/funds')
    assert response.status_code == 200, response.text
    assert len(response.json()) == 334
    assert api.binding.statements_executed <= 1000, 'Do not issue three extra D1 queries per fund'


def test_equal_split_float_fractions_are_stored_at_column_scale(finance_api):
    # The web client sends 1/n as a JSON float; Postgres rounded it to NUMERIC(12,4).
    api = finance_api
    payload = expense_payload(api, amount='160000')
    payload['splits'] = [{'group_member_id': api.ids[m], 'value': 1 / 3} for m in ('a', 'b')]
    response = api.client.post(api.base + '/expenses', json=payload)
    assert response.status_code == 200, response.text
    assert [Decimal(s['value']) for s in response.json()['splits']] == [Decimal('0.3333'), Decimal('0.3333')]
    eid = response.json()['id']
    response = api.client.patch(api.base + f'/expenses/{eid}', json={'split_type': 'equal', 'splits': payload['splits']})
    assert response.status_code == 200, response.text
