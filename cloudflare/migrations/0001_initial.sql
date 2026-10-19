PRAGMA foreign_keys = ON;

CREATE TABLE "categories" (
  "id" TEXT NOT NULL,
  "group_id" TEXT,
  "name" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT '📦',
  "is_default" INTEGER NOT NULL DEFAULT 0 CHECK ("is_default" IN (0, 1)),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE
);

CREATE TABLE "expense_fund_deductions" (
  "id" TEXT NOT NULL,
  "expense_id" TEXT NOT NULL,
  "fund_id" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  UNIQUE ("expense_id", "fund_id"),
  FOREIGN KEY ("created_by") REFERENCES "group_members" ("id"),
  FOREIGN KEY ("expense_id") REFERENCES "expenses" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("fund_id") REFERENCES "funds" ("id") ON DELETE CASCADE
);

CREATE TABLE "expense_logs" (
  "id" TEXT NOT NULL,
  "expense_id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "actor_member_id" TEXT,
  "action" TEXT NOT NULL,
  "changes" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("actor_member_id") REFERENCES "group_members" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("expense_id") REFERENCES "expenses" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE
);

CREATE TABLE "expense_splits" (
  "id" TEXT NOT NULL,
  "expense_id" TEXT NOT NULL,
  "group_member_id" TEXT NOT NULL,
  "split_type" TEXT NOT NULL CHECK ("split_type" IN ('equal', 'exact', 'percentage', 'shares')),
  "value" INTEGER NOT NULL,
  "resolved_amount" INTEGER NOT NULL,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("expense_id") REFERENCES "expenses" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("group_member_id") REFERENCES "group_members" ("id")
);

CREATE TABLE "expenses" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "paid_by" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency_code" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "receipt_url" TEXT,
  "date" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "exchange_rate" INTEGER NOT NULL DEFAULT 1000000,
  "converted_amount" INTEGER NOT NULL,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("category_id") REFERENCES "categories" ("id"),
  FOREIGN KEY ("created_by") REFERENCES "group_members" ("id"),
  FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("paid_by") REFERENCES "group_members" ("id")
);

CREATE TABLE "fund_transactions" (
  "id" TEXT NOT NULL,
  "fund_id" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('contribute', 'withdraw', 'expense', 'holder_change')),
  "amount" INTEGER NOT NULL,
  "member_id" TEXT NOT NULL,
  "expense_id" TEXT,
  "note" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "deduction_id" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("deduction_id") REFERENCES "expense_fund_deductions" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("created_by") REFERENCES "group_members" ("id"),
  FOREIGN KEY ("expense_id") REFERENCES "expenses" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("fund_id") REFERENCES "funds" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("member_id") REFERENCES "group_members" ("id")
);

CREATE TABLE "funds" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "holder_id" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "is_active" INTEGER NOT NULL DEFAULT 1 CHECK ("is_active" IN (0, 1)),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("created_by") REFERENCES "group_members" ("id"),
  FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("holder_id") REFERENCES "group_members" ("id")
);

CREATE TABLE "group_currencies" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "currency_code" TEXT NOT NULL,
  "exchange_rate" INTEGER NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  UNIQUE ("group_id", "currency_code"),
  FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE
);

CREATE TABLE "group_member_logs" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "detail" TEXT,
  "performed_by" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("member_id") REFERENCES "group_members" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("performed_by") REFERENCES "group_members" ("id")
);

CREATE TABLE "group_members" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "user_id" TEXT,
  "display_name" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member' CHECK ("role" IN ('owner', 'admin', 'member')),
  "claimed_at" TEXT,
  "is_active" INTEGER NOT NULL DEFAULT 1 CHECK ("is_active" IN (0, 1)),
  "joined_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "initial_balance" INTEGER NOT NULL DEFAULT 0,
  "nicknames" TEXT NOT NULL DEFAULT '',
  PRIMARY KEY ("id"),
  UNIQUE ("group_id", "user_id"),
  FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL
);

CREATE TABLE "group_payment_methods" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "payment_method_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  UNIQUE ("group_id", "payment_method_id"),
  FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("member_id") REFERENCES "group_members" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods" ("id") ON DELETE CASCADE
);

CREATE TABLE "groups" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "currency_code" TEXT NOT NULL DEFAULT 'USD',
  "invite_code" TEXT NOT NULL,
  "default_category_id" TEXT,
  "require_verified_users" INTEGER NOT NULL DEFAULT 0 CHECK ("require_verified_users" IN (0, 1)),
  "allow_log_on_behalf" INTEGER NOT NULL DEFAULT 1 CHECK ("allow_log_on_behalf" IN (0, 1)),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "is_deleted" INTEGER NOT NULL DEFAULT 0 CHECK ("is_deleted" IN (0, 1)),
  "deleted_at" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("default_category_id") REFERENCES "categories" ("id") ON DELETE SET NULL
);

CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "group_id" TEXT,
  "type" TEXT NOT NULL,
  "data" TEXT NOT NULL DEFAULT '{}',
  "read" INTEGER NOT NULL DEFAULT 0 CHECK ("read" IN (0, 1)),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);

CREATE TABLE "payment_methods" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "bank_name" TEXT,
  "account_number" TEXT,
  "account_holder" TEXT,
  "note" TEXT,
  "qr_image_url" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "bank_bin" TEXT,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);

CREATE TABLE "settlements" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "from_member" TEXT NOT NULL,
  "to_member" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "created_by" TEXT NOT NULL,
  "settled_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "description" TEXT,
  "type" TEXT NOT NULL DEFAULT 'settle_up',
  PRIMARY KEY ("id"),
  FOREIGN KEY ("created_by") REFERENCES "group_members" ("id"),
  FOREIGN KEY ("from_member") REFERENCES "group_members" ("id"),
  FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("to_member") REFERENCES "group_members" ("id")
);

CREATE TABLE "system_config" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("key")
);

CREATE TABLE "user_oauth" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_user_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  UNIQUE ("provider", "provider_user_id"),
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT,
  "password_hash" TEXT,
  "display_name" TEXT NOT NULL,
  "device_id" TEXT,
  "avatar_url" TEXT,
  "is_verified" INTEGER NOT NULL DEFAULT 0 CHECK ("is_verified" IN (0, 1)),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY ("id"),
  UNIQUE ("email")
);

CREATE INDEX "ix_expense_logs_expense_id" ON "expense_logs" ("expense_id");

CREATE UNIQUE INDEX "ix_groups_invite_code" ON "groups" ("invite_code");

CREATE INDEX "ix_groups_is_deleted" ON "groups" ("is_deleted");

CREATE INDEX "ix_users_device_id" ON "users" ("device_id");
