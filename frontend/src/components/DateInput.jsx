import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usesShamsiCalendar } from '../utils/format.js';
import {
  isoToJalaliParts,
  jalaliDaysInMonth,
  jalaliPartsToIso,
  JALALI_MONTHS_FA,
} from '../utils/jalali.js';

/**
 * Stores Gregorian ISO (YYYY-MM-DD) for the API.
 * Dari/Pashto → Shamsi selectors; English → native Gregorian date input.
 */
export default function DateInput({ value, onChange, required = false }) {
  const { i18n } = useTranslation();
  const shamsi = usesShamsiCalendar();
  void i18n.language;

  const jParts = useMemo(() => (value ? isoToJalaliParts(value) : null), [value]);

  if (!shamsi) {
    return (
      <input
        type="date"
        required={required}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const jy = jParts?.jy || '';
  const jm = jParts?.jm || '';
  const jd = jParts?.jd || '';
  const yearNow = jParts?.jy || (new Date().getFullYear() - 621);
  const years = Array.from({ length: 21 }, (_, i) => yearNow - 10 + i);
  const daysInMonth = jm ? jalaliDaysInMonth(Number(jy || yearNow), Number(jm)) : 31;

  const emit = (nextJy, nextJm, nextJd) => {
    if (!nextJy || !nextJm || !nextJd) {
      onChange('');
      return;
    }
    const maxDay = jalaliDaysInMonth(Number(nextJy), Number(nextJm));
    const day = Math.min(Number(nextJd), maxDay);
    onChange(jalaliPartsToIso(nextJy, nextJm, day));
  };

  return (
    <div className="shamsi-date-input" dir="ltr">
      <select
        required={required}
        aria-label="year"
        value={jy}
        onChange={(e) => emit(e.target.value, jm || 1, jd || 1)}
      >
        <option value="">----</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <select
        required={required}
        aria-label="month"
        value={jm}
        onChange={(e) => emit(jy || yearNow, e.target.value, jd || 1)}
      >
        <option value="">--</option>
        {JALALI_MONTHS_FA.map((name, idx) => (
          <option key={name} value={idx + 1}>{idx + 1} — {name}</option>
        ))}
      </select>
      <select
        required={required}
        aria-label="day"
        value={jd}
        onChange={(e) => emit(jy || yearNow, jm || 1, e.target.value)}
      >
        <option value="">--</option>
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
    </div>
  );
}
