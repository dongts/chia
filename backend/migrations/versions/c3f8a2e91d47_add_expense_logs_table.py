"""add expense_logs table

Revision ID: c3f8a2e91d47
Revises: eba2feeeae00
Create Date: 2026-04-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c3f8a2e91d47'
down_revision: Union[str, None] = 'eba2feeeae00'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'expense_logs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('expense_id', sa.UUID(), nullable=False),
        sa.Column('group_id', sa.UUID(), nullable=False),
        sa.Column('actor_member_id', sa.UUID(), nullable=True),
        sa.Column('action', sa.String(length=30), nullable=False),
        sa.Column('changes', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['expense_id'], ['expenses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['group_id'], ['groups.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['actor_member_id'], ['group_members.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_expense_logs_expense_id', 'expense_logs', ['expense_id'])


def downgrade() -> None:
    op.drop_index('ix_expense_logs_expense_id', table_name='expense_logs')
    op.drop_table('expense_logs')
