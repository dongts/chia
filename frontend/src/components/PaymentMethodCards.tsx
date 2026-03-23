import type { PaymentMethod } from "@/types";

interface PaymentMethodCardsProps {
  methods: PaymentMethod[];
  compact?: boolean;
}

export default function PaymentMethodCards({ methods, compact = false }: PaymentMethodCardsProps) {
  if (methods.length === 0) return null;

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {methods.map((m) => (
        <div key={m.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
          <div className="flex items-start gap-3">
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
            {m.qr_image_url && (
              <img
                src={m.qr_image_url}
                alt={`QR for ${m.label}`}
                className={compact ? "w-16 h-16 rounded object-cover" : "w-24 h-24 rounded-lg object-cover"}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
