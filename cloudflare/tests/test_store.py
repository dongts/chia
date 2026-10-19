from decimal import Decimal
import pytest
from chia_api.db import Store

def test_numeric_conversion_is_exact_and_table_specific():
    db=Store(None)
    value=Decimal('9999999999.99')
    encoded=db.encode('expenses',{'amount':value,'exchange_rate':Decimal('0.123456')})
    assert encoded == {'amount':999999999999,'exchange_rate':123456}
    assert db.decode('expenses',encoded)=={'amount':value,'exchange_rate':Decimal('0.123456')}
    assert db.encode('system_config',{'value':'groq/model'})['value']=='groq/model'

def test_fractional_scaled_integer_is_rejected():
    with pytest.raises(ValueError): Store(None).encode('expenses',{'amount':Decimal('1.001')})

def test_json_boolean_round_trip():
    db=Store(None)
    raw=db.encode('notifications',{'data':{'amount':'1.20'},'read':False})
    assert raw['read']==0
    assert db.decode('notifications',raw)=={'data':{'amount':'1.20'},'read':False}

def test_commands_bind_untrusted_values():
    db=Store(None)
    cmd=db.insert('users',{'id':'id','display_name':"Robert'); DROP TABLE users;--"})
    assert 'DROP TABLE' not in cmd.sql
    assert "Robert'); DROP TABLE users;--" in cmd.params
