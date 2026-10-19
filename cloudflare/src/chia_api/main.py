import json
from fastapi import FastAPI, Request, Depends
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .auth import router as auth_router
from .common import public_context, Context, env_value

app=FastAPI(title='Chia',version='1.0.0',docs_url=None,redoc_url=None,openapi_url=None)
class BindingCORS:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        env = scope.get('env') or getattr(getattr(scope.get('app'), 'state', None), 'env', None)
        origins = json.loads(env_value(env, 'CHIA_CORS_ORIGINS', '[]'))
        middleware = CORSMiddleware(self.app, allow_origins=origins,
                                    allow_credentials=True, allow_methods=['*'], allow_headers=['*'])
        await middleware(scope, receive, send)

app.add_middleware(BindingCORS)
app.include_router(auth_router)
from .routes_groups import router as groups_router
from .routes_finance import router as finance_router
from .routes_reports import router as reports_router
from .routes_admin import router as admin_router
from .routes_misc import router as misc_router
app.include_router(groups_router)
app.include_router(misc_router)
app.include_router(finance_router)
app.include_router(reports_router)
app.include_router(admin_router)

@app.exception_handler(ValueError)
async def invalid_value(request, exc):
    return JSONResponse(status_code=400, content={'detail': 'Invalid value or monetary precision'})

@app.get('/health')
async def health(ctx: Context = Depends(public_context)):
    return {'status': 'ok', 'environment': env_value(ctx.env, 'CHIA_ENV'), 'database': 'd1'}
