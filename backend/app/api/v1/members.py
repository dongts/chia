import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.groups import get_current_member, get_group_or_404
from app.core.exceptions import BadRequest, NotFound
from app.core.permissions import require_role
from app.core.security import get_current_user
from app.database import get_db
from app.models import Group, GroupMember, GroupMemberLog, MemberRole, User
from app.schemas.group_member import ClaimedUserInfo, MemberCreate, MemberRead, MemberUpdate
from app.services.balances import compute_balances, settled_threshold, suggest_settlements_for_member
from app.services.member_log import log_member_event


async def _assert_member_settled(db: AsyncSession, group: Group, member: GroupMember) -> None:
    """Block deactivation while a member still has a non-zero balance.

    A deactivated member drops out of every balance/settlement calculation, so
    letting one leave with an outstanding debt or credit would silently corrupt
    the group's books. On block, we attach the minimal settle-up transfers that
    would bring this member to zero so the client can offer to record them.
    """
    balances = await compute_balances(db, group.id)
    threshold = settled_threshold(group.currency_code)
    balance = balances.get(member.id, Decimal("0")).quantize(threshold)
    if abs(balance) < threshold:
        return

    suggestions = suggest_settlements_for_member(balances, member.id)
    name_ids = {member.id}
    for from_id, to_id, _ in suggestions:
        name_ids.update((from_id, to_id))
    names_result = await db.execute(
        select(GroupMember.id, GroupMember.display_name).where(GroupMember.id.in_(name_ids))
    )
    names = {mid: name for mid, name in names_result.all()}

    owed = balance > 0  # positive balance ⇒ the group owes this member
    raise BadRequest(
        {
            "code": "member_has_balance",
            "message": (
                f"{member.display_name} still has an unsettled balance "
                f"({'is owed' if owed else 'owes'} {abs(balance)} {group.currency_code}). "
                "Settle up before deactivating."
            ),
            "balance": str(balance),
            "currency_code": group.currency_code,
            "suggested_settlements": [
                {
                    "from_member": str(from_id),
                    "from_member_name": names.get(from_id, "Unknown"),
                    "to_member": str(to_id),
                    "to_member_name": names.get(to_id, "Unknown"),
                    "amount": str(amount),
                }
                for from_id, to_id, amount in suggestions
            ],
        }
    )


def _build_claimed_user_info(user: User | None) -> ClaimedUserInfo | None:
    """Construct admin-visible identifying info for a claimed account.

    Truncates device_id so admins can visually match without exposing the
    full opaque token (which is effectively a credential for guest accounts).
    """
    if user is None:
        return None
    device_short = (user.device_id[:8] + "…") if user.device_id else None
    providers = sorted({oa.provider for oa in (user.oauth_accounts or [])})
    return ClaimedUserInfo(
        user_id=user.id,
        display_name=user.display_name,
        email=user.email,
        is_verified=user.is_verified,
        oauth_providers=providers,
        device_id_short=device_short,
    )


def _serialize_member(member: GroupMember, *, include_claimed_user: bool) -> MemberRead:
    payload = MemberRead.model_validate(member)
    if include_claimed_user and member.user_id is not None:
        payload.claimed_user = _build_claimed_user_info(member.user)
    return payload

router = APIRouter(prefix="/groups/{group_id}/members", tags=["members"])


@router.get("", response_model=list[MemberRead])
async def list_members(
    group_id: uuid.UUID,
    include_inactive: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    is_admin = current.role in (MemberRole.owner, MemberRole.admin)
    query = select(GroupMember).where(GroupMember.group_id == group_id)
    if not include_inactive:
        query = query.where(GroupMember.is_active.is_(True))
    if is_admin:
        query = query.options(selectinload(GroupMember.user).selectinload(User.oauth_accounts))
    result = await db.execute(query.order_by(GroupMember.joined_at))
    return [
        _serialize_member(m, include_claimed_user=is_admin)
        for m in result.scalars().all()
    ]


@router.post("", response_model=MemberRead)
async def add_member(
    group_id: uuid.UUID,
    data: MemberCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_group_or_404(db, group_id)
    current = await get_current_member(db, group_id, current_user.id)
    require_role(current, MemberRole.owner, MemberRole.admin)
    # Limit 100 members per group
    count = (await db.execute(
        select(func.count(GroupMember.id)).where(
            GroupMember.group_id == group_id, GroupMember.is_active.is_(True)
        )
    )).scalar()
    if count >= 100:
        raise BadRequest("Maximum 100 members per group")
    member = GroupMember(
        group_id=group_id,
        display_name=data.display_name,
        nicknames=data.nicknames,
        role=MemberRole.member,
        initial_balance=data.initial_balance or 0,
    )
    db.add(member)
    await db.flush()
    await log_member_event(db, group_id, member.id, "joined", f"Added by {current.display_name}", current.id)
    await db.commit()
    await db.refresh(member)
    return member


@router.patch("/{member_id}", response_model=MemberRead)
async def update_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    data: MemberUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group_id)
    )
    target = result.scalars().first()
    if not target:
        raise NotFound("Member not found")

    if data.role is not None:
        require_role(current, MemberRole.owner)
        if target.id == current.id:
            raise BadRequest("Cannot change own role")
        old_role = target.role
        target.role = data.role
        await log_member_event(db, group_id, member_id, "role_changed", f"{old_role.value} → {data.role.value}", current.id)

    if data.display_name is not None:
        if target.id != current.id:
            require_role(current, MemberRole.owner, MemberRole.admin)
        old_name = target.display_name
        target.display_name = data.display_name
        if old_name != data.display_name:
            await log_member_event(db, group_id, member_id, "renamed", f'"{old_name}" → "{data.display_name}"', current.id)

    if data.nicknames is not None:
        if target.id != current.id:
            require_role(current, MemberRole.owner, MemberRole.admin)
        target.nicknames = data.nicknames

    if data.initial_balance is not None:
        require_role(current, MemberRole.owner, MemberRole.admin)
        target.initial_balance = data.initial_balance

    if data.is_active is not None and data.is_active != target.is_active:
        require_role(current, MemberRole.owner, MemberRole.admin)
        if target.role == MemberRole.owner:
            raise BadRequest("Cannot deactivate the group owner")
        if data.is_active:
            target.is_active = True
            await log_member_event(
                db, group_id, member_id, "reactivated", f"Reactivated by {current.display_name}", current.id
            )
        else:
            group = await get_group_or_404(db, group_id)
            await _assert_member_settled(db, group, target)
            target.is_active = False
            await log_member_event(
                db, group_id, member_id, "removed", f"Removed by {current.display_name}", current.id
            )

    await db.commit()
    await db.refresh(target)
    return target


@router.post("/{member_id}/claim", response_model=MemberRead)
async def claim_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == current_user.id,
            GroupMember.is_active.is_(True),
        )
    )
    if existing.scalars().first():
        raise BadRequest("You already have a member profile in this group")

    result = await db.execute(
        select(GroupMember).where(
            GroupMember.id == member_id,
            GroupMember.group_id == group_id,
            GroupMember.user_id.is_(None),
        )
    )
    target = result.scalars().first()
    if not target:
        raise NotFound("Unclaimed member not found")

    target.user_id = current_user.id
    target.claimed_at = datetime.now(timezone.utc)
    # Snapshot identifying details so the audit trail survives even if the
    # user later changes email, deletes their account, or claims from another
    # device — this is what lets admins recognise "which login was this?"
    parts = [f"Claimed by {current_user.display_name}"]
    if current_user.email:
        parts.append(current_user.email)
    if current_user.device_id:
        parts.append(f"device {current_user.device_id[:8]}…")
    detail = " · ".join(parts)
    await log_member_event(db, group_id, member_id, "claimed", detail)
    await db.commit()
    await db.refresh(target)
    return target


@router.post("/{member_id}/unclaim", response_model=MemberRead)
async def unclaim_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Detach a user account from a member slot so it can be re-claimed.

    Used when a user forgets which device/account they used to claim, or
    needs to migrate their member to a different account.
    """
    current = await get_current_member(db, group_id, current_user.id)
    require_role(current, MemberRole.owner, MemberRole.admin)

    result = await db.execute(
        select(GroupMember)
        .where(GroupMember.id == member_id, GroupMember.group_id == group_id)
        .options(selectinload(GroupMember.user))
    )
    target = result.scalars().first()
    if not target:
        raise NotFound("Member not found")
    if target.user_id is None:
        raise BadRequest("Member is not claimed")
    if target.role == MemberRole.owner:
        raise BadRequest("Cannot unclaim the group owner")

    previous_label = target.user.display_name if target.user else "unknown account"
    if target.user and target.user.email:
        previous_label = f"{previous_label} ({target.user.email})"

    target.user_id = None
    target.claimed_at = None
    await log_member_event(
        db,
        group_id,
        member_id,
        "unclaimed",
        f"Unclaimed from {previous_label} by {current.display_name}",
        current.id,
    )
    await db.commit()
    await db.refresh(target)
    return target


@router.delete("/{member_id}")
async def remove_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current = await get_current_member(db, group_id, current_user.id)
    require_role(current, MemberRole.owner, MemberRole.admin)
    result = await db.execute(
        select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group_id)
    )
    target = result.scalars().first()
    if not target:
        raise NotFound("Member not found")
    if target.role == MemberRole.owner:
        raise BadRequest("Cannot remove the group owner")
    group = await get_group_or_404(db, group_id)
    await _assert_member_settled(db, group, target)
    target.is_active = False
    await log_member_event(db, group_id, member_id, "removed", f"Removed by {current.display_name}", current.id)
    await db.commit()
    return {"detail": "Member removed"}


# ── Member activity log ──────────────────────────────────────────────────────

@router.get("/log")
async def get_member_log(
    group_id: uuid.UUID,
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_current_member(db, group_id, current_user.id)
    result = await db.execute(
        select(GroupMemberLog)
        .where(GroupMemberLog.group_id == group_id)
        .options(
            selectinload(GroupMemberLog.member),
            selectinload(GroupMemberLog.performer),
        )
        .order_by(GroupMemberLog.created_at.desc())
        .limit(limit).offset(offset)
    )
    logs = result.scalars().all()
    return [
        {
            "id": str(log.id),
            "member_name": log.member.display_name if log.member else "Unknown",
            "action": log.action,
            "detail": log.detail,
            "performer_name": log.performer.display_name if log.performer else None,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]
