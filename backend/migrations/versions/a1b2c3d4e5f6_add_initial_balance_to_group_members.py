"""add initial_balance to group_members

Revision ID: a1b2c3d4e5f6
Revises: 6d25a9d6edc8
Create Date: 2026-03-23 23:00:00.000000

"""
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '6d25a9d6edc8'
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        'group_members',
        sa.Column('initial_balance', sa.Numeric(12, 2), server_default='0', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('group_members', 'initial_balance')
