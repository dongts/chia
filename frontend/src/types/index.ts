// Auth
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

// User
export interface User {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
  is_verified: boolean;
  created_at: string;
}

// Group
export interface Group {
  id: string;
  name: string;
  description: string | null;
  currency_code: string;
  invite_code: string;
  require_verified_users: boolean;
  allow_log_on_behalf: boolean;
  created_at: string;
  member_count: number | null;
}

export interface GroupListItem {
  id: string;
  name: string;
  currency_code: string;
  member_count: number;
  my_balance: number;
  created_at: string | null;
}

export interface GroupCreate {
  name: string;
  description?: string | null;
  currency_code?: string;
}

export interface GroupUpdate {
  name?: string | null;
  description?: string | null;
  currency_code?: string | null;
  require_verified_users?: boolean | null;
  allow_log_on_behalf?: boolean | null;
}

// Group Member
export type MemberRole = "owner" | "admin" | "member";

export interface GroupMember {
  id: string;
  display_name: string;
  role: MemberRole;
  user_id: string | null;
  is_active: boolean;
  initial_balance: number;
  claimed_at: string | null;
  joined_at: string;
}

export interface MemberCreate {
  display_name: string;
  initial_balance?: number | null;
}

export interface MemberUpdate {
  role?: MemberRole | null;
  display_name?: string | null;
  initial_balance?: number | null;
}

// Expense / Split
export type SplitType = "equal" | "exact" | "percentage" | "shares";

export interface SplitInput {
  group_member_id: string;
  value: number;
}

export interface ExpenseSplit {
  id: string;
  group_member_id: string;
  member_name: string | null;
  split_type: SplitType;
  value: number;
  resolved_amount: number;
}

export interface FundDeductionInput {
  fund_id: string;
  amount: number;
}

export interface FundDeductionRead {
  id: string;
  fund_id: string;
  fund_name: string;
  amount: number;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  currency_code: string;
  exchange_rate: number;
  converted_amount: number;
  group_currency: string | null;
  date: string;
  paid_by: string;
  payer_name: string | null;
  created_by: string;
  category_id: string;
  receipt_url: string | null;
  fund_deductions: FundDeductionRead[];
  splits: ExpenseSplit[];
  created_at: string;
}

export interface ExpenseCreate {
  description: string;
  amount: number;
  currency_code?: string | null;
  exchange_rate?: number | null;
  date: string;
  paid_by: string;
  category_id: string;
  fund_deductions?: FundDeductionInput[];
  split_type: SplitType;
  splits: SplitInput[];
}

export interface ExpenseUpdate {
  description?: string | null;
  amount?: number | null;
  currency_code?: string | null;
  exchange_rate?: number | null;
  date?: string | null;
  paid_by?: string | null;
  category_id?: string | null;
  fund_deductions?: FundDeductionInput[];
  split_type?: SplitType | null;
  splits?: SplitInput[] | null;
}

// Group Currency
export interface GroupCurrencyRead {
  id: string;
  currency_code: string;
  exchange_rate: number;
}

export interface GroupCurrencyCreate {
  currency_code: string;
  exchange_rate: number;
}

export interface GroupCurrencyUpdate {
  exchange_rate: number;
}

// Category
export interface Category {
  id: string;
  name: string;
  icon: string;
  is_default: boolean;
  group_id: string | null;
}

export interface CategoryCreate {
  name: string;
  icon?: string;
  is_default?: boolean;
}

// Settlement
export interface Settlement {
  id: string;
  from_member: string;
  from_member_name: string | null;
  to_member: string;
  to_member_name: string | null;
  amount: number;
  description: string | null;
  type: "settle_up" | "transfer";
  settled_at: string;
}

export interface SettlementCreate {
  from_member: string;
  to_member: string;
  amount: number;
  description?: string | null;
  type?: "settle_up" | "transfer";
}

export interface SettlementUpdate {
  from_member?: string;
  to_member?: string;
  amount?: number;
  description?: string | null;
  type?: "settle_up" | "transfer";
}

// Fund
export type FundTransactionType = "contribute" | "withdraw" | "expense" | "holder_change";

export interface Fund {
  id: string;
  group_id: string;
  name: string;
  description: string | null;
  holder_id: string;
  holder_name: string | null;
  created_by: string;
  is_active: boolean;
  balance: number;
  transaction_count: number;
  created_at: string;
  updated_at: string;
}

export interface FundDetail extends Fund {
  contributions_by_member: MemberContribution[];
}

export interface MemberContribution {
  member_id: string;
  member_name: string;
  total: number;
}

export interface FundCreate {
  name: string;
  description?: string | null;
  holder_id?: string | null;
}

export interface FundUpdate {
  name?: string | null;
  description?: string | null;
  holder_id?: string | null;
  is_active?: boolean | null;
}

export interface FundTransaction {
  id: string;
  fund_id: string;
  type: FundTransactionType;
  amount: number;
  member_id: string;
  member_name: string | null;
  expense_id: string | null;
  note: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
}

export interface FundTransactionCreate {
  type: "contribute" | "withdraw";
  amount: number;
  member_id: string;
  note?: string | null;
}

export interface Balance {
  member_id: string;
  member_name: string;
  balance: number;
}

export interface SuggestedSettlement {
  from_member: string;
  from_member_name: string;
  to_member: string;
  to_member_name: string;
  amount: number;
}

// Notification
export interface Notification {
  id: string;
  type: string;
  data: Record<string, unknown>;
  read: boolean;
  group_id: string | null;
  created_at: string;
}

// Payment Methods
export interface PaymentMethod {
  id: string;
  label: string;
  bank_name: string | null;
  bank_bin: string | null;
  account_number: string | null;
  account_holder: string | null;
  note: string | null;
  qr_image_url: string | null;
  created_at: string;
}

export interface PaymentMethodCreate {
  label: string;
  bank_name?: string | null;
  bank_bin?: string | null;
  account_number?: string | null;
  account_holder?: string | null;
  note?: string | null;
}

export interface PaymentMethodUpdate {
  label?: string | null;
  bank_name?: string | null;
  bank_bin?: string | null;
  account_number?: string | null;
  account_holder?: string | null;
  note?: string | null;
}

export interface GroupPaymentMethod {
  id: string;
  member_id: string;
  member_name: string;
  payment_method: PaymentMethod;
}

export interface MyGroupPaymentMethod {
  payment_method: PaymentMethod;
  enabled: boolean;
}

export interface FundDeductionDraft {
  fund_id: string;
  amount: number;
}

export interface ExpenseParseDraft {
  description: string | null;
  amount: number | null;
  currency_code: string | null;
  date: string | null;
  paid_by_member_id: string | null;
  category_id: string | null;
  split_type: SplitType | null;
  splits: SplitInput[] | null;
  fund_deductions: FundDeductionDraft[] | null;
  confidence: number;
  raw_extraction: Record<string, unknown>;
}
