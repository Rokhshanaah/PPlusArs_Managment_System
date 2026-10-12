/** Jalali ↔ Gregorian helpers (no external deps). */

export function gregorianToJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy;
  if (gy > 1600) {
    jy = 979;
    gy -= 1600;
  } else {
    jy = 0;
    gy -= 621;
  }
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = (365 * gy)
    + Math.floor((gy2 + 3) / 4)
    - Math.floor((gy2 + 99) / 100)
    + Math.floor((gy2 + 399) / 400)
    - 80
    + gd
    + g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186
    ? 1 + Math.floor(days / 31)
    : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

export function jalaliToGregorian(jy, jm, jd) {
  let gy;
  if (jy > 979) {
    gy = 1600;
    jy -= 979;
  } else {
    gy = 621;
  }
  const days = (365 * jy)
    + Math.floor(jy / 33) * 8
    + Math.floor(((jy % 33) + 3) / 4)
    + 78
    + jd
    + (jm < 7 ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
  gy += 400 * Math.floor(days / 146097);
  let d = days % 146097;
  if (d > 36524) {
    gy += 100 * Math.floor(--d / 36524);
    d %= 36524;
    if (d >= 365) d += 1;
  }
  gy += 4 * Math.floor(d / 1461);
  d %= 1461;
  if (d > 365) {
    gy += Math.floor((d - 1) / 365);
    d = (d - 1) % 365;
  }
  let gd = d + 1;
  const sal_a = [
    0, 31,
    ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ];
  let gm = 0;
  while (gm < 13 && gd > sal_a[gm]) {
    gd -= sal_a[gm];
    gm += 1;
  }
  return { gy, gm, gd };
}

export function isoToParts(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function partsToIso(y, m, d) {
  if (!y || !m || !d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isoToJalaliParts(iso) {
  const g = isoToParts(iso);
  if (!g) return null;
  return gregorianToJalali(g.y, g.m, g.d);
}

export function jalaliPartsToIso(jy, jm, jd) {
  if (!jy || !jm || !jd) return '';
  const { gy, gm, gd } = jalaliToGregorian(Number(jy), Number(jm), Number(jd));
  return partsToIso(gy, gm, gd);
}

export function todayIsoInKabul() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kabul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const JALALI_MONTHS_FA = [
  'حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله',
  'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت',
];

export function jalaliDaysInMonth(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  // Esfand leap: simplified
  const breaks = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
  ];
  const bl = breaks.length;
  const jp = breaks[0];
  let jump = 0;
  let jy2 = jy;
  if (jy2 < jp || jy2 >= breaks[bl - 1]) {
    return 29;
  }
  let n = jy2 - jp;
  for (let i = 1; i < bl; i += 1) {
    jump = breaks[i] - breaks[i - 1];
    if (n < jump) break;
    n -= jump;
  }
  const leap = ((jump - n) < 6);
  return leap ? 30 : 29;
}
