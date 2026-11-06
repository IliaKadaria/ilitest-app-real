// 7 tiers / 30 divisions. Progression is on account BALANCE (realized), so a
// floating trade never makes your badge flicker.

export interface TierDef {
  key: string;
  name: string; // "Gold Trader"
  /** Medallion gradient + rim + ink for the badge. */
  palette: { a: string; b: string; rim: string; ink: string };
}

export interface Division {
  idx: number; // 0..29
  tier: TierDef;
  roman: string;
  label: string; // "Gold III"
  min: number; // inclusive, EUR
  max: number | null; // exclusive
  symbol: string; // status symbol unlocked
}

export const TIERS: Record<string, TierDef> = {
  bronze: { key: 'bronze', name: 'Bronze Trader', palette: { a: '#6e4a36', b: '#b58466', rim: '#d9b8a3', ink: '#1a110c' } },
  silver: { key: 'silver', name: 'Silver Trader', palette: { a: '#7d838b', b: '#d4d7dc', rim: '#f2f3f5', ink: '#16181b' } },
  gold: { key: 'gold', name: 'Gold Trader', palette: { a: '#8a7a5c', b: '#d8cba9', rim: '#efe6d0', ink: '#1c180f' } }, // champagne, not yellow
  platinum: { key: 'platinum', name: 'Platinum Trader', palette: { a: '#9aa3ad', b: '#eef1f4', rim: '#ffffff', ink: '#14171b' } },
  diamond: { key: 'diamond', name: 'Diamond Trader', palette: { a: '#6f8fa0', b: '#d9eef6', rim: '#f4fbff', ink: '#0d1a20' } },
  syndicate: { key: 'syndicate', name: 'Syndicate Trader', palette: { a: '#141416', b: '#3a3b40', rim: '#c9cbd0', ink: '#e5e5e7' } },
  quant: { key: 'quant', name: 'Quant Trader', palette: { a: '#2b2d4a', b: '#5d7f8f', rim: '#b9c7ff', ink: '#eef2ff' } },
};

type Row = [tier: string, roman: string, min: number, symbol: string];

const ROWS: Row[] = [
  ['bronze', 'III', 0, 'Retail terminal access'],
  ['bronze', 'II', 500, 'Steel field watch'],
  ['bronze', 'I', 1000, 'Leather card holder'],
  ['silver', 'III', 1500, 'Priority execution lane'],
  ['silver', 'II', 2000, 'Tailored navy suit'],
  ['silver', 'I', 3000, 'Members’ lounge pass'],
  ['gold', 'V', 4500, 'Swiss automatic watch'],
  ['gold', 'IV', 6000, 'Business-class upgrades'],
  ['gold', 'III', 8000, 'Private desk seat'],
  ['gold', 'II', 10000, 'Bespoke Savile Row suit'],
  ['gold', 'I', 12000, 'German grand tourer'],
  ['platinum', 'V', 16000, '24/7 concierge line'],
  ['platinum', 'IV', 22000, 'Monaco harbour berth'],
  ['platinum', 'III', 28000, 'Private banker on call'],
  ['platinum', 'II', 35000, 'Mayfair penthouse'],
  ['platinum', 'I', 45000, 'Perpetual-calendar watch'],
  ['diamond', 'V', 60000, 'Fractional jet card'],
  ['diamond', 'IV', 80000, 'Villa on Lake Como'],
  ['diamond', 'III', 120000, 'Chauffeured saloon'],
  ['diamond', 'II', 160000, 'Blue-chip art collection'],
  ['diamond', 'I', 250000, '40 m motor yacht'],
  ['syndicate', 'V', 320000, 'Seat at the syndicate table'],
  ['syndicate', 'IV', 450000, 'Family-office mandate'],
  ['syndicate', 'III', 600000, 'Private island lease'],
  ['syndicate', 'II', 800000, 'Owned midsize jet'],
  ['syndicate', 'I', 1200000, 'Board seats, plural'],
  ['quant', 'IV', 2000000, 'Co-located servers'],
  ['quant', 'III', 3500000, 'Proprietary signal engine'],
  ['quant', 'II', 5000000, 'Your own trading floor'],
  ['quant', 'I', 10000000, 'Designated market maker'],
];

const short = (k: string) => TIERS[k].name.replace(' Trader', '');

export const DIVISIONS: Division[] = ROWS.map(([tier, roman, min, symbol], idx) => ({
  idx,
  tier: TIERS[tier],
  roman,
  label: `${short(tier)} ${roman}`,
  min,
  max: idx + 1 < ROWS.length ? ROWS[idx + 1][2] : null,
  symbol,
}));

export function divisionFor(balance: number): Division {
  let d = DIVISIONS[0];
  for (const x of DIVISIONS) if (balance >= x.min) d = x;
  return d;
}

export function nextDivision(balance: number): Division | null {
  return DIVISIONS.find((d) => d.min > balance) ?? null;
}

/** 0..1 progress through the current division. */
export function divisionProgress(balance: number): number {
  const d = divisionFor(balance);
  if (d.max === null) return 1;
  return Math.max(0, Math.min(1, (balance - d.min) / (d.max - d.min)));
}
