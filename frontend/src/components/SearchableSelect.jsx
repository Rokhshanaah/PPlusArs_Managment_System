import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

/**
 * Select with an inline search filter for long name lists.
 * options: [{ value, label, searchText? }]
 */
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  required = false,
  disabled = false,
  emptyLabel = '',
  placeholder,
  className = '',
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    const list = Array.isArray(options) ? options : [];
    if (!q) return list;
    return list.filter((opt) => {
      const hay = String(opt.searchText || opt.label || opt.value || '').toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  const rows = useMemo(() => {
    if (!value) return filtered;
    const selected = (Array.isArray(options) ? options : [])
      .find((opt) => String(opt.value) === String(value));
    if (!selected) return filtered;
    if (filtered.some((opt) => String(opt.value) === String(value))) return filtered;
    return [selected, ...filtered];
  }, [filtered, options, value]);

  const groupedRows = useMemo(() => {
    const groups = [];
    const groupMap = new Map();
    for (const opt of rows) {
      const label = String(opt.group || '');
      if (!groupMap.has(label)) {
        const bucket = { label, options: [] };
        groupMap.set(label, bucket);
        groups.push(bucket);
      }
      groupMap.get(label).options.push(opt);
    }
    return groups;
  }, [rows]);

  const hasGroups = useMemo(
    () => rows.some((opt) => String(opt.group || '').trim().length > 0),
    [rows],
  );

  return (
    <div className={`searchable-select ${className}`.trim()}>
      <label className="searchable-select-filter">
        <Search size={16} />
        <input
          type="search"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder || t('search')}
          autoComplete="off"
        />
      </label>
      <select
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {emptyLabel != null ? <option value="">{emptyLabel}</option> : null}
        {hasGroups
          ? groupedRows.map((group) => (
            group.label ? (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((opt) => (
                  <option key={String(opt.value)} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              group.options.map((opt) => (
                <option key={String(opt.value)} value={opt.value}>
                  {opt.label}
                </option>
              ))
            )
          ))
          : rows.map((opt) => (
            <option key={String(opt.value)} value={opt.value}>
              {opt.label}
            </option>
          ))}
      </select>
    </div>
  );
}
