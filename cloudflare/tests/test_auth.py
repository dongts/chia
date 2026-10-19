from types import SimpleNamespace
from jose import jwt
from chia_api.auth import tokens, hash_password, verify_password

def test_tokens_carry_existing_contract_and_separate_types():
    env=SimpleNamespace(CHIA_JWT_SECRET='staging-only-test-secret')
    value=tokens(env,'c7c04380-a9f7-43f6-a5b2-d6d5a5c96b18')
    a=jwt.decode(value['access_token'],env.CHIA_JWT_SECRET,algorithms=['HS256'])
    r=jwt.decode(value['refresh_token'],env.CHIA_JWT_SECRET,algorithms=['HS256'])
    assert a['type']=='access' and r['type']=='refresh' and a['sub']==r['sub']

def test_password_hashes_remain_bcrypt_compatible():
    hashed=hash_password('migration-test')
    assert hashed.startswith('$2b$12$')
    assert verify_password('migration-test',hashed)
    assert not verify_password('wrong-password',hashed)
