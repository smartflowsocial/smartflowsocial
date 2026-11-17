/**
 * Builds BOLT11 invoices the project's decoder accepts.
 * The decoder does not verify the signature, so the signature words are zero.
 * These invoices are for tests only.
 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export const FIXTURE_TIMESTAMP_SECONDS = 1_700_000_000;
export const FIXTURE_EXPIRY_SECONDS = 3600;
export const FIXTURE_NOW_MS = FIXTURE_TIMESTAMP_SECONDS * 1000 + 60_000;

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < 5; index += 1) {
      if ((top >> index) & 1) chk ^= GENERATOR[index] ?? 0;
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const expanded: number[] = [];
  for (const char of hrp) expanded.push(char.charCodeAt(0) >> 5);
  expanded.push(0);
  for (const char of hrp) expanded.push(char.charCodeAt(0) & 31);
  return expanded;
}

function checksum(hrp: string, data: number[]): number[] {
  const values = hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  const words: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    words.push((mod >> (5 * (5 - index))) & 31);
  }
  return words;
}

function bech32Encode(hrp: string, data: number[]): string {
  const combined = data.concat(checksum(hrp, data));
  let encoded = `${hrp}1`;
  for (const word of combined) {
    const char = CHARSET[word];
    if (!char) throw new Error("Invalid bech32 word");
    encoded += char;
  }
  return encoded;
}

function convertBits(
  data: Uint8Array,
  fromBits: number,
  toBits: number,
  pad: boolean
): number[] {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << toBits) - 1;
  const out: number[] = [];
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) out.push((acc << (toBits - bits)) & maxv);
  return out;
}

function intToWords(value: number, width?: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("BOLT11 integer is out of range");
  }
  const words: number[] = [];
  let remaining = value;
  do {
    words.push(remaining & 31);
    remaining = Math.floor(remaining / 32);
  } while (remaining > 0);
  words.reverse();
  if (width !== undefined) {
    if (words.length > width) throw new Error("BOLT11 integer does not fit");
    while (words.length < width) words.unshift(0);
  }
  return words;
}

function encodeTag(code: number, dataWords: number[]): number[] {
  const length = dataWords.length;
  if (length >= 1024) throw new Error("BOLT11 tag is too long");
  return [code, (length >> 5) & 31, length & 31, ...dataWords];
}

export interface Bolt11FixtureOptions {
  /** Whole sats. Null builds an amountless invoice. Ignored when millisats is set. */
  amountSats?: number | bigint | null;
  /** Exact millisatoshi amount, including amounts that are not whole sats. */
  millisats?: bigint;
  network?: "bc" | "tb";
  timestampSeconds?: number;
  /** Null omits the expiry tag. Default is one hour. */
  expirySeconds?: number | null;
  /** Null omits the payment hash. Default is a deterministic 32-byte hash. */
  paymentHashHex?: string | null;
}

export function makeBolt11(options: Bolt11FixtureOptions = {}): string {
  const network = options.network ?? "bc";
  const timestamp = options.timestampSeconds ?? FIXTURE_TIMESTAMP_SECONDS;
  const expiry =
    options.expirySeconds === undefined
      ? FIXTURE_EXPIRY_SECONDS
      : options.expirySeconds;
  const paymentHashHex =
    options.paymentHashHex === undefined
      ? "11".repeat(32)
      : options.paymentHashHex;

  let hrp = `ln${network}`;
  if (options.millisats !== undefined) {
    if (options.millisats < 0n || options.millisats % 1n !== 0n) {
      throw new Error("millisats must be a non-negative integer");
    }
    hrp += `${options.millisats * 10n}p`;
  } else if (options.amountSats !== null && options.amountSats !== undefined) {
    const sats = BigInt(options.amountSats);
    if (sats < 0n) throw new Error("amount cannot be negative");
    hrp += `${sats * 10n}n`;
  }

  const words = intToWords(timestamp, 7);
  if (paymentHashHex !== null) {
    if (!/^[0-9a-fA-F]{64}$/.test(paymentHashHex)) {
      throw new Error("payment hash must be 32 bytes of hex");
    }
    const bytes = new Uint8Array(32);
    for (let index = 0; index < 32; index += 1) {
      bytes[index] = Number.parseInt(
        paymentHashHex.slice(index * 2, index * 2 + 2),
        16
      );
    }
    words.push(...encodeTag(1, convertBits(bytes, 8, 5, true)));
  }
  if (expiry !== null) words.push(...encodeTag(6, intToWords(expiry)));
  words.push(...new Array<number>(104).fill(0));
  return bech32Encode(hrp, words);
}

export function invoiceForSats(
  amountSats: number | bigint,
  paymentHashHex = "11".repeat(32)
): string {
  return makeBolt11({ amountSats, paymentHashHex });
}

/** Valid at Date.now(), for callers that do not inject a clock. */
export function freshInvoiceForSats(
  amountSats: number | bigint,
  paymentHashHex = "11".repeat(32)
): string {
  return makeBolt11({
    amountSats,
    paymentHashHex,
    timestampSeconds: Math.floor(Date.now() / 1000) - 30,
    expirySeconds: 3600,
  });
}
