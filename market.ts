import { useEffect, useRef, useState, useCallback } from "react";

export type Ticker = { symbol: string; name: string; sector: string };

export const UNIVERSE: Ticker[] = [
  { symbol: "AAPL", name: "Apple Inc.", sector: "Tech" },
  { symbol: "NVDA", name: "NVIDIA Corp.", sector: "Semis" },
  { symbol: "TSLA", name: "Tesla Inc.", sector: "Auto" },
  { symbol: "MSFT", name: "Microsoft Corp.", sector: "Tech" },
  { symbol: "AMZN", name: "Amazon.com Inc.", sector: "Consumer" },
  { symbol: "META", name: "Meta Platforms", sector: "Tech" },
  { symbol: "GOOGL", name: "Alphabet Inc.", sector: "Tech" },
  { symbol: "AMD", name: "Adv. Micro Devices", sector: "Semis" },
];

const SEED_PRICES: Record<string, number> = {
  AAPL: 228.4, NVDA: 142.7, TSLA: 251.3, MSFT: 421.6,
  AMZN: 198.2, META: 564.9, GOOGL: 178.1, AMD: 138.8,
};
const VOL: Record<string, number> = {
  AAPL: 0.0012, NVDA: 0.0028, TSLA: 0.0035, MSFT: 0.0011,
  AMZN: 0.0018, META: 0.002,  GOOGL: 0.0015, AMD: 0.0026,
};
// sector beta to the macro regime
const SECTOR_BETA: Record<string, number> = {
  Tech: 1.0, Semis: 1.4, Auto: 1.2, Consumer: 0.7,
};

export type BookLevel = { price: number; size: number };
export type Tick = { t: number; mid: number; bid: number; ask: number; vol: number };

export type Quote = {
  symbol: string;
  ticks: Tick[];           // single source of truth (last ~600 ticks)
  bids: BookLevel[];       // top-of-book displayed depth
  asks: BookLevel[];
  prevClose: number;
  open: number;
  borrowable: number;      // shares available to borrow for shorting
  cumVolume: number;
};

export type NewsItem = {
  id: string; time: number; symbol?: string; headline: string;
  tone: "up" | "down" | "neutral" | "alert";
};

/** Positive qty = long, negative = short. avgCost = avg fill price. */
export type Position = { symbol: string; qty: number; avgCost: number };

export type Fill = {
  id: string; symbol: string; side: "BUY" | "SELL";
  qty: number; price: number; topPrice: number;
  slippageBps: number; commission: number; time: number;
  note?: string;
};

export type StopOrder = {
  id: string; symbol: string;
  side: "SELL" | "BUY";       // SELL closes a long; BUY covers a short
  qty: number;
  kind: "STOP_LOSS" | "TAKE_PROFIT";
  trigger: number;             // price level
  createdAt: number;
};

export type EarningsEvent = {
  id: string; symbol: string; scheduledAt: number; triggered: boolean;
};

export type Config = {
  proMode: boolean;
  commissionBps: number;       // 5 = 0.05%
  borrowRateAnnual: number;    // 0.08 = 8%/yr
  maintenanceMarginPct: number;// 0.30
  positionCapPct: number;      // 0.25
};

export type MarketState = {
  quotes: Record<string, Quote>;
  news: NewsItem[];
  cash: number;
  positions: Record<string, Position>;
  fills: Fill[];
  stops: StopOrder[];
  earnings: EarningsEvent[];
  netWorth: number;
  regime: number;              // -1..1 macro factor
  config: Config;
  startCash: number;
};

export type Order = {
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  stopLoss?: number;           // optional trigger
  takeProfit?: number;
};

export type OrderResult =
  | { ok: true; fill: Fill }
  | { ok: false; reason: string };

const INITIAL_CASH = 100_000;

const HEADLINES_UP = [
  "beats consensus on revenue, raises FY guidance",
  "announces $20B buyback program",
  "secures major enterprise contract",
  "wins regulatory approval in EU",
  "upgraded to Buy at Morgan Stanley",
  "reports record quarterly shipments",
];
const HEADLINES_DOWN = [
  "misses on EPS, cuts outlook",
  "faces antitrust probe in Brussels",
  "CFO departs effective immediately",
  "downgraded to Underweight at JPM",
  "warns of softening demand into Q4",
  "delays flagship product launch",
];
const HEADLINES_MACRO = [
  "Fed minutes signal hawkish hold; yields tick higher",
  "Nonfarm payrolls beat: +287K vs 210K est.",
  "CPI prints cooler than expected, risk-on bid",
  "Oil tumbles 3% on inventory build",
  "ECB hints at pause; euro slips",
];

function randn() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeBook(mid: number, sigma: number): { bids: BookLevel[]; asks: BookLevel[] } {
  const spreadUnit = Math.max(0.01, mid * (sigma * 1.5 + Math.random() * sigma));
  const bids: BookLevel[] = [];
  const asks: BookLevel[] = [];
  for (let i = 0; i < 3; i++) {
    bids.push({
      price: +(mid - spreadUnit * (1 + i * 1.3)).toFixed(2),
      size: 100 + Math.floor(Math.random() * 1800) + i * 200,
    });
    asks.push({
      price: +(mid + spreadUnit * (1 + i * 1.3)).toFixed(2),
      size: 100 + Math.floor(Math.random() * 1800) + i * 200,
    });
  }
  return { bids, asks };
}

function initQuote(t: Ticker): Quote {
  const seed = SEED_PRICES[t.symbol];
  const ticks: Tick[] = [];
  let p = seed * (1 - (Math.random() - 0.5) * 0.01);
  const now = Date.now();
  for (let i = 0; i < 120; i++) {
    p = p * (1 + randn() * VOL[t.symbol]);
    const book = makeBook(p, VOL[t.symbol]);
    ticks.push({
      t: now - (120 - i) * 1000,
      mid: +p.toFixed(2),
      bid: book.bids[0].price,
      ask: book.asks[0].price,
      vol: Math.floor(Math.random() * 8000),
    });
  }
  const cur = ticks[ticks.length - 1].mid;
  const book = makeBook(cur, VOL[t.symbol]);
  return {
    symbol: t.symbol,
    ticks,
    bids: book.bids,
    asks: book.asks,
    prevClose: +(seed * (1 + (Math.random() - 0.5) * 0.005)).toFixed(2),
    open: ticks[0].mid,
    borrowable: 5000 + Math.floor(Math.random() * 15000),
    cumVolume: ticks.reduce((a, t) => a + t.vol, 0),
  };
}

/* ---------- public helpers ---------- */
export function midOf(q: Quote) { return q.ticks[q.ticks.length - 1].mid; }
export function midHistory(q: Quote) { return q.ticks.map((t) => t.mid); }

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
/** Bucket ticks → OHLCV candles. Single source of truth for all timeframes. */
export function bucketCandles(ticks: Tick[], ticksPerBucket: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < ticks.length; i += ticksPerBucket) {
    const slice = ticks.slice(i, i + ticksPerBucket);
    if (!slice.length) continue;
    let h = -Infinity, l = Infinity, v = 0;
    for (const t of slice) {
      if (t.mid > h) h = t.mid;
      if (t.mid < l) l = t.mid;
      v += t.vol;
    }
    out.push({ t: slice[0].t, o: slice[0].mid, c: slice[slice.length - 1].mid, h, l, v });
  }
  return out;
}

function walkBook(book: BookLevel[], qty: number): { avgPrice: number; filledQty: number } | null {
  let remaining = qty;
  let cost = 0;
  let filled = 0;
  for (const level of book) {
    const take = Math.min(remaining, level.size);
    cost += take * level.price;
    filled += take;
    remaining -= take;
    if (remaining <= 0) break;
  }
  if (filled === 0) return null;
  // if not fully filled, last level price extended
  if (remaining > 0) {
    const last = book[book.length - 1];
    cost += remaining * (last.price * 1.002);
    filled += remaining;
  }
  return { avgPrice: cost / filled, filledQty: filled };
}

function computeNetWorth(cash: number, positions: Record<string, Position>, quotes: Record<string, Quote>) {
  let v = cash;
  for (const p of Object.values(positions)) {
    const q = quotes[p.symbol]; if (!q) continue;
    const mid = midOf(q);
    if (p.qty >= 0) v += p.qty * mid;
    else v -= Math.abs(p.qty) * mid;
  }
  return v;
}

function shortNotional(positions: Record<string, Position>, quotes: Record<string, Quote>) {
  let s = 0;
  for (const p of Object.values(positions)) {
    if (p.qty < 0) {
      const q = quotes[p.symbol]; if (!q) continue;
      s += Math.abs(p.qty) * midOf(q);
    }
  }
  return s;
}

export function useMarket() {
  const [state, setState] = useState<MarketState>(() => {
    const quotes: Record<string, Quote> = {};
    UNIVERSE.forEach((t) => (quotes[t.symbol] = initQuote(t)));
    return {
      quotes,
      news: [{
        id: "boot", time: Date.now(),
        headline: "Vantage Floor terminal online — synthetic market feed active",
        tone: "neutral",
      }],
      cash: INITIAL_CASH,
      positions: {},
      fills: [],
      stops: [],
      earnings: scheduleInitialEarnings(),
      netWorth: INITIAL_CASH,
      regime: 0,
      startCash: INITIAL_CASH,
      config: {
        proMode: false,
        commissionBps: 5,         // 0.05%
        borrowRateAnnual: 0.08,
        maintenanceMarginPct: 0.30,
        positionCapPct: 0.25,
      },
    };
  });

  const newsShockRef = useRef<Record<string, number>>({});
  const lastBorrowAccrualRef = useRef<number>(Date.now());

  // ---------- price tick ----------
  useEffect(() => {
    const id = setInterval(() => {
      setState((prev) => {
        const now = Date.now();
        // evolve regime: mean-reverting random walk clamped [-1,1]
        const regime = Math.max(-1, Math.min(1, prev.regime * 0.995 + randn() * 0.04));

        const quotes = { ...prev.quotes };
        for (const t of UNIVERSE) {
          const q = quotes[t.symbol];
          const shock = newsShockRef.current[t.symbol] ?? 0;
          const beta = SECTOR_BETA[t.sector] ?? 1;
          const macroDrift = regime * 0.0006 * beta;
          const newsDrift = shock * 0.15;
          newsShockRef.current[t.symbol] = shock * 0.7;
          const cur = midOf(q);
          const next = +(cur * (1 + randn() * VOL[t.symbol] + macroDrift + newsDrift)).toFixed(2);
          const book = makeBook(next, VOL[t.symbol]);
          const tickVol = Math.floor(Math.random() * 8000 * (1 + Math.abs(macroDrift) * 200 + Math.abs(newsDrift) * 50));
          const ticks = q.ticks.concat({
            t: now, mid: next, bid: book.bids[0].price, ask: book.asks[0].price, vol: tickVol,
          }).slice(-300);
          quotes[t.symbol] = {
            ...q, ticks, bids: book.bids, asks: book.asks,
            cumVolume: q.cumVolume + tickVol,
          };
        }

        // earnings trigger
        const newsToAdd: NewsItem[] = [];
        const earnings = prev.earnings.map((e) => {
          if (!e.triggered && now >= e.scheduledAt) {
            // dramatic price shock + headline
            const up = Math.random() < 0.5;
            const mag = 0.04 + Math.random() * 0.05; // 4-9%
            newsShockRef.current[e.symbol] = (newsShockRef.current[e.symbol] ?? 0) + (up ? mag : -mag);
            newsToAdd.push({
              id: crypto.randomUUID(), time: now, symbol: e.symbol,
              headline: `${e.symbol} reports Q-earnings: ${up ? "beats" : "misses"} estimates`,
              tone: "alert",
            });
            return { ...e, triggered: true };
          }
          return e;
        });
        // schedule new ones if we're running low
        const future = earnings.filter((e) => !e.triggered).length;
        const allEarnings = future < 3 ? [...earnings, ...scheduleMoreEarnings(now)] : earnings;

        // evaluate stop orders against the new tick
        let cash = prev.cash;
        let positions = prev.positions;
        const fills = prev.fills;
        let stops = prev.stops;
        const triggeredStops: StopOrder[] = [];
        stops = stops.filter((s) => {
          const q = quotes[s.symbol]; if (!q) return false;
          const px = midOf(q);
          const hit =
            (s.kind === "STOP_LOSS" && s.side === "SELL" && px <= s.trigger) ||
            (s.kind === "TAKE_PROFIT" && s.side === "SELL" && px >= s.trigger) ||
            (s.kind === "STOP_LOSS" && s.side === "BUY" && px >= s.trigger) ||
            (s.kind === "TAKE_PROFIT" && s.side === "BUY" && px <= s.trigger);
          if (hit) { triggeredStops.push(s); return false; }
          return true;
        });
        for (const s of triggeredStops) {
          const r = executeMarketOrder(
            { symbol: s.symbol, side: s.side, qty: s.qty }, quotes, positions, cash, prev.config,
            `${s.kind === "STOP_LOSS" ? "STOP" : "TGT"} @${s.trigger.toFixed(2)}`,
            /* bypassCap */ true,
          );
          if (r.ok) {
            cash = r.newCash;
            positions = r.newPositions;
            fills.unshift(r.fill);
            newsToAdd.push({
              id: crypto.randomUUID(), time: now, symbol: s.symbol,
              headline: `Stop triggered: ${s.side} ${s.qty} ${s.symbol} @ ${r.fill.price.toFixed(2)}`,
              tone: s.kind === "STOP_LOSS" ? "down" : "up",
            });
          }
        }

        // maintenance margin check — force-cover shorts if breached
        const shortN = shortNotional(positions, quotes);
        if (shortN > 0) {
          const equity = computeNetWorth(cash, positions, quotes);
          const required = prev.config.maintenanceMarginPct * shortN;
          if (equity < required) {
            // liquidate largest short first
            const shortPos = Object.values(positions)
              .filter((p) => p.qty < 0)
              .sort((a, b) => Math.abs(b.qty) * midOf(quotes[b.symbol]) - Math.abs(a.qty) * midOf(quotes[a.symbol]));
            for (const p of shortPos) {
              const r = executeMarketOrder(
                { symbol: p.symbol, side: "BUY", qty: Math.abs(p.qty) },
                quotes, positions, cash, prev.config, "MARGIN CALL", true,
              );
              if (r.ok) {
                cash = r.newCash;
                positions = r.newPositions;
                fills.unshift(r.fill);
                newsToAdd.push({
                  id: crypto.randomUUID(), time: now, symbol: p.symbol,
                  headline: `MARGIN CALL: forced cover ${Math.abs(p.qty)} ${p.symbol} @ ${r.fill.price.toFixed(2)}`,
                  tone: "alert",
                });
                const newEq = computeNetWorth(cash, positions, quotes);
                const newReq = prev.config.maintenanceMarginPct * shortNotional(positions, quotes);
                if (newEq >= newReq) break;
              }
            }
          }
        }

        // borrow interest — accrue every 10s of real time
        if (now - lastBorrowAccrualRef.current >= 10_000) {
          lastBorrowAccrualRef.current = now;
          const dailyRate = prev.config.borrowRateAnnual / 365;
          const perTickFactor = dailyRate * (10 / 86400); // 10s portion of day
          for (const p of Object.values(positions)) {
            if (p.qty < 0) {
              const notional = Math.abs(p.qty) * midOf(quotes[p.symbol]);
              cash -= notional * perTickFactor;
            }
          }
        }

        const netWorth = computeNetWorth(cash, positions, quotes);
        return {
          ...prev, regime, quotes, cash, positions, fills: fills.slice(0, 100), stops,
          earnings: allEarnings,
          news: [...newsToAdd, ...prev.news].slice(0, 60),
          netWorth,
        };
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ---------- news ----------
  useEffect(() => {
    const id = setInterval(() => {
      const macro = Math.random() < 0.25;
      let item: NewsItem;
      if (macro) {
        item = {
          id: crypto.randomUUID(), time: Date.now(),
          headline: HEADLINES_MACRO[Math.floor(Math.random() * HEADLINES_MACRO.length)],
          tone: "alert",
        };
        const dir = Math.random() < 0.5 ? -1 : 1;
        for (const t of UNIVERSE) {
          newsShockRef.current[t.symbol] = (newsShockRef.current[t.symbol] ?? 0) + dir * 0.004;
        }
        // also nudge regime
        setState((p) => ({ ...p, regime: Math.max(-1, Math.min(1, p.regime + dir * 0.15)) }));
      } else {
        const t = UNIVERSE[Math.floor(Math.random() * UNIVERSE.length)];
        const up = Math.random() < 0.5;
        const phrase = up
          ? HEADLINES_UP[Math.floor(Math.random() * HEADLINES_UP.length)]
          : HEADLINES_DOWN[Math.floor(Math.random() * HEADLINES_DOWN.length)];
        item = {
          id: crypto.randomUUID(), time: Date.now(), symbol: t.symbol,
          headline: `${t.symbol} ${phrase}`, tone: up ? "up" : "down",
        };
        newsShockRef.current[t.symbol] = (newsShockRef.current[t.symbol] ?? 0) + (up ? 0.012 : -0.012);
      }
      setState((prev) => ({ ...prev, news: [item, ...prev.news].slice(0, 60) }));
    }, 9000 + Math.random() * 6000);
    return () => clearInterval(id);
  }, []);

  // ---------- public mutations ----------
  const submitOrder = useCallback((order: Order): OrderResult => {
    let result: OrderResult = { ok: false, reason: "unknown" };
    setState((prev) => {
      const r = executeMarketOrder(order, prev.quotes, prev.positions, prev.cash, prev.config);
      if (!r.ok) { result = { ok: false, reason: r.reason }; return prev; }
      result = { ok: true, fill: r.fill };
      // also create stop orders if requested
      const stops = [...prev.stops];
      const pos = r.newPositions[order.symbol];
      if (pos) {
        if (order.stopLoss && order.stopLoss > 0) {
          stops.push({
            id: crypto.randomUUID(), symbol: order.symbol,
            side: pos.qty > 0 ? "SELL" : "BUY",
            qty: Math.abs(pos.qty),
            kind: "STOP_LOSS",
            trigger: order.stopLoss,
            createdAt: Date.now(),
          });
        }
        if (order.takeProfit && order.takeProfit > 0) {
          stops.push({
            id: crypto.randomUUID(), symbol: order.symbol,
            side: pos.qty > 0 ? "SELL" : "BUY",
            qty: Math.abs(pos.qty),
            kind: "TAKE_PROFIT",
            trigger: order.takeProfit,
            createdAt: Date.now(),
          });
        }
      }
      const netWorth = computeNetWorth(r.newCash, r.newPositions, prev.quotes);
      return {
        ...prev,
        cash: r.newCash,
        positions: r.newPositions,
        fills: [r.fill, ...prev.fills].slice(0, 100),
        stops,
        netWorth,
      };
    });
    return result;
  }, []);

  const cancelStop = useCallback((id: string) => {
    setState((p) => ({ ...p, stops: p.stops.filter((s) => s.id !== id) }));
  }, []);

  const toggleProMode = useCallback(() => {
    setState((p) => ({ ...p, config: { ...p.config, proMode: !p.config.proMode } }));
  }, []);

  return { state, submitOrder, cancelStop, toggleProMode };
}

/* ---------- order execution (pure-ish) ---------- */
function executeMarketOrder(
  order: Order,
  quotes: Record<string, Quote>,
  positions: Record<string, Position>,
  cash: number,
  cfg: Config,
  note?: string,
  bypassCap = false,
):
  | { ok: true; fill: Fill; newCash: number; newPositions: Record<string, Position> }
  | { ok: false; reason: string }
{
  const q = quotes[order.symbol];
  if (!q) return { ok: false, reason: "Unknown symbol" };
  if (!Number.isFinite(order.qty) || order.qty <= 0) return { ok: false, reason: "Invalid quantity" };
  const book = order.side === "BUY" ? q.asks : q.bids;
  const top = book[0].price;
  const walk = walkBook(book, order.qty);
  if (!walk) return { ok: false, reason: "No liquidity" };
  const avgPrice = +walk.avgPrice.toFixed(4);
  const filledQty = walk.filledQty;
  const grossNotional = avgPrice * filledQty;
  const commission = +(grossNotional * (cfg.commissionBps / 10000)).toFixed(2);
  const slippageBps = ((avgPrice - top) / top) * 10000 * (order.side === "BUY" ? 1 : -1);

  const newPositions = { ...positions };
  const cur = newPositions[order.symbol];
  let newCash = cash;

  if (order.side === "BUY") {
    // covering a short (cur.qty < 0) or adding long
    const willBeLongDelta = filledQty;
    const newQty = (cur?.qty ?? 0) + willBeLongDelta;
    const isOpeningLong = newQty > 0 && (!cur || cur.qty >= 0);
    if (!bypassCap && !cfg.proMode && isOpeningLong) {
      const netWorth = computeNetWorth(cash, positions, quotes);
      if (grossNotional > netWorth * cfg.positionCapPct) {
        return { ok: false, reason: `Position cap: max ${(cfg.positionCapPct * 100).toFixed(0)}% of net worth (Pro Mode to override)` };
      }
    }
    if (grossNotional + commission > cash + (cur && cur.qty < 0 ? 0 : 0)) {
      return { ok: false, reason: "Insufficient cash" };
    }
    newCash -= grossNotional + commission;
    if (!cur) {
      newPositions[order.symbol] = { symbol: order.symbol, qty: filledQty, avgCost: avgPrice };
    } else if (cur.qty >= 0) {
      const totalQty = cur.qty + filledQty;
      newPositions[order.symbol] = {
        symbol: order.symbol, qty: totalQty,
        avgCost: (cur.avgCost * cur.qty + avgPrice * filledQty) / totalQty,
      };
    } else {
      // covering short
      const shortAbs = Math.abs(cur.qty);
      const cover = Math.min(shortAbs, filledQty);
      const restoreBorrow = quotes[order.symbol];
      restoreBorrow.borrowable += cover;
      const newQ = cur.qty + filledQty; // moves toward zero or positive
      if (newQ === 0) {
        delete newPositions[order.symbol];
      } else if (newQ < 0) {
        newPositions[order.symbol] = { ...cur, qty: newQ };
      } else {
        // flipped from short to long
        newPositions[order.symbol] = { symbol: order.symbol, qty: newQ, avgCost: avgPrice };
      }
    }
  } else {
    // SELL: closing long, or opening/adding short
    const longQty = cur && cur.qty > 0 ? cur.qty : 0;
    const closeQty = Math.min(longQty, filledQty);
    const shortQty = filledQty - closeQty;
    if (shortQty > 0) {
      // need borrow inventory
      if (q.borrowable < shortQty) {
        return { ok: false, reason: `Borrow unavailable: ${q.borrowable} shares left` };
      }
      if (!bypassCap && !cfg.proMode) {
        const netWorth = computeNetWorth(cash, positions, quotes);
        const shortNotional = avgPrice * shortQty;
        if (shortNotional > netWorth * cfg.positionCapPct) {
          return { ok: false, reason: `Position cap: max ${(cfg.positionCapPct * 100).toFixed(0)}% of net worth (Pro Mode to override)` };
        }
      }
    }
    newCash += grossNotional - commission;
    quotes[order.symbol].borrowable -= shortQty;

    if (!cur) {
      // pure short open
      newPositions[order.symbol] = { symbol: order.symbol, qty: -shortQty, avgCost: avgPrice };
    } else if (cur.qty > 0) {
      const remainingLong = cur.qty - closeQty;
      if (remainingLong > 0 && shortQty === 0) {
        newPositions[order.symbol] = { ...cur, qty: remainingLong };
      } else if (remainingLong === 0 && shortQty === 0) {
        delete newPositions[order.symbol];
      } else if (remainingLong === 0 && shortQty > 0) {
        newPositions[order.symbol] = { symbol: order.symbol, qty: -shortQty, avgCost: avgPrice };
      }
    } else {
      // already short: add to short
      const totalAbs = Math.abs(cur.qty) + shortQty;
      newPositions[order.symbol] = {
        symbol: order.symbol, qty: -totalAbs,
        avgCost: (cur.avgCost * Math.abs(cur.qty) + avgPrice * shortQty) / totalAbs,
      };
    }
  }

  const fill: Fill = {
    id: crypto.randomUUID(),
    symbol: order.symbol,
    side: order.side,
    qty: filledQty,
    price: avgPrice,
    topPrice: top,
    slippageBps: +slippageBps.toFixed(1),
    commission,
    time: Date.now(),
    note,
  };
  return { ok: true, fill, newCash, newPositions };
}

/* ---------- earnings scheduling ---------- */
function scheduleInitialEarnings(): EarningsEvent[] {
  const now = Date.now();
  return UNIVERSE.slice(0, 4).map((t, i) => ({
    id: crypto.randomUUID(),
    symbol: t.symbol,
    scheduledAt: now + (90 + i * 60 + Math.random() * 40) * 1000,
    triggered: false,
  }));
}
function scheduleMoreEarnings(now: number): EarningsEvent[] {
  const pick = UNIVERSE[Math.floor(Math.random() * UNIVERSE.length)];
  return [{
    id: crypto.randomUUID(),
    symbol: pick.symbol,
    scheduledAt: now + (120 + Math.random() * 180) * 1000,
    triggered: false,
  }];
}

/* ---------- session clock ---------- */
export function useMarketSession() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) {
    return { mounted: false, isOpen: false, countdown: "--:--:--", countdownLabel: "OPEN", etTime: "--:--:--", weekday: "" };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false,
    weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const hour = parseInt(get("hour"), 10);
  const min = parseInt(get("minute"), 10);
  const sec = parseInt(get("second"), 10);
  const minutes = hour * 60 + min;
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  const isOpen = isWeekday && minutes >= open && minutes < close;
  let target = isOpen ? close : open;
  let label = isOpen ? "CLOSE" : "OPEN";
  if (!isOpen && minutes >= close) { target = open + 24 * 60; label = "OPEN"; }
  const remain = Math.max(0, target * 60 - (minutes * 60 + sec));
  const rh = Math.floor(remain / 3600);
  const rm = Math.floor((remain % 3600) / 60);
  const rs = remain % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    mounted: true, isOpen,
    countdown: `${pad(rh)}:${pad(rm)}:${pad(rs)}`,
    countdownLabel: label,
    etTime: `${pad(hour)}:${pad(min)}:${pad(sec)}`,
    weekday,
  };
}
