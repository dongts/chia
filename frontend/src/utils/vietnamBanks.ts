export interface VietBank {
  bin: string;
  name: string;
  shortName: string;
}

// Source: https://api.vietqr.io/v2/banks
// Top Vietnamese banks by usage
export const VIET_BANKS: VietBank[] = [
  { bin: "970436", name: "Ngân hàng TMCP Ngoại thương Việt Nam", shortName: "Vietcombank" },
  { bin: "970415", name: "Ngân hàng TMCP Công Thương Việt Nam", shortName: "VietinBank" },
  { bin: "970418", name: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam", shortName: "BIDV" },
  { bin: "970405", name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam", shortName: "Agribank" },
  { bin: "970407", name: "Ngân hàng TMCP Kỹ Thương Việt Nam", shortName: "Techcombank" },
  { bin: "970422", name: "Ngân hàng TMCP Quân Đội", shortName: "MB Bank" },
  { bin: "970416", name: "Ngân hàng TMCP Á Châu", shortName: "ACB" },
  { bin: "970432", name: "Ngân hàng TMCP Việt Nam Thịnh Vượng", shortName: "VPBank" },
  { bin: "970423", name: "Ngân hàng TMCP Tiên Phong", shortName: "TPBank" },
  { bin: "970437", name: "Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh", shortName: "HDBank" },
  { bin: "970441", name: "Ngân hàng TMCP Quốc Tế", shortName: "VIB" },
  { bin: "970443", name: "Ngân hàng TMCP Sài Gòn - Hà Nội", shortName: "SHB" },
  { bin: "970403", name: "Ngân hàng TMCP Sài Gòn Thương Tín", shortName: "Sacombank" },
  { bin: "970448", name: "Ngân hàng TMCP Phương Đông", shortName: "OCB" },
  { bin: "970426", name: "Ngân hàng TMCP Hàng Hải Việt Nam", shortName: "MSB" },
  { bin: "970431", name: "Ngân hàng TMCP Xuất Nhập Khẩu Việt Nam", shortName: "Eximbank" },
  { bin: "970406", name: "Ngân hàng TMCP Đông Á", shortName: "DongA Bank" },
  { bin: "970454", name: "Ngân hàng TMCP Bản Việt", shortName: "Viet Capital Bank" },
  { bin: "970449", name: "Ngân hàng TMCP Bưu Điện Liên Việt", shortName: "LPBank" },
  { bin: "970427", name: "Ngân hàng TMCP Việt Á", shortName: "VietABank" },
  { bin: "970429", name: "Ngân hàng TMCP Sài Gòn", shortName: "SCB" },
  { bin: "970414", name: "Ngân hàng TMCP Đại Chúng Việt Nam", shortName: "PVcomBank" },
  { bin: "970452", name: "Ngân hàng TMCP Kiên Long", shortName: "Kienlongbank" },
  { bin: "970430", name: "Ngân hàng TMCP Xăng Dầu Petrolimex", shortName: "PG Bank" },
  { bin: "970400", name: "Ngân hàng TMCP Sài Gòn Công Thương", shortName: "SaigonBank" },
  { bin: "970412", name: "Ngân hàng TMCP Đại Dương", shortName: "OceanBank" },
  { bin: "970440", name: "Ngân hàng TMCP Đông Nam Á", shortName: "SeABank" },
  { bin: "970442", name: "Ngân hàng TMCP An Bình", shortName: "ABBank" },
  { bin: "970458", name: "Ngân hàng TMCP Lộc Phát Việt Nam", shortName: "BaoVietBank" },
  { bin: "970409", name: "Ngân hàng TMCP Bắc Á", shortName: "BacABank" },
  { bin: "970425", name: "Ngân hàng TMCP Nam Á", shortName: "Nam A Bank" },
  { bin: "963388", name: "Ví điện tử MoMo", shortName: "MoMo" },
  { bin: "971005", name: "Ví điện tử ZaloPay", shortName: "ZaloPay" },
];

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
