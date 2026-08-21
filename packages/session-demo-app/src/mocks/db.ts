/**
 * Deterministic fixture data.
 *
 * Seeded rather than random on purpose: the M5 pixel-diff harness compares a
 * screenshot of the live app against a screenshot of the replay, and any
 * run-to-run variation in the data would show up as a fidelity regression that
 * isn't one. Same seed, same pixels, every run.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x5eed);

const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;

const FIRST = [
  'Ada',
  'Grace',
  'Alan',
  'Katherine',
  'Linus',
  'Barbara',
  'Dennis',
  'Radia',
  'Ken',
  'Margaret',
  'Edsger',
  'Frances',
] as const;

const LAST = [
  'Lovelace',
  'Hopper',
  'Turing',
  'Johnson',
  'Torvalds',
  'Liskov',
  'Ritchie',
  'Perlman',
  'Thompson',
  'Hamilton',
  'Dijkstra',
  'Allen',
] as const;

const PRODUCTS = [
  'Aurora Keyboard',
  'Meridian Display',
  'Cascade Dock',
  'Lumen Desk Lamp',
  'Harbor Headset',
  'Vertex Mouse',
  'Solstice Chair',
  'Atlas Monitor Arm',
  'Beacon Webcam',
  'Quartz SSD 2TB',
] as const;

const REGIONS = ['NA-East', 'NA-West', 'EU-Central', 'EU-North', 'APAC'] as const;

export type OrderStatus = 'paid' | 'pending' | 'refunded' | 'failed';

const STATUSES: readonly OrderStatus[] = [
  'paid',
  'paid',
  'paid',
  'pending',
  'refunded',
  'failed',
];

export interface Order {
  id: string;
  customer: string;
  product: string;
  region: string;
  status: OrderStatus;
  quantity: number;
  total: number;
  placedAt: string;
}

const ORDER_COUNT = 10_000;
const EPOCH = Date.UTC(2026, 6, 1);

export const orders: Order[] = Array.from({ length: ORDER_COUNT }, (_, i) => {
  const quantity = 1 + Math.floor(rand() * 6);
  const unit = 40 + Math.floor(rand() * 460);
  return {
    id: `ORD-${(100000 + i).toString()}`,
    customer: `${pick(FIRST)} ${pick(LAST)}`,
    product: pick(PRODUCTS),
    region: pick(REGIONS),
    status: pick(STATUSES),
    quantity,
    total: quantity * unit,
    placedAt: new Date(EPOCH + i * 6 * 60 * 1000).toISOString(),
  };
});

export interface MetricTile {
  key: string;
  label: string;
  value: string;
  delta: number;
  hint: string;
}

export const metrics: MetricTile[] = [
  {
    key: 'revenue',
    label: 'Revenue',
    value: '$1.84M',
    delta: 12.4,
    hint: 'vs. prior 30 days',
  },
  {
    key: 'orders',
    label: 'Orders',
    value: '10,000',
    delta: 4.1,
    hint: 'vs. prior 30 days',
  },
  {
    key: 'aov',
    label: 'Avg. order value',
    value: '$184.12',
    delta: -2.3,
    hint: 'vs. prior 30 days',
  },
  {
    key: 'refunds',
    label: 'Refund rate',
    value: '3.9%',
    delta: -0.6,
    hint: 'vs. prior 30 days',
  },
];

export interface SeriesPoint {
  label: string;
  value: number;
}

export const revenueSeries: SeriesPoint[] = Array.from({ length: 30 }, (_, i) => ({
  label: new Date(EPOCH + i * 86_400_000).toISOString().slice(5, 10),
  value: Math.round(45_000 + rand() * 35_000 + i * 900),
}));

export const regionSeries: SeriesPoint[] = REGIONS.map((region) => ({
  label: region,
  value: Math.round(120_000 + rand() * 380_000),
}));

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  target: string;
  at: string;
}

export const activity: ActivityItem[] = Array.from({ length: 8 }, (_, i) => ({
  id: `act_${i}`,
  actor: `${pick(FIRST)} ${pick(LAST)}`,
  action: pick(['refunded', 'flagged', 'approved', 'reopened', 'exported'] as const),
  target: `ORD-${(100000 + Math.floor(rand() * ORDER_COUNT)).toString()}`,
  at: new Date(EPOCH + 30 * 86_400_000 - i * 1_800_000).toISOString(),
}));
