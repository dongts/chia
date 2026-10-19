from datetime import datetime, timedelta, timezone
import json
import uuid
import bcrypt
from jose import jwt
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from .common import Context, auth_context, public_context, env_value, new_id, now, upload_file
from .db import Command
from shared.schemas.auth import RegisterRequest,LoginRequest,GuestAuthRequest,UpgradeRequest,LinkAccountRequest,LinkGoogleAccountRequest,GoogleAuthRequest,RefreshRequest,TokenResponse
from shared.schemas.user import UserRead,UserUpdate

router=APIRouter(prefix='/api/v1')

def hash_password(password):
    try:return bcrypt.hashpw(password.encode(),bcrypt.gensalt(rounds=12)).decode()
    except ValueError:raise HTTPException(400,'Password is too long')

def verify_password(password,hashed):
    try:return bcrypt.checkpw(password.encode(),hashed.encode())
    except (ValueError,TypeError):return False

def tokens(env,user_id):
    secret=env_value(env,'CHIA_JWT_SECRET')
    if not secret:raise HTTPException(503,'Authentication not configured')
    expiry=datetime.now(timezone.utc)+timedelta(days=365)
    return {kind+'_token':jwt.encode({'sub':str(user_id),'exp':expiry,'type':kind},secret,algorithm='HS256') for kind in ('access','refresh')} | {'token_type':'bearer'}

async def fetch_json(url,method='GET',headers=None,body=None):
    import os
    if os.environ.get('CHIA_NATIVE_RUNTIME') == 'true':
        import httpx
        async with httpx.AsyncClient(timeout=60) as client:
            response=await client.request(method,url,headers=headers or {},content=body)
        if not 200<=response.status_code<300:raise HTTPException(502,'External provider request failed')
        return response.json()
    from workers import fetch
    response=await fetch(url,method=method,headers=headers or {},body=body)
    if not 200<=response.status<300:raise HTTPException(502,'External provider request failed')
    return await response.json()

async def google_user(ctx,credential):
    client_id=env_value(ctx.env,'CHIA_GOOGLE_CLIENT_ID')
    if not client_id:raise HTTPException(503,'Google sign-in not configured')
    try:
        keys=await fetch_json('https://www.googleapis.com/oauth2/v3/certs')
        header=jwt.get_unverified_header(credential)
        key=next(k for k in keys['keys'] if k['kid']==header['kid'])
        claims=jwt.decode(credential,key,algorithms=['RS256'],audience=client_id,issuer=['accounts.google.com','https://accounts.google.com'])
        if not claims.get('email_verified'):raise ValueError('Email not verified')
    except Exception as exc:raise HTTPException(401,'Invalid Google credential') from exc
    link=await ctx.db.one('user_oauth','provider=? AND provider_user_id=?',('google',claims['sub']))
    user=await ctx.db.one('users','id=?',(link['user_id'],)) if link else await ctx.db.one('users','email=?',(claims['email'],))
    commands=[]
    if user is None:
        user={'id':new_id(),'email':claims['email'],'display_name':claims.get('name',claims['email'].split('@')[0]),'avatar_url':claims.get('picture'),'is_verified':True,'created_at':now(),'updated_at':now()}
        commands.append(ctx.db.insert('users',user))
    else:
        updates={'is_verified':True,'updated_at':now()}
        if not user.get('avatar_url') and claims.get('picture'):updates['avatar_url']=claims['picture']
        commands.append(ctx.db.update('users',updates,'id=?',(user['id'],)))
    if link is None:
        commands.append(ctx.db.insert('user_oauth',{'id':new_id(),'user_id':user['id'],'provider':'google','provider_user_id':claims['sub'],'created_at':now()}))
    await ctx.db.batch(commands)
    return await ctx.db.one('users','id=?',(user['id'],))

async def merge_user_into(db,source_user_id,target_user_id):
    source_user_id=str(source_user_id);target_user_id=str(target_user_id)
    if source_user_id==target_user_id:raise HTTPException(400,'Cannot merge a user into itself')
    source=await db.one('users','id=?',(source_user_id,));target=await db.one('users','id=?',(target_user_id,))
    if source is None or target is None:raise HTTPException(404,'User not found')
    sources=await db.rows('group_members','user_id=? AND is_active=1',(source_user_id,))
    targets={m['group_id']:m for m in await db.rows('group_members','user_id=?',(target_user_id,))}
    source_member_ids=sorted(m['id'] for m in sources)
    merge_token=new_id()
    snapshot_sql='''INSERT INTO _finance_assertions(token,ok)
        SELECT ?,CASE WHEN
          EXISTS(SELECT 1 FROM users WHERE id=?)
          AND EXISTS(SELECT 1 FROM users WHERE id=?)
          AND (SELECT COUNT(*) FROM group_members WHERE user_id=? AND is_active=1)=?'''
    snapshot_params=[merge_token,source_user_id,target_user_id,source_user_id,len(source_member_ids)]
    if source_member_ids:
        snapshot_sql+=' AND (SELECT COUNT(*) FROM group_members WHERE user_id=? AND is_active=1 AND id IN ('+','.join('?' for _ in source_member_ids)+'))=?'
        snapshot_params.extend([source_user_id,*source_member_ids,len(source_member_ids)])
    snapshot_sql+=' THEN 1 ELSE 0 END'
    commands=[Command(snapshot_sql,tuple(snapshot_params))];merged=[];moved=[]
    references={'expenses':['paid_by','created_by'],'expense_splits':['group_member_id'],'settlements':['from_member','to_member','created_by'],'group_member_logs':['member_id','performed_by'],'group_payment_methods':['member_id'],'funds':['holder_id','created_by'],'fund_transactions':['member_id','created_by'],'expense_fund_deductions':['created_by'],'expense_logs':['actor_member_id']}
    for member in sources:
        existing=targets.get(member['group_id'])
        if existing:
            for table,columns in references.items():
                for column in columns:commands.append(db.update(table,{column:existing['id']},column+'=?',(member['id'],)))
            # Read both role and balance inside the transaction so a concurrent
            # membership edit cannot be overwritten by the pre-read snapshot.
            commands.append(Command('''UPDATE group_members SET
                initial_balance=initial_balance+(SELECT initial_balance FROM group_members WHERE id=?),
                role=CASE
                  WHEN role='owner' OR (SELECT role FROM group_members WHERE id=?)='owner' THEN 'owner'
                  WHEN role='admin' OR (SELECT role FROM group_members WHERE id=?)='admin' THEN 'admin'
                  ELSE 'member' END,
                is_active=1 WHERE id=?''',(member['id'],member['id'],member['id'],existing['id'])))
            # The balance moved to the surviving identity. Clear it from the
            # now-unclaimed placeholder so a later claim cannot count it twice.
            commands.append(db.update('group_members',{'is_active':False,'user_id':None,'initial_balance':0},'id=?',(member['id'],)))
            merged.append(member['group_id'])
        else:
            commands.append(db.update('group_members',{'user_id':target_user_id},'id=?',(member['id'],)))
            moved.append(member['group_id'])
    commands.extend([db.update('payment_methods',{'user_id':target_user_id},'user_id=?',(source_user_id,)),db.update('user_oauth',{'user_id':target_user_id},'user_id=?',(source_user_id,)),db.delete('notifications','user_id=?',(source_user_id,)),db.delete('users','id=?',(source_user_id,)),Command('DELETE FROM _finance_assertions WHERE token=?',(merge_token,))])
    await db.batch(commands)
    return {'source_name':source['display_name'],'target_name':target['display_name'],'merged_groups':merged,'moved_groups':moved}

@router.get('/auth/config')
async def config(ctx:Context=Depends(public_context)):
    return {'google_client_id':env_value(ctx.env,'CHIA_GOOGLE_CLIENT_ID') or None}

@router.post('/auth/register',response_model=TokenResponse)
async def register(data:RegisterRequest,ctx:Context=Depends(public_context)):
    if await ctx.db.one('users','email=?',(data.email,)):raise HTTPException(400,'Email already registered')
    uid=new_id()
    await ctx.db.batch([ctx.db.insert('users',{'id':uid,'email':data.email,'display_name':data.display_name,'password_hash':hash_password(data.password),'is_verified':True,'created_at':now(),'updated_at':now()})])
    return tokens(ctx.env,uid)

@router.post('/auth/login',response_model=TokenResponse)
async def login(data:LoginRequest,ctx:Context=Depends(public_context)):
    user=await ctx.db.one('users','email=?',(data.email,))
    if not user or not user.get('password_hash') or not verify_password(data.password,user['password_hash']):raise HTTPException(401,'Invalid credentials')
    return tokens(ctx.env,user['id'])

@router.post('/auth/guest',response_model=TokenResponse)
async def guest(data:GuestAuthRequest,ctx:Context=Depends(public_context)):
    user=await ctx.db.one('users','device_id=?',(data.device_id,))
    if not user:
        user={'id':new_id(),'device_id':data.device_id,'display_name':data.display_name,'is_verified':False,'created_at':now(),'updated_at':now()}
        await ctx.db.batch([ctx.db.insert('users',user)])
    return tokens(ctx.env,user['id'])

@router.post('/auth/upgrade',response_model=TokenResponse)
async def upgrade(data:UpgradeRequest,ctx:Context=Depends(auth_context)):
    if ctx.user['is_verified']:raise HTTPException(400,'Already a verified user')
    if await ctx.db.one('users','email=?',(data.email,)):raise HTTPException(400,'Email already registered')
    updates={'email':data.email,'password_hash':hash_password(data.password),'is_verified':True,'updated_at':now()}
    if data.display_name:updates['display_name']=data.display_name
    await ctx.db.batch([ctx.db.update('users',updates,'id=?',(ctx.user['id'],))])
    return tokens(ctx.env,ctx.user['id'])

@router.post('/auth/link-account',response_model=TokenResponse)
async def link_account(data:LinkAccountRequest,ctx:Context=Depends(auth_context)):
    if ctx.user['is_verified']:raise HTTPException(400,'Already a verified user')
    target=await ctx.db.one('users','email=?',(data.email,))
    if not target or not target.get('password_hash') or not verify_password(data.password,target['password_hash']):raise HTTPException(401,'Invalid credentials')
    await merge_user_into(ctx.db,ctx.user['id'],target['id'])
    return tokens(ctx.env,target['id'])

@router.post('/auth/link-google',response_model=TokenResponse)
async def link_google(data:LinkGoogleAccountRequest,ctx:Context=Depends(auth_context)):
    if ctx.user['is_verified']:raise HTTPException(400,'Already a verified user')
    target=await google_user(ctx,data.credential)
    await merge_user_into(ctx.db,ctx.user['id'],target['id'])
    return tokens(ctx.env,target['id'])

@router.post('/auth/google',response_model=TokenResponse)
async def google(data:GoogleAuthRequest,ctx:Context=Depends(public_context)):
    return tokens(ctx.env,(await google_user(ctx,data.credential))['id'])

@router.post('/auth/refresh',response_model=TokenResponse)
async def refresh(data:RefreshRequest,ctx:Context=Depends(public_context)):
    try:
        claims=jwt.decode(data.refresh_token,env_value(ctx.env,'CHIA_JWT_SECRET'),algorithms=['HS256'])
        if claims.get('type')!='refresh':raise ValueError('Invalid type')
        uid=str(uuid.UUID(claims['sub']))
    except Exception:raise HTTPException(401,'Invalid refresh token')
    if not await ctx.db.one('users','id=?',(uid,)):raise HTTPException(401,'User not found')
    return tokens(ctx.env,uid)

@router.get('/users/me',response_model=UserRead)
async def me(ctx:Context=Depends(auth_context)):return ctx.user

@router.patch('/users/me',response_model=UserRead)
async def update_me(data:UserUpdate,ctx:Context=Depends(auth_context)):
    if data.display_name is not None:
        await ctx.db.batch([ctx.db.update('users',{'display_name':data.display_name,'updated_at':now()},'id=?',(ctx.user['id'],))])
    return await ctx.db.one('users','id=?',(ctx.user['id'],))

@router.post('/users/me/avatar',response_model=UserRead)
async def avatar(file:UploadFile,ctx:Context=Depends(auth_context)):
    url=await upload_file(ctx,file)
    await ctx.db.batch([ctx.db.update('users',{'avatar_url':url,'updated_at':now()},'id=?',(ctx.user['id'],))])
    return await ctx.db.one('users','id=?',(ctx.user['id'],))
