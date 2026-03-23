import { useState, useEffect } from "react";
import { X, Download } from "lucide-react";
import type { PaymentMethod } from "@/types";
import { resolveUploadUrl } from "@/utils/uploads";
import { buildVietQrUrl, fetchVietBanks, type VietBank } from "@/utils/vietnamBanks";

interface PaymentMethodCardsProps {
  methods: PaymentMethod[];
  compact?: boolean;
  /** When provided, VietQR codes include this amount (for settlements/transfers) */
  amount?: number;
  /** Optional message embedded in VietQR */
  qrMessage?: string;
}

function getQrUrl(m: PaymentMethod, amount?: number, qrMessage?: string): string | null {
  // Prefer dynamic VietQR when bank_bin + account_number are available
  if (m.bank_bin && m.account_number) {
    return buildVietQrUrl({
      bankBin: m.bank_bin,
      accountNumber: m.account_number,
      amount,
      message: qrMessage,
    });
  }
  // Fall back to uploaded QR image
  if (m.qr_image_url) {
    return resolveUploadUrl(m.qr_image_url);
  }
  return null;
}

export default function PaymentMethodCards({ methods, compact = false, amount, qrMessage }: PaymentMethodCardsProps) {
  const [viewingQr, setViewingQr] = useState<{ url: string; label: string } | null>(null);
  const [banks, setBanks] = useState<VietBank[]>([]);

  useEffect(() => {
    fetchVietBanks().then(setBanks).catch(() => {});
  }, []);

  if (methods.length === 0) return null;

  function getBankLogo(bankBin: string | null): string | null {
    if (!bankBin) return null;
    return banks.find((b) => b.bin === bankBin)?.logo ?? null;
  }

  async function handleDownload(url: string, label: string) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `QR-${label}.${blob.type.split("/")[1] || "jpg"}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank");
    }
  }

  return (
    <>
      <div className={compact ? "space-y-2" : "space-y-3"}>
        {methods.map((m) => {
          const qrUrl = getQrUrl(m, amount, qrMessage);
          return (
            <div key={m.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <div className="flex items-start gap-3">
                {getBankLogo(m.bank_bin) && (
                <img src={getBankLogo(m.bank_bin)!} alt="" className="w-8 h-8 rounded object-contain flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{m.label}</p>
                  {m.bank_name && <p className="text-xs text-gray-500 mt-0.5">{m.bank_name}</p>}
                  {m.account_number && (
                    <p className="text-sm text-gray-700 mt-1 font-mono">{m.account_number}</p>
                  )}
                  {m.account_holder && (
                    <p className="text-xs text-gray-500 mt-0.5">{m.account_holder}</p>
                  )}
                  {m.note && <p className="text-xs text-gray-400 mt-1 italic">{m.note}</p>}
                </div>
                {qrUrl && (
                  <button
                    type="button"
                    onClick={() => setViewingQr({ url: qrUrl, label: m.label })}
                    className="flex-shrink-0 hover:opacity-80 transition-opacity"
                    title="View QR code"
                  >
                    <img
                      src={qrUrl}
                      alt={`QR for ${m.label}`}
                      className={compact ? "w-16 h-16 rounded object-cover" : "w-24 h-24 rounded-lg object-cover"}
                    />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {viewingQr && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
          onClick={() => setViewingQr(null)}
        >
          <div
            className="relative bg-white rounded-2xl p-4 shadow-2xl max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-900">{viewingQr.label}</p>
              <button
                onClick={() => setViewingQr(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>
            <img
              src={viewingQr.url}
              alt="QR code"
              className="w-full rounded-xl"
            />
            <button
              onClick={() => handleDownload(viewingQr.url, viewingQr.label)}
              className="mt-3 w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              <Download size={16} />
              Save QR Image
            </button>
          </div>
        </div>
      )}
    </>
  );
}
