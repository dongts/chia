from decimal import Decimal


def simplify_debts(balances: dict[str, Decimal]) -> list[tuple[str, str, Decimal]]:
    creditors = []
    debtors = []

    for member, balance in balances.items():
        if balance > 0:
            creditors.append([member, balance])
        elif balance < 0:
            debtors.append([member, -balance])

    creditors.sort(key=lambda x: x[1], reverse=True)
    debtors.sort(key=lambda x: x[1], reverse=True)

    transfers: list[tuple[str, str, Decimal]] = []
    i, j = 0, 0

    while i < len(debtors) and j < len(creditors):
        debtor, debt = debtors[i]
        creditor, credit = creditors[j]
        amount = min(debt, credit)

        transfers.append((debtor, creditor, amount))

        debtors[i][1] -= amount
        creditors[j][1] -= amount

        if debtors[i][1] == 0:
            i += 1
        if creditors[j][1] == 0:
            j += 1

    return transfers
