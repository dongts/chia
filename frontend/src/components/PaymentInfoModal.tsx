import { useEffect } from "react";
import { X } from "lucide-react";
import type { GroupPaymentMethod } from "@/types";
import PaymentMethodCards from "./PaymentMethodCards";

interface PaymentInfoModalProps {
  memberName: string;
  methods: GroupPaymentMethod[];
  isOpen: boolean;
  onClose: () => void;
}

export default function PaymentInfoModal({ memberName, methods, isOpen, onClose }: PaymentInfoModalProps) {
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
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Payment Info — {memberName}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        {paymentMethods.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No payment methods shared</p>
        ) : (
          <PaymentMethodCards methods={paymentMethods} />
        )}
      </div>
    </div>
  );
}
