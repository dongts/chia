"""soft delete groups

Revision ID: a2e7f91c4b18
Revises: c3f8a2e91d47
Create Date: 2026-04-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a2e7f91c4b18'
down_revision: Union[str, None] = 'c3f8a2e91d47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'groups',
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.add_column(
        'groups',
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_groups_is_deleted', 'groups', ['is_deleted'])


def downgrade() -> None:
    op.drop_index('ix_groups_is_deleted', table_name='groups')
    op.drop_column('groups', 'deleted_at')
    op.drop_column('groups', 'is_deleted')
