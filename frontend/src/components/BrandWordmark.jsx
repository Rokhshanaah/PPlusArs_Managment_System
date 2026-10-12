import { useTranslation } from 'react-i18next';
import { useCompany } from '../context/CompanyContext.jsx';

/** Exchange brand mark — name/slogan from settings, same style on login, sidebar, and topbar. */
export default function BrandWordmark({
  size = 'md',
  showSlogan = false,
  showEnglish = 'auto',
  className = '',
}) {
  const { i18n } = useTranslation();
  const { displayName, displaySlogan } = useCompany();
  const isEnglish = i18n.language === 'en';
  const englishVisible = showEnglish === true || (showEnglish === 'auto' && isEnglish);
  const isLatinBrand = /^[\x00-\x7F.]+$/.test(String(displayName || '').trim());

  return (
    <div
      className={`brand-wordmark brand-wordmark--${size} ${className}`.trim()}
      aria-label={displayName}
    >
      <span
        className={`brand-nastaliq${isLatinBrand ? ' brand-latin' : ''}`}
        lang={isLatinBrand ? 'en' : 'fa'}
        dir={isLatinBrand ? 'ltr' : 'rtl'}
      >
        {displayName}
      </span>
      {englishVisible && !isLatinBrand ? (
        <small className="brand-nastaliq-en">{displayName}</small>
      ) : null}
      {showSlogan ? <span className="brand-slogan">{displaySlogan}</span> : null}
    </div>
  );
}
