import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { accessFromCompany } from '../utils/appPlans.js';

const CompanyContext = createContext(null);

const DEFAULT_NAME = 'PPlus.Arz';
const LEGACY_DEFAULT_NAMES = new Set([
  DEFAULT_NAME,
  'زرین‌حساب',
  'زرین حساب',
  'Zarin Hesab',
  'صرافی زرین حساب',
]);

export function CompanyProvider({ children }) {
  const { t, i18n } = useTranslation();
  const [company, setCompany] = useState({});
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/public/company');
      setCompany(data?.data || {});
    } catch {
      setCompany({});
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('zarin:settings:changed', onChange);
    return () => window.removeEventListener('zarin:settings:changed', onChange);
  }, [load]);

  const displayName = useMemo(() => {
    const raw = String(company.company_name || '').trim();
    if (raw && !LEGACY_DEFAULT_NAMES.has(raw)) return raw;
    return t('systemName');
  }, [company.company_name, t]);

  const displaySlogan = useMemo(() => {
    const raw = String(company.company_slogan || '').trim();
    if (raw) return raw;
    return t('systemSlogan');
  }, [company.company_slogan, t]);

  const access = useMemo(
    () => accessFromCompany(company),
    [company],
  );
  const appMenus = access.menus;
  const languageEnabled = Boolean(access.features.language);
  const isAppMenuEnabled = useCallback(
    (key) => appMenus.includes(key),
    [appMenus],
  );
  const hasFeature = useCallback(
    (feature) => Boolean(access.features[feature]),
    [access],
  );

  useEffect(() => {
    if (!loaded || languageEnabled) return;
    if (String(i18n.language || '').split(/[-_]/)[0] !== 'fa') {
      i18n.changeLanguage('fa');
    }
  }, [i18n, languageEnabled, loaded]);

  const value = useMemo(() => ({
    company,
    loaded,
    displayName,
    displaySlogan,
    languageEnabled,
    isAppMenuEnabled,
    hasFeature,
    maxBranches: access.maxBranches,
    reload: load,
  }), [company, loaded, displayName, displaySlogan, access, appMenus, languageEnabled, isAppMenuEnabled, hasFeature, load]);

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) {
    throw new Error('useCompany must be used within CompanyProvider');
  }
  return ctx;
}
