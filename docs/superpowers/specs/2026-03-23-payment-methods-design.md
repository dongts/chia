# Payment Methods Feature — Design Spec

## Overview

Users can save bank transfer information on their profile and selectively enable payment methods per group. Other group members see enabled payment info when they need to pay someone — on the balances tab, in suggested settlements, and in the transfer modal.

## Data Model

### `payment_methods` table (user-level)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| user_id | UUID | FK → users.id, CASCADE, NOT NULL | Owner |
| label | String(100) | NOT NULL | Display name, e.g. "Vietcombank", "Momo" |
| bank_name | String(100) | nullable | Structured: bank/service name |
| account_number | String(100) | nullable | Structured: account number |
| account_holder | String(200) | nullable | Structured: account holder name |
| note | Text | nullable | Free-text fallback for non-standard methods |
| qr_image_url | String(500) | nullable | Uploaded QR image path/URL |
| created_at | DateTime(tz) | NOT NULL, default now | |

**Relationships:** `user` (Many-to-1 → User)

### `group_payment_methods` table (join table)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK | |
| group_id | UUID | FK → groups.id, CASCADE, NOT NULL | |
| payment_method_id | UUID | FK → payment_methods.id, CASCADE, NOT NULL | |
| member_id | UUID | FK → group_members.id, CASCADE, NOT NULL | Denormalized for query efficiency |
| created_at | DateTime(tz) | NOT NULL, default now | |

**Unique constraint:** (group_id, payment_method_id)

**Why `member_id` is stored:** Allows a single query to fetch all enabled payment methods for a group's members without joining through users → group_members. When a payment method is enabled for a group, the system looks up the user's group_member record and stores it.

## API Endpoints

### Profile-level — CRUD payment methods

**GET `/api/v1/users/me/payment-methods`**
- Auth: required
- Response: `PaymentMethodRead[]`

**POST `/api/v1/users/me/payment-methods`**
- Auth: required
- Body: `{ label, bank_name?, account_number?, account_holder?, note? }`
- Response: `PaymentMethodRead`

**PATCH `/api/v1/users/me/payment-methods/{id}`**
- Auth: required (must own the method)
- Body: any subset of `{ label?, bank_name?, account_number?, account_holder?, note? }`
- Response: `PaymentMethodRead`

**DELETE `/api/v1/users/me/payment-methods/{id}`**
- Auth: required (must own the method)
- Response: `{ "detail": "Payment method deleted" }`
- Side effect: cascades to group_payment_methods (auto-removes from all groups)

**POST `/api/v1/users/me/payment-methods/{id}/qr`**
- Auth: required (must own the method)
- Body: multipart file (image/jpeg, image/png, image/webp)
- Response: `PaymentMethodRead` (with updated qr_image_url)
- Uses existing `file_storage.save_upload()` service

### Group-level — enable/disable and view

**GET `/api/v1/groups/{group_id}/payment-methods`**
- Auth: required (must be active group member)
- Response: `GroupPaymentMethodRead[]` — all enabled methods for all members
- Each entry includes: member_id, member_name, and the payment method details

**GET `/api/v1/groups/{group_id}/payment-methods/mine`**
- Auth: required (must be active group member with linked user)
- Response: `MyGroupPaymentMethodRead[]` — all user's payment methods with an `enabled` boolean flag for this group
- Purpose: powers the toggle UI in group settings

**POST `/api/v1/groups/{group_id}/payment-methods`**
- Auth: required (must be active claimed member)
- Body: `{ payment_method_id }`
- Validates: payment_method belongs to the current user
- Looks up the user's member_id in this group and stores it
- Response: `GroupPaymentMethodRead`

**DELETE `/api/v1/groups/{group_id}/payment-methods/{payment_method_id}`**
- Auth: required (must own the payment method)
- Response: `{ "detail": "Payment method removed from group" }`

## Schemas

### PaymentMethodRead
```
{
  id: UUID
  label: string
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
  note: string | null
  qr_image_url: string | null
  created_at: datetime
}
```

### PaymentMethodCreate
```
{
  label: string (required)
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
  note: string | null
}
```

### PaymentMethodUpdate
```
{
  label: string | null
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
  note: string | null
}
```

### GroupPaymentMethodRead
```
{
  id: UUID (group_payment_methods.id)
  member_id: UUID
  member_name: string
  payment_method: PaymentMethodRead
}
```

### MyGroupPaymentMethodRead
```
{
  payment_method: PaymentMethodRead
  enabled: boolean
}
```

## UI Surfaces

### 1. Profile Page — "Payment Methods" section

Location: below existing profile info in `/profile`

- List of saved payment methods, each showing:
  - Label (bold), bank name, account number, account holder
  - Note (if present, smaller text)
  - QR thumbnail (if uploaded, clickable to view full size)
- "Add Payment Method" button → inline form or small modal with fields:
  - Label (required), bank name, account number, account holder, note
  - QR image upload (separate button, after creation)
- Each method has edit (pencil) and delete (trash) icons
- Empty state: "No payment methods yet. Add one so group members know how to pay you."

### 2. Group Settings Page — "My Payment Methods" section

Location: new section in `/groups/{groupId}/settings`, after the existing settings toggles, before members list

- Only visible to claimed members (user_id is not null)
- Header: "My Payment Methods"
- Subtext: "Choose which payment methods are visible to this group"
- Lists all user's payment methods as toggle rows:
  - Label + bank name on the left
  - Toggle switch on the right (enabled/disabled for this group)
- If user has no payment methods: "No payment methods saved. Go to your profile to add one." with link to /profile
- Fetches from GET `/groups/{gid}/payment-methods/mine`
- Toggle calls POST or DELETE on `/groups/{gid}/payment-methods`

### 3. Balances Tab — Payment info icon

Location: each member row in the balances list on `/groups/{groupId}`

- If a member has enabled payment methods in this group, show a small bank/wallet icon next to their name
- Clicking the icon opens a modal/popover: "Payment Info for {name}"
  - Lists each enabled method: label, bank details, note, QR image
  - QR image shown at readable size (tap to enlarge on mobile)
- Members with no payment methods: no icon shown

### 4. Suggested Settlements — Payment info icon

Location: each settlement suggestion row

- Next to the payee name (the person receiving money), show the same bank icon if they have payment methods enabled
- Same modal/popover behavior as balances tab

### 5. Transfer Modal — Inline payment info

Location: in the "Record Transfer" modal, below the "To" dropdown

- When a "To" member is selected, check if they have enabled payment methods
- If yes, display a compact card below the dropdown:
  - Each method as a small card: label, bank details (account number + holder), QR thumbnail
  - Multiple methods stacked vertically
- If no methods: nothing shown (no empty state needed here)

### Shared Component: PaymentInfoModal

A reusable component used by balances tab and settlements:
- Props: `memberId`, `memberName`, `isOpen`, `onClose`
- Fetches (or receives) the member's enabled payment methods
- Displays them in a clean modal with method cards

### Shared Component: PaymentMethodCards

A reusable component for displaying a list of payment methods:
- Props: `methods: PaymentMethodRead[]`
- Used inside PaymentInfoModal and inline in the Transfer modal
- Each card shows: label, structured fields (if present), note (if present), QR image (if present)

## Data Flow

1. User goes to Profile → adds payment methods (stored in `payment_methods`)
2. User goes to Group Settings → toggles methods on/off for that group (creates/deletes `group_payment_methods` rows)
3. Other members view balances/settlements/transfer → frontend fetches `GET /groups/{gid}/payment-methods` → filters by relevant member → displays info

The group-level GET endpoint returns all enabled methods for the group in one call. The frontend caches this per group load and filters client-side per member. This avoids N+1 requests when rendering the balances list.

## Edge Cases

- **User deletes a payment method from profile:** CASCADE deletes from all groups. UI refreshes naturally on next load.
- **Member removed from group:** CASCADE on group_members.id deletes their group_payment_methods entries.
- **Guest/unclaimed members:** Cannot have payment methods (no user_id). The toggle section in group settings is hidden for them.
- **QR image without structured fields:** Valid — some users may only upload a QR. Display shows label + QR only.
- **Structured fields without QR:** Also valid — display shows text info only.
- **No fields at all except label:** Allowed at creation. Label is the only required field.

## Files to Create/Modify

### Backend (new files)
- `backend/app/models/payment_method.py` — PaymentMethod + GroupPaymentMethod models
- `backend/app/schemas/payment_method.py` — Pydantic schemas
- `backend/app/api/v1/payment_methods.py` — Profile-level CRUD endpoints
- `backend/app/api/v1/group_payment_methods.py` — Group-level endpoints
- `backend/migrations/versions/xxx_add_payment_methods.py` — Alembic migration

### Backend (modify)
- `backend/app/models/__init__.py` — Register new models
- `backend/app/api/v1/__init__.py` or `backend/app/main.py` — Register new routers

### Frontend (new files)
- `frontend/src/api/paymentMethods.ts` — API client functions
- `frontend/src/components/PaymentMethodCards.tsx` — Shared display component
- `frontend/src/components/PaymentInfoModal.tsx` — Modal wrapper for viewing payment info

### Frontend (modify)
- `frontend/src/pages/Profile.tsx` — Add payment methods CRUD section
- `frontend/src/pages/GroupSettings.tsx` — Add "My Payment Methods" toggle section
- `frontend/src/pages/GroupView.tsx` — Add bank icons to balances, settlements, and transfer modal
- `frontend/src/types/index.ts` — Add TypeScript types
