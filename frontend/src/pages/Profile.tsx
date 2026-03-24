import { useState, useEffect, useRef } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { User, ArrowLeft, Shield, Link2, Pencil, Trash2, Plus, Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import client from "@/api/client";
import { upgrade, linkAccount, linkGoogleAccount } from "@/api/auth";
import { getMe } from "@/api/auth";
import GoogleSignIn from "@/components/GoogleSignIn";
import { useAuthStore } from "@/store/authStore";
import {
  listMyPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  uploadQrImage,
} from "@/api/paymentMethods";
import type { PaymentMethod } from "@/types";
import { resolveUploadUrl } from "@/utils/uploads";
import { fetchVietBanks, buildVietQrUrl, type VietBank } from "@/utils/vietnamBanks";

export default function Profile() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { setUser } = useAuthStore();

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [savingName, setSavingName] = useState(false);

  // Upgrade form
  const [upgradeEmail, setUpgradeEmail] = useState("");
  const [upgradePassword, setUpgradePassword] = useState("");
  const [upgrading, setUpgrading] = useState(false);

  // Link existing account form
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPassword, setLinkPassword] = useState("");
  const [linking, setLinking] = useState(false);

  // Payment methods
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formLabel, setFormLabel] = useState("");
  const [formBankBin, setFormBankBin] = useState("");
  const [formBankName, setFormBankName] = useState("");
  const [formAccountNumber, setFormAccountNumber] = useState("");
  const [formAccountHolder, setFormAccountHolder] = useState("");
  const [formNote, setFormNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [qrModal, setQrModal] = useState<string | null>(null);
  const [formQrFile, setFormQrFile] = useState<File | null>(null);
  const [formQrPreview, setFormQrPreview] = useState<string | null>(null);
  const formQrInputRef = useRef<HTMLInputElement | null>(null);

  const [vietBanks, setVietBanks] = useState<VietBank[]>([]);

  const qrInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    fetchVietBanks().then(setVietBanks).catch(() => {});
    listMyPaymentMethods()
      .then(setPaymentMethods)
      .catch(() => {/* silently ignore */});
  }, []);

  async function handleSaveName(e: FormEvent) {
    e.preventDefault();
    setSavingName(true);
    try {
      await client.patch("/users/me", { display_name: displayName });
      const updated = await getMe();
      setUser(updated);
      window.alert("Display name updated!");
    } catch {
      window.alert("Failed to update display name");
    } finally {
      setSavingName(false);
    }
  }

  async function handleUpgrade(e: FormEvent) {
    e.preventDefault();
    setUpgrading(true);
    try {
      const tokens = await upgrade({
        email: upgradeEmail,
        password: upgradePassword,
      });
      localStorage.setItem("access_token", tokens.access_token);
      localStorage.setItem("refresh_token", tokens.refresh_token);
      const updated = await getMe();
      setUser(updated);
      window.alert("Account upgraded! You can now log in with your email.");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to upgrade account";
      window.alert(msg);
    } finally {
      setUpgrading(false);
    }
  }

  async function handleLinkAccount(e: FormEvent) {
    e.preventDefault();
    setLinking(true);
    try {
      const tokens = await linkAccount({ email: linkEmail, password: linkPassword });
      localStorage.setItem("access_token", tokens.access_token);
      localStorage.setItem("refresh_token", tokens.refresh_token);
      const updated = await getMe();
      setUser(updated);
      window.alert("Account linked! You are now logged in as your verified account.");
      navigate("/dashboard");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to link account";
      window.alert(msg);
    } finally {
      setLinking(false);
    }
  }

  async function handleLinkGoogle(credential: string) {
    setLinking(true);
    try {
      const tokens = await linkGoogleAccount(credential);
      localStorage.setItem("access_token", tokens.access_token);
      localStorage.setItem("refresh_token", tokens.refresh_token);
      const updated = await getMe();
      setUser(updated);
      window.alert("Account linked via Google! You are now logged in as your verified account.");
      navigate("/dashboard");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to link Google account";
      window.alert(msg);
    } finally {
      setLinking(false);
    }
  }

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setFormLabel("");
    setFormBankBin("");
    setFormBankName("");
    setFormAccountNumber("");
    setFormAccountHolder("");
    setFormNote("");
    setFormQrFile(null);
    setFormQrPreview(null);
  }

  function openAddForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(pm: PaymentMethod) {
    setEditingId(pm.id);
    setFormLabel(pm.label);
    setFormBankBin(pm.bank_bin ?? "");
    setFormBankName(pm.bank_name ?? "");
    setFormAccountNumber(pm.account_number ?? "");
    setFormAccountHolder(pm.account_holder ?? "");
    setFormNote(pm.note ?? "");
    setShowForm(true);
  }

  async function handleSavePaymentMethod(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      let result: PaymentMethod;
      if (editingId) {
        result = await updatePaymentMethod(editingId, {
          label: formLabel,
          bank_name: formBankName || null,
          bank_bin: formBankBin || null,
          account_number: formAccountNumber || null,
          account_holder: formAccountHolder || null,
          note: formNote || null,
        });
        if (formQrFile) result = await uploadQrImage(result.id, formQrFile);
        setPaymentMethods((prev) => prev.map((pm) => (pm.id === editingId ? result : pm)));
      } else {
        result = await createPaymentMethod({
          label: formLabel,
          bank_name: formBankName || null,
          bank_bin: formBankBin || null,
          account_number: formAccountNumber || null,
          account_holder: formAccountHolder || null,
          note: formNote || null,
        });
        if (formQrFile) result = await uploadQrImage(result.id, formQrFile);
        setPaymentMethods((prev) => [...prev, result]);
      }
      resetForm();
    } catch {
      window.alert("Failed to save payment method");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePaymentMethod(id: string) {
    if (!window.confirm("Delete this payment method?")) return;
    try {
      await deletePaymentMethod(id);
      setPaymentMethods((prev) => prev.filter((pm) => pm.id !== id));
    } catch {
      window.alert("Failed to delete payment method");
    }
  }

  async function handleQrUpload(id: string, file: File) {
    try {
      const updated = await uploadQrImage(id, file);
      setPaymentMethods((prev) => prev.map((pm) => (pm.id === id ? updated : pm)));
    } catch {
      window.alert("Failed to upload QR image");
    }
  }

  if (!user) return null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-outline hover:text-on-surface-variant">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-on-surface">Profile</h1>
      </div>

      <div className="max-w-lg space-y-6">
        {/* Avatar + name */}
        <section className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full bg-primary-container/30 flex items-center justify-center">
              {user.avatar_url ? (
                <img
                  src={resolveUploadUrl(user.avatar_url)!}
                  alt={user.display_name}
                  className="w-16 h-16 rounded-full object-cover"
                />
              ) : (
                <User size={28} className="text-primary" />
              )}
            </div>
            <div>
              <p className="text-lg font-semibold text-on-surface">{user.display_name}</p>
              {user.is_verified && user.email ? (
                <p className="text-sm text-on-surface-variant">{user.email}</p>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-on-tertiary-container bg-tertiary-container/20 px-2 py-0.5 rounded-full">
                  Guest account
                </span>
              )}
            </div>
          </div>

          <form onSubmit={handleSaveName} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">Display name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            {user.is_verified && (
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Email</label>
                <p className="text-sm text-on-surface-variant bg-surface rounded-lg px-3 py-2.5">
                  {user.email}
                </p>
              </div>
            )}
            <button
              type="submit"
              disabled={savingName}
              className="w-full bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold py-3 rounded-full text-sm transition-colors"
            >
              {savingName ? "Saving..." : "Save Changes"}
            </button>
          </form>
        </section>

        {/* Upgrade section for guests */}
        {!user.is_verified && (
          <section className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6">
            <div className="flex items-center gap-2 mb-1">
              <Shield size={18} className="text-primary" />
              <h2 className="text-base font-semibold text-on-surface">Upgrade to Full Account</h2>
            </div>
            <p className="text-sm text-on-surface-variant mb-4">
              Add an email and password to keep your data across devices and never lose access.
            </p>
            <form onSubmit={handleUpgrade} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={upgradeEmail}
                  onChange={(e) => setUpgradeEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={upgradePassword}
                  onChange={(e) => setUpgradePassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <button
                type="submit"
                disabled={upgrading}
                className="w-full bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold py-3 rounded-full text-sm transition-colors"
              >
                {upgrading ? "Upgrading..." : "Upgrade Account"}
              </button>
            </form>
          </section>
        )}

        {/* Link to existing account — for guests who already have a verified account */}
        {!user.is_verified && (
          <section className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6">
            <div className="flex items-center gap-2 mb-1">
              <Link2 size={18} className="text-primary" />
              <h2 className="text-base font-semibold text-on-surface">Link to Existing Account</h2>
            </div>
            <p className="text-sm text-on-surface-variant mb-4">
              Already have an account? Sign in below to merge this guest account into your existing one.
              All your groups, expenses, and balances will be transferred.
            </p>

            <div className="mb-4">
              <GoogleSignIn onCredential={handleLinkGoogle} disabled={linking} />
            </div>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-outline-variant/15" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-surface-container-lowest px-3 text-outline font-medium">or use email</span>
              </div>
            </div>

            <form onSubmit={handleLinkAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={linkEmail}
                  onChange={(e) => setLinkEmail(e.target.value)}
                  placeholder="your-existing@email.com"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5">Password</label>
                <input
                  type="password"
                  required
                  value={linkPassword}
                  onChange={(e) => setLinkPassword(e.target.value)}
                  placeholder="Your account password"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <button
                type="submit"
                disabled={linking}
                className="w-full bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold py-3 rounded-full text-sm transition-colors"
              >
                {linking ? "Linking..." : "Link Account"}
              </button>
            </form>
          </section>
        )}

        {/* Payment Methods */}
        <section className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-on-surface">Payment Methods</h2>
            {!showForm && (
              <button
                onClick={openAddForm}
                className="flex items-center gap-1.5 text-sm text-primary hover:text-primary font-medium"
              >
                <Plus size={16} />
                Add
              </button>
            )}
          </div>

          {/* Inline form */}
          {showForm && (
            <form onSubmit={handleSavePaymentMethod} className="space-y-3 mb-5 p-4 rounded-xl bg-surface border border-outline-variant/15">
              <h3 className="text-sm font-semibold text-on-surface">
                {editingId ? "Edit Payment Method" : "New Payment Method"}
              </h3>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">
                  Label <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder="e.g. Kaspi, Bank Transfer"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Vietnamese Bank (VietQR)</label>
                <select
                  value={formBankBin}
                  onChange={(e) => {
                    const bin = e.target.value;
                    setFormBankBin(bin);
                    if (bin) {
                      const bank = vietBanks.find((b) => b.bin === bin);
                      if (bank) {
                        setFormBankName(bank.shortName);
                        if (!formLabel) setFormLabel(bank.shortName);
                      }
                    }
                  }}
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                >
                  <option value="">Not a Vietnamese bank</option>
                  {vietBanks.map((b) => (
                    <option key={b.bin} value={b.bin}>{b.shortName} — {b.name}</option>
                  ))}
                </select>
                <p className="text-xs text-outline mt-1">
                  {formBankBin ? "QR code with amount will be auto-generated via VietQR" : "Select a bank to enable VietQR, or leave empty for other banks"}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Bank Name</label>
                <input
                  type="text"
                  value={formBankName}
                  onChange={(e) => setFormBankName(e.target.value)}
                  placeholder={formBankBin ? "Auto-filled from selection above" : "e.g. PayPal, Wise, etc."}
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Account Number</label>
                <input
                  type="text"
                  value={formAccountNumber}
                  onChange={(e) => setFormAccountNumber(e.target.value)}
                  placeholder="e.g. +7 777 123 4567"
                  className="w-full border border-outline-variant/15 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Account Holder</label>
                <input
                  type="text"
                  value={formAccountHolder}
                  onChange={(e) => setFormAccountHolder(e.target.value)}
                  placeholder="Full name"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Note</label>
                <input
                  type="text"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder="Optional instructions"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              {/* QR section: auto-generated for VietQR banks, manual upload for others */}
              {formBankBin && formAccountNumber ? (
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">QR Preview (auto-generated)</label>
                  <img
                    src={buildVietQrUrl({ bankBin: formBankBin, accountNumber: formAccountNumber })}
                    alt="VietQR preview"
                    className="w-32 h-32 rounded-xl border border-outline-variant/15"
                  />
                  <p className="text-xs text-primary mt-1">QR will be auto-generated with amount when others view it</p>
                </div>
              ) : !formBankBin ? (
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">QR Code Image</label>
                  <input
                    ref={formQrInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setFormQrFile(file);
                        setFormQrPreview(URL.createObjectURL(file));
                      }
                      e.target.value = "";
                    }}
                  />
                  <div className="flex items-center gap-3">
                    {formQrPreview ? (
                      <img src={formQrPreview} alt="QR preview" className="w-16 h-16 rounded-lg object-cover border border-outline-variant/15" />
                    ) : editingId && paymentMethods.find((pm) => pm.id === editingId)?.qr_image_url ? (
                      <img src={resolveUploadUrl(paymentMethods.find((pm) => pm.id === editingId)!.qr_image_url)!} alt="Current QR" className="w-16 h-16 rounded-lg object-cover border border-outline-variant/15" />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => formQrInputRef.current?.click()}
                      className="flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-primary border border-outline-variant/15 hover:border-primary-container px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Upload size={14} />
                      {formQrPreview || (editingId && paymentMethods.find((pm) => pm.id === editingId)?.qr_image_url) ? "Change QR" : "Upload QR"}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold py-2.5 rounded-full text-sm transition-colors"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold py-2.5 rounded-full text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* List */}
          {paymentMethods.length === 0 && !showForm ? (
            <p className="text-sm text-outline text-center py-4">
              No payment methods yet. Add one so group members know how to pay you.
            </p>
          ) : (
            <ul className="space-y-3">
              {paymentMethods.map((pm) => (
                <li
                  key={pm.id}
                  className="rounded-xl bg-surface-container/30 px-4 py-3 flex gap-3 items-start"
                >
                  {/* QR thumbnail — auto-generated for VietQR, uploaded for others */}
                  <div className="flex-shrink-0">
                    {pm.bank_bin && pm.account_number ? (
                      <button
                        type="button"
                        onClick={() => setQrModal(buildVietQrUrl({ bankBin: pm.bank_bin!, accountNumber: pm.account_number! }))}
                        className="block w-14 h-14 rounded-lg overflow-hidden border border-outline-variant/15 hover:opacity-80 transition-opacity"
                        title="View VietQR"
                      >
                        <img
                          src={buildVietQrUrl({ bankBin: pm.bank_bin!, accountNumber: pm.account_number! })}
                          alt="VietQR"
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : pm.qr_image_url ? (
                      <button
                        type="button"
                        onClick={() => setQrModal(resolveUploadUrl(pm.qr_image_url))}
                        className="block w-14 h-14 rounded-lg overflow-hidden border border-outline-variant/15 hover:opacity-80 transition-opacity"
                        title="View QR code"
                      >
                        <img
                          src={resolveUploadUrl(pm.qr_image_url)!}
                          alt="QR"
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="w-14 h-14 rounded-lg border border-dashed border-outline-variant/15 flex items-center justify-center bg-surface">
                        <Upload size={18} className="text-outline-variant" />
                      </div>
                    )}
                    {/* Upload button only for non-VietQR methods */}
                    {!pm.bank_bin && (
                      <>
                        <input
                          ref={(el) => { qrInputRefs.current[pm.id] = el; }}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleQrUpload(pm.id, file);
                            e.target.value = "";
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => qrInputRefs.current[pm.id]?.click()}
                          className="mt-1 w-14 text-center text-xs text-outline hover:text-primary transition-colors"
                          title="Upload QR image"
                        >
                          {pm.qr_image_url ? "Change" : "Upload"}
                        </button>
                      </>
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-on-surface">{pm.label}</p>
                    {pm.bank_name && (
                      <p className="text-xs text-on-surface-variant">{pm.bank_name}</p>
                    )}
                    {pm.account_number && (
                      <p className="text-xs font-mono text-on-surface mt-0.5">{pm.account_number}</p>
                    )}
                    {pm.account_holder && (
                      <p className="text-xs text-on-surface-variant">{pm.account_holder}</p>
                    )}
                    {pm.note && (
                      <p className="text-xs italic text-outline mt-0.5">{pm.note}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditForm(pm)}
                      className="text-outline hover:text-tertiary transition-colors"
                      title="Edit"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePaymentMethod(pm.id)}
                      className="text-outline hover:text-error transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* QR full-size modal */}
      {qrModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setQrModal(null)}
        >
          <img
            src={qrModal}
            alt="QR code"
            className="max-w-xs max-h-[80vh] rounded-xl shadow-editorial-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
