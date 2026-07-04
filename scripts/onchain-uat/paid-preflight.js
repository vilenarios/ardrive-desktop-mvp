/*
 * PAID-UPLOAD PREFLIGHT (read-only, spends NOTHING).
 * Confirms the Turbo cost quote for a ~115 KiB file and reads ikry balance.
 * turbo-gateway.com only.
 */
'use strict';
process.env.ARDRIVE_GATEWAY_HOST = 'turbo-gateway.com';
const c = require('./common');

const FILE_BYTES = 117760;             // ~115 KiB, over the 107520 free-tier line
const HARD_CAP_WINC = 500000000000n;   // 0.5 credit runaway guard

(async () => {
  const { TurboFactory } = require('@ardrive/turbo-sdk');
  const tm = c.getTurboManager();

  const quote = await tm.getUploadCosts(FILE_BYTES);
  const wincQuote = String(quote.winc);
  const credQuote = (Number(wincQuote) / 1e12).toFixed(9);

  const ikryUnauth = String((await TurboFactory.unauthenticated().getBalance(c.IKRY_ADDRESS)).winc);

  c.section('PAID PREFLIGHT (no spend)');
  console.log(JSON.stringify({
    gateway: 'turbo-gateway.com',
    fileBytes: FILE_BYTES,
    freeTierBytes: c.FREE_TIER_BYTES,
    overFreeTier: FILE_BYTES > c.FREE_TIER_BYTES,
    costQuoteWinc: wincQuote,
    costQuoteCredits: credQuote,
    hardCapWinc: HARD_CAP_WINC.toString(),
    underHardCap: BigInt(wincQuote) <= HARD_CAP_WINC,
    ikryBalanceWinc: ikryUnauth,
    ikryBalanceExpected: c.IKRY_TURBO_BALANCE_EXPECTED,
    ikryMatchesExpected: ikryUnauth === c.IKRY_TURBO_BALANCE_EXPECTED,
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error('PREFLIGHT FATAL:', e && e.stack ? e.stack : e); process.exit(1); });
