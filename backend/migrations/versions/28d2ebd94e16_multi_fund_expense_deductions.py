"""multi fund expense deductions

Revision ID: 28d2ebd94e16
Revises: 4ac14da7d470
Create Date: 2026-04-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '28d2ebd94e16'
down_revision: Union[str, None] = '4ac14da7d470'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: Create expense_fund_deductions table
    op.create_table(
        'expense_fund_deductions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('expense_id', sa.UUID(), nullable=False),
        sa.Column('fund_id', sa.UUID(), nullable=False),
        sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['group_members.id']),
        sa.ForeignKeyConstraint(['expense_id'], ['expenses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['fund_id'], ['funds.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('expense_id', 'fund_id', name='uq_expense_fund_deduction'),
    )

    # Step 2: Add deduction_id column to fund_transactions (nullable FK)
    op.add_column(
        'fund_transactions',
        sa.Column('deduction_id', sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        'fk_fund_transactions_deduction_id',
        'fund_transactions',
        'expense_fund_deductions',
        ['deduction_id'],
        ['id'],
        ondelete='CASCADE',
    )

    # Step 3: Drop the unique constraint on fund_transactions.expense_id
    # The constraint was created with unique=True in the column definition,
    # so PostgreSQL auto-named it fund_transactions_expense_id_key
    op.drop_constraint('fund_transactions_expense_id_key', 'fund_transactions', type_='unique')

    # Step 4: Data migration — move existing fund_id references to deduction rows
    op.execute("""
        INSERT INTO expense_fund_deductions (id, expense_id, fund_id, amount, created_by, created_at)
        SELECT gen_random_uuid(), e.id, e.fund_id, e.converted_amount, e.created_by, e.created_at
        FROM expenses e
        WHERE e.fund_id IS NOT NULL
    """)

    # Link existing fund transactions to their deduction rows
    op.execute("""
        UPDATE fund_transactions ft
        SET deduction_id = efd.id
        FROM expense_fund_deductions efd
        WHERE ft.expense_id = efd.expense_id AND ft.fund_id = efd.fund_id
          AND ft.type = 'expense'
    """)

    # Step 5: Drop fund_id column from expenses
    # First drop the FK constraint (it was created with None name, so find by convention)
    op.drop_constraint('expenses_fund_id_fkey', 'expenses', type_='foreignkey')
    op.drop_column('expenses', 'fund_id')


def downgrade() -> None:
    # Re-add fund_id to expenses
    op.add_column(
        'expenses',
        sa.Column('fund_id', sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        'expenses_fund_id_fkey',
        'expenses',
        'funds',
        ['fund_id'],
        ['id'],
        ondelete='SET NULL',
    )

    # Migrate data back: set expenses.fund_id from expense_fund_deductions
    # (use the first deduction per expense in case of multiple, though old schema only supported one)
    op.execute("""
        UPDATE expenses e
        SET fund_id = efd.fund_id
        FROM (
            SELECT DISTINCT ON (expense_id) expense_id, fund_id
            FROM expense_fund_deductions
            ORDER BY expense_id, created_at
        ) efd
        WHERE e.id = efd.expense_id
    """)

    # Restore unique constraint on fund_transactions.expense_id
    op.create_unique_constraint('fund_transactions_expense_id_key', 'fund_transactions', ['expense_id'])

    # Drop FK and deduction_id column from fund_transactions
    op.drop_constraint('fk_fund_transactions_deduction_id', 'fund_transactions', type_='foreignkey')
    op.drop_column('fund_transactions', 'deduction_id')

    # Drop expense_fund_deductions table
    op.drop_table('expense_fund_deductions')
