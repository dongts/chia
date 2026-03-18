from app.core.exceptions import Forbidden
from app.models.group_member import GroupMember, MemberRole


def require_role(member: GroupMember, *roles: MemberRole):
    if member.role not in roles:
        raise Forbidden(f"Requires role: {', '.join(r.value for r in roles)}")


def require_active(member: GroupMember):
    if not member.is_active:
        raise Forbidden("Member is no longer active in this group")
