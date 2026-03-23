import { useEffect } from "react";
import { X } from "lucide-react";
import type { GroupPaymentMethod } from "@/types";
import PaymentMethodCards from "./PaymentMethodCards";

interface PaymentInfoModalProps {
  memberName: string;
  methods: GroupPaymentMethod[];
  isOpen: boolean;
  onClose: () => void;
  /** When provided, VietQR codes include this amount */
  amount?: number;
  /** Optional message embedded in VietQR */
  qrMessage?: string;
}

export default function PaymentInfoModal({ memberName, methods, isOpen, onClose, amount, qrMessage }: PaymentInfoModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const paymentMethods = methods.map((m) => m.payment_method);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 shadow-editorial-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-on-surface">Payment Info — {memberName}</h3>
          <button onClick={onClose} className="p-1 text-outline hover:text-on-surface-variant rounded-lg hover:bg-surface-container">
            <X size={18} />
          </button>
        </div>
        {paymentMethods.length === 0 ? (
          <p className="text-sm text-outline py-4 text-center">No payment methods shared</p>
        ) : (
          <PaymentMethodCards methods={paymentMethods} amount={amount} qrMessage={qrMessage} />
        )}
      </div>
    </div>
  );
}
