export interface VietBank {
  bin: string;
  name: string;
  shortName: string;
  logo: string;
  transferSupported: boolean;
}

const CACHE_KEY = "chia_vietqr_banks";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

let memoryCache: VietBank[] | null = null;

/**
 * Fetch Vietnamese banks from VietQR API.
 * Caches in localStorage for 24h with in-memory fallback.
 */
export async function fetchVietBanks(): Promise<VietBank[]> {
  // In-memory cache (fastest)
  if (memoryCache) return memoryCache;

  // localStorage cache
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL && Array.isArray(data) && data.length > 0) {
        memoryCache = data;
        return data;
      }
    }
  } catch { /* ignore parse errors */ }

  // Fetch from API
  try {
    const res = await fetch("https://api.vietqr.io/v2/banks");
    const json = await res.json();
    if (json.code === "00" && Array.isArray(json.data)) {
      const banks: VietBank[] = json.data
        .filter((b: { transferSupported: number }) => b.transferSupported === 1)
        .map((b: { bin: string; name: string; shortName: string; logo: string; transferSupported: number }) => ({
          bin: b.bin,
          name: b.name,
          shortName: b.shortName,
          logo: b.logo,
          transferSupported: b.transferSupported === 1,
        }))
        .sort((a: VietBank, b: VietBank) => a.shortName.localeCompare(b.shortName));

      memoryCache = banks;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data: banks, ts: Date.now() }));
      } catch { /* storage full */ }
      return banks;
    }
  } catch { /* network error — fall through to fallback */ }

  // Hardcoded fallback (in case API is down)
  const fallback: VietBank[] = [
    { bin: "970416", name: "Ngân hàng TMCP Á Châu", shortName: "ACB", logo: "https://api.vietqr.io/img/ACB.png", transferSupported: true },
    { bin: "970405", name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam", shortName: "Agribank", logo: "https://api.vietqr.io/img/VBA.png", transferSupported: true },
    { bin: "970418", name: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam", shortName: "BIDV", logo: "https://api.vietqr.io/img/BIDV.png", transferSupported: true },
    { bin: "970422", name: "Ngân hàng TMCP Quân Đội", shortName: "MB Bank", logo: "https://api.vietqr.io/img/MB.png", transferSupported: true },
    { bin: "970407", name: "Ngân hàng TMCP Kỹ Thương Việt Nam", shortName: "Techcombank", logo: "https://api.vietqr.io/img/TCB.png", transferSupported: true },
    { bin: "970423", name: "Ngân hàng TMCP Tiên Phong", shortName: "TPBank", logo: "https://api.vietqr.io/img/TPB.png", transferSupported: true },
    { bin: "970436", name: "Ngân hàng TMCP Ngoại thương Việt Nam", shortName: "Vietcombank", logo: "https://api.vietqr.io/img/VCB.png", transferSupported: true },
    { bin: "970415", name: "Ngân hàng TMCP Công Thương Việt Nam", shortName: "VietinBank", logo: "https://api.vietqr.io/img/ICB.png", transferSupported: true },
    { bin: "970432", name: "Ngân hàng TMCP Việt Nam Thịnh Vượng", shortName: "VPBank", logo: "https://api.vietqr.io/img/VPB.png", transferSupported: true },
  ];
  memoryCache = fallback;
  return fallback;
}

/**
 * Look up a bank by BIN from the cached list.
 */
export function findBankByBin(banks: VietBank[], bin: string): VietBank | undefined {
  return banks.find((b) => b.bin === bin);
}

/**
 * Build a VietQR image URL.
 * @see https://www.vietqr.io/en/specification
 */
export function buildVietQrUrl(opts: {
  bankBin: string;
  accountNumber: string;
  amount?: number;
  message?: string;
  template?: string;
}): string {
  const { bankBin, accountNumber, amount, message, template = "compact2" } = opts;
  const base = `https://img.vietqr.io/image/${bankBin}-${accountNumber}-${template}.png`;
  const params = new URLSearchParams();
  if (amount && amount > 0) params.set("amount", String(Math.round(amount)));
  if (message) params.set("addInfo", message);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
