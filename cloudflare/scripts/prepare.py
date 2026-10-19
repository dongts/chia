"""Build portable shared sources from the authoritative backend (no copied forks)."""
from pathlib import Path
import ast
import shutil

ROOT=Path(__file__).resolve().parents[2]
DEST=ROOT/'cloudflare/src/shared'
DEST.mkdir(parents=True,exist_ok=True)
(DEST/'__init__.py').write_text('')
(DEST/'schemas').mkdir(exist_ok=True)
for p in (ROOT/'backend/app/schemas').glob('*.py'):
    source=p.read_text().replace('from app.schemas.', 'from shared.schemas.')
    for module in ('expense','group_member','fund'):
        source=source.replace(f'from app.models.{module} import ', 'from shared.enums import ')
    (DEST/'schemas'/p.name).write_text(source)
enums=['import enum\n']
for module in ('expense','group_member','fund'):
    p=ROOT/f'backend/app/models/{module}.py'
    source=p.read_text()
    for node in ast.parse(source).body:
        if isinstance(node,ast.ClassDef) and node.name in ('SplitType','MemberRole','FundTransactionType'):
            enums.append(ast.get_source_segment(source,node))
(DEST/'enums.py').write_text('\n\n'.join(enums)+'\n')
for name in ('balances','split_calculator','debt_simplifier'):
    source=(ROOT/f'backend/app/services/{name}.py').read_text()
    source=source.replace('from app.services.debt_simplifier import','from shared.debt_simplifier import')
    (DEST/f'{name}.py').write_text(source)
shutil.copy2(ROOT/'backend/app/services/llm/prompts.py',DEST/'prompts.py')
print('Prepared portable schemas, enums, accounting services and prompts')
