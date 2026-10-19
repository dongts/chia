"""D1 binding access with exact decimal storage and explicit atomic batches."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
import json
import re
from uuid import UUID
from fastapi import HTTPException
from .schema_meta import SCHEMA

@dataclass(frozen=True)
class Command:
    sql: str
    params: tuple = ()

def identifier(value):
    if not re.fullmatch(r'[a-z_][a-z_0-9]*', value):
        raise ValueError('Invalid SQL identifier')
    return '"'+value+'"'

def plain(value):
    return value.to_py() if hasattr(value,'to_py') else value

class Store:
    def __init__(self, binding):
        self.binding=binding

    def encode(self, table, values):
        meta=SCHEMA[table]
        result={}
        for key,value in values.items():
            if key not in meta['columns']: raise ValueError(f'Unknown column {table}.{key}')
            if value is not None:
                if key in meta['numeric']:
                    if isinstance(value,float): raise ValueError('Money must not be a float')
                    d=Decimal(value)*(Decimal(10)**meta['numeric'][key])
                    if not d.is_finite() or d != d.to_integral_value(): raise ValueError('Invalid monetary precision')
                    value=int(d)
                    if abs(value)>9007199254740991: raise ValueError('Amount outside exact binding range')
                elif key in meta['json']:
                    value=json.dumps(value,separators=(',',':'),ensure_ascii=False,allow_nan=False)
                elif key in meta['boolean']: value=int(value)
                elif isinstance(value,Enum): value=value.value
                elif isinstance(value,UUID): value=str(value)
                elif isinstance(value,(datetime,date)):value=value.isoformat()
            result[key]=value
        return result

    def decode(self, table, row):
        if row is None:return None
        meta=SCHEMA[table]
        result=dict(plain(row))
        for key,scale in meta['numeric'].items():
            if result.get(key) is not None:result[key]=Decimal(str(result[key]))/(Decimal(10)**scale)
        for key in meta['boolean']:
            if result.get(key) is not None:result[key]=bool(result[key])
        for key in meta['json']:
            if isinstance(result.get(key),str):result[key]=json.loads(result[key])
        return result

    def _statement(self, command):
        params=tuple(str(p) if isinstance(p,UUID) else int(p) if isinstance(p,bool) else p for p in command.params)
        return self.binding.prepare(command.sql).bind(*params)

    async def all(self,sql,params=()):
        result=plain(await self._statement(Command(sql,tuple(params))).all())
        return [plain(row) for row in result.get('results',[])]

    async def first(self,sql,params=()):
        rows=await self.all(sql,params)
        return rows[0] if rows else None

    async def scalar(self,sql,params=()):
        row=await self.first(sql,params)
        return next(iter(row.values())) if row else None

    async def rows(self,table,where='',params=(),order_by=''):
        sql='SELECT * FROM '+identifier(table)
        if where:sql+=' WHERE '+where
        if order_by:sql+=' ORDER BY '+order_by
        return [self.decode(table,row) for row in await self.all(sql,params)]

    async def one(self,table,where='',params=()):
        rows=await self.rows(table,where,params)
        return rows[0] if rows else None

    def insert(self,table,values):
        values=self.encode(table,values)
        cols=','.join(identifier(k) for k in values)
        return Command(f'INSERT INTO {identifier(table)} ({cols}) VALUES ({",".join("?" for _ in values)})',tuple(values.values()))

    def update(self,table,values,where,params=()):
        values=self.encode(table,values)
        if not values:raise ValueError('Empty update')
        return Command(f'UPDATE {identifier(table)} SET '+','.join(identifier(k)+'=?' for k in values)+' WHERE '+where,tuple(values.values())+tuple(params))

    def delete(self,table,where,params=()):
        return Command(f'DELETE FROM {identifier(table)} WHERE {where}',tuple(params))

    async def batch(self,commands):
        if not commands:return []
        try:
            result=plain(await self.binding.batch([self._statement(c) for c in commands]))
            return [plain(row) for row in result]
        except Exception as exc:
            message=str(exc)
            if any(k in message.lower() for k in ('constraint','assertion','insufficient','stale','abort','foreign key')):
                raise HTTPException(409, 'The operation conflicts with the current data. Refresh and try again.') from exc
            raise
