from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import io
import json
import uuid
from fastapi import Depends, HTTPException, Request, UploadFile
from jose import jwt, JWTError
from .db import Store

@dataclass
class Context:
    db: Store
    env: object
    user: dict | None = None

def new_id():return str(uuid.uuid4())
def now():return datetime.now(timezone.utc).isoformat()
def env_value(env,name,default=''):
    if isinstance(env,dict):return env.get(name,default)
    value=getattr(env,name,None)
    return default if value is None else value

async def public_context(request:Request):
    env=request.scope.get('env') or getattr(request.app.state,'env',None)
    if env is None:raise HTTPException(503,'Application bindings unavailable')
    return Context(Store(env_value(env,'DB')),env)

async def auth_context(request:Request,ctx:Context=Depends(public_context)):
    header=request.headers.get('authorization','')
    if not header.startswith('Bearer '):raise HTTPException(403,'Not authenticated')
    try:
        claims=jwt.decode(header[7:],env_value(ctx.env,'CHIA_JWT_SECRET'),algorithms=['HS256'])
        if claims.get('type')!='access':raise ValueError('Invalid token type')
        uid=str(uuid.UUID(claims['sub']))
    except (JWTError,ValueError,KeyError):raise HTTPException(401,'Invalid token')
    ctx.user=await ctx.db.one('users','id=?',(uid,))
    if ctx.user is None:raise HTTPException(401,'User not found')
    return ctx

async def admin_context(ctx:Context=Depends(auth_context)):
    emails=json.loads(env_value(ctx.env,'CHIA_SUPERADMIN_EMAILS','[]'))
    if ctx.user.get('email') not in emails:raise HTTPException(403,'Superadmin access required')
    return ctx

async def get_group(db,group_id):
    group=await db.one('groups','id=? AND is_deleted=0',(str(group_id),))
    if group is None:raise HTTPException(404,'Group not found')
    return group

async def require_member(ctx,group_id):
    await get_group(ctx.db,group_id)
    member=await ctx.db.one('group_members','group_id=? AND user_id=? AND is_active=1',(str(group_id),ctx.user['id']))
    if member is None:raise HTTPException(403,'Not a member of this group')
    return member

def require_role(member,*roles):
    if member['role'] not in roles:raise HTTPException(403,'Requires role: '+', '.join(roles))

async def notify_commands(db,member_ids,group_id,notification_type,data,exclude_user_id=None):
    ids=list({str(x) for x in member_ids if x is not None})
    users=set()
    for start in range(0,len(ids),90):
        chunk=ids[start:start+90]
        rows=await db.all('SELECT user_id FROM group_members WHERE group_id=? AND id IN ('+','.join('?' for _ in chunk)+')',(str(group_id),*chunk))
        users.update(r['user_id'] for r in rows if r['user_id'])
    return [db.insert('notifications',{'id':new_id(),'user_id':uid,'group_id':str(group_id),'type':notification_type,'data':data,'read':False,'created_at':now()}) for uid in sorted(users) if uid!=exclude_user_id]

def log_member_command(db,group_id,member_id,action,details=None,performed_by=None):
    return db.insert('group_member_logs',{'id':new_id(),'group_id':str(group_id),'member_id':str(member_id),'action':action,'detail':details,'performed_by':str(performed_by) if performed_by else None,'created_at':now()})

async def upload_file(ctx,file:UploadFile):
    if file.content_type not in {'image/jpeg','image/png','image/webp','image/heic','application/pdf'}:
        raise HTTPException(400,'File type not allowed')
    data=await file.read(10*1024*1024+1)
    if len(data)>10*1024*1024:raise HTTPException(400,'File too large')
    content_type=file.content_type
    extension='pdf'
    if content_type.startswith('image/'):
        from PIL import Image, ImageOps, UnidentifiedImageError
        try:
            img=Image.open(io.BytesIO(data))
            if img.width*img.height>25_000_000:raise HTTPException(400,'Image dimensions too large')
            img=ImageOps.exif_transpose(img)
            if img.mode not in ('RGB','L'):img=img.convert('RGB')
            img.thumbnail((1920,1920),Image.Resampling.LANCZOS)
            out=io.BytesIO();img.save(out,format='JPEG',quality=80,optimize=True)
            data=out.getvalue();extension='jpg';content_type='image/jpeg'
        except (UnidentifiedImageError,OSError,Image.DecompressionBombError):raise HTTPException(400,'Invalid or unsupported image')
    key=new_id()+'.'+extension
    if env_value(ctx.env,'CHIA_NATIVE_RUNTIME',False):
        await env_value(ctx.env,'UPLOADS').put(key,data,{'httpMetadata':{'contentType':content_type}})
        return '/uploads/'+key
    from pyodide.ffi import to_js
    from js import Object, Uint8Array
    options=to_js({'httpMetadata':{'contentType':content_type}},dict_converter=Object.fromEntries)
    await ctx.env.UPLOADS.put(key,to_js(data),options)
    return '/uploads/'+key
