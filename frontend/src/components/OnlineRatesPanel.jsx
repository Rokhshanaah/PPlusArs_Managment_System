import { useEffect, useState } from 'react';
import { MapPin, RefreshCw, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import { money } from '../utils/format.js';
import { localizeCurrency } from '../utils/labels.js';

const REGION_STORAGE = 'zarin_rate_region';

function regionLabel(t, region, lang) {
  if (!region) return '';
  if (lang === 'en') return `${region.provinceEn} — ${region.marketEn}`;
  return `${region.province} — ${region.market}`;
}

export default function OnlineRatesPanel({ onUseRate }) {
  const { t, i18n } = useTranslation();
  const [region, setRegion] = useState(() => localStorage.getItem(REGION_STORAGE) || 'kabul');
  const [regions, setRegions] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (nextRegion = region) => {
    setLoading(true);
    try {
      const { data: res } = await api.get('/rates/online', {
        params: { region: nextRegion },
      });
      setData(res.data);
      if (res.data?.regions?.length) setRegions(res.data.regions);
      setError('');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(region);
    const timer = window.setInterval(() => load(region), 3 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [region]);

  const onRegionChange = (value) => {
    localStorage.setItem(REGION_STORAGE, value);
    setRegion(value);
  };

  const localByCode = Object.fromEntries((data?.local || []).map((r) => [r.code, r]));
  const lang = (i18n.language || 'fa').split('-')[0];
  const list = regions.length ? regions : (data?.regions || []);

  return (
    <aside className="online-rates-card">
      <div className="online-rates-head">
        <div>
          <strong><Wifi size={16} /> {t('onlineRates')}</strong>
          <small>
            {data?.updatedAt ? `${t('rateUpdated')}: ${String(data.updatedAt).slice(0, 19).replace('T', ' ')}` : t('loading')}
            {data?.cached ? ` · ${t('cached')}` : ''}
            {data?.source ? ` · ${data.source}` : ''}
          </small>
        </div>
        <button type="button" className="icon-btn" title={t('refresh')} onClick={() => load()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <label className="online-rates-region">
        <MapPin size={15} />
        <span>{t('rateProvince')}</span>
        <select value={region} onChange={(e) => onRegionChange(e.target.value)}>
          {list.map((r) => (
            <option key={r.key} value={r.key}>
              {regionLabel(t, r, lang)}
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="online-rates-error">{error}</p> : null}

      {!error && (
        <div className="online-rates-table-wrap">
          <table className="online-rates-table">
            <thead>
              <tr>
                <th>{t('currency')}</th>
                <th>{t('onlineBuy')}</th>
                <th>{t('onlineSell')}</th>
                <th>{t('localBuy')}</th>
                <th>{t('localSell')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((row) => {
                const local = localByCode[row.code];
                return (
                  <tr key={row.code}>
                    <td>
                      <strong>{row.code}</strong>
                      <small>
                        {localizeCurrency(t, { code: row.code, name: row.label })}
                        {row.unitNote ? ` · ${t(row.unitNote)}` : ''}
                      </small>
                    </td>
                    <td>
                      <strong className="rate-buy">{money(row.buyRate, 4)}</strong>
                    </td>
                    <td>
                      <strong className="rate-sell">{money(row.sellRate, 4)}</strong>
                    </td>
                    <td>{local ? money(local.buyRate, 4) : '—'}</td>
                    <td>{local ? money(local.sellRate, 4) : '—'}</td>
                    <td>
                      {onUseRate ? (
                        <div className="rate-apply-actions">
                          <button
                            type="button"
                            className="btn tiny soft"
                            onClick={() => onUseRate(row.code, row.buyRate, 'buy')}
                          >
                            {t('useBuyRate')}
                          </button>
                          <button
                            type="button"
                            className="btn tiny soft"
                            onClick={() => onUseRate(row.code, row.sellRate, 'sell')}
                          >
                            {t('useSellRate')}
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!loading && !(data?.rows?.length) ? (
                <tr><td colSpan={6}>{t('noData')}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <p className="online-rates-note">{t('onlineRatesHint')}</p>
    </aside>
  );
}
