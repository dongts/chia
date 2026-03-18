from decimal import ROUND_DOWN, Decimal


def calculate_splits(
    amount: Decimal,
    split_type: str,
    members: dict[str, Decimal | None],
) -> dict[str, Decimal]:
    if split_type == "equal":
        return _equal_split(amount, list(members.keys()))
    elif split_type == "exact":
        return _exact_split(amount, members)
    elif split_type == "percentage":
        return _percentage_split(amount, members)
    elif split_type == "shares":
        return _shares_split(amount, members)
    else:
        raise ValueError(f"Unknown split type: {split_type}")


def _equal_split(amount: Decimal, member_ids: list[str]) -> dict[str, Decimal]:
    count = len(member_ids)
    base = (amount / count).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    remainder_cents = int((amount - base * count) * 100)
    result = {}
    for i, mid in enumerate(member_ids):
        result[mid] = base + (Decimal("0.01") if i < remainder_cents else Decimal("0"))
    return result


def _exact_split(amount: Decimal, members: dict[str, Decimal | None]) -> dict[str, Decimal]:
    total = sum(v for v in members.values() if v is not None)
    if total != amount:
        raise ValueError(f"Exact amounts must sum to {amount}, got {total}")
    return {k: v.quantize(Decimal("0.01")) for k, v in members.items()}


def _percentage_split(amount: Decimal, members: dict[str, Decimal | None]) -> dict[str, Decimal]:
    total_pct = sum(v for v in members.values() if v is not None)
    if total_pct != Decimal("100"):
        raise ValueError(f"Percentages must sum to 100, got {total_pct}")
    member_ids = list(members.keys())
    result = {}
    for mid in member_ids:
        result[mid] = (amount * members[mid] / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    remainder_cents = int((amount - sum(result.values())) * 100)
    for i in range(remainder_cents):
        result[member_ids[i]] += Decimal("0.01")
    return result


def _shares_split(amount: Decimal, members: dict[str, Decimal | None]) -> dict[str, Decimal]:
    total_shares = sum(v for v in members.values() if v is not None)
    if total_shares <= 0:
        raise ValueError("Total shares must be positive")
    member_ids = list(members.keys())
    result = {}
    for mid in member_ids:
        result[mid] = (amount * members[mid] / total_shares).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    remainder_cents = int((amount - sum(result.values())) * 100)
    for i in range(remainder_cents):
        result[member_ids[i]] += Decimal("0.01")
    return result
