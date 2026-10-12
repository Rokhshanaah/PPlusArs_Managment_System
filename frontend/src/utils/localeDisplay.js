import i18n from '../i18n.js';
import seedMeta from './currencySeedMeta.json';

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

export function hasArabicScript(value) {
  return ARABIC_RE.test(String(value || ''));
}

export function currentLang() {
  return (i18n.language || 'fa').split('-')[0];
}

const EXTRA_NAME_TO_CODE = {
  'دالر آمریکا': 'USD',
  'دالر امریکا': 'USD',
  تومن: 'TMN',
  تومان: 'TMN',
  افغانی: 'AFN',
  'کلدار پاکستان': 'PKR',
};

const CURRENCY_FALLBACK_EN = {
  TMN: 'Toman',
  AFN: 'Afghani',
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  PKR: 'Pakistani Rupee',
  IRR: 'Iranian Rial',
  AED: 'UAE Dirham',
  SAR: 'Saudi Riyal',
};

const COUNTRY_EN = {
  افغانستان: 'Afghanistan',
  امریکا: 'United States',
  'اتحادیه اروپا': 'European Union',
  برتانیا: 'United Kingdom',
  امارات: 'United Arab Emirates',
  'عربستان سعودی': 'Saudi Arabia',
  پاکستان: 'Pakistan',
  ایران: 'Iran',
  هند: 'India',
  چین: 'China',
  جاپان: 'Japan',
  ترکیه: 'Turkey',
  روسیه: 'Russia',
  سویس: 'Switzerland',
  کانادا: 'Canada',
  آسترالیا: 'Australia',
  'زیلند نو': 'New Zealand',
  کویت: 'Kuwait',
  قطر: 'Qatar',
  عمان: 'Oman',
  بحرین: 'Bahrain',
  اردن: 'Jordan',
  عراق: 'Iraq',
  مصر: 'Egypt',
  قزاقستان: 'Kazakhstan',
  ازبکستان: 'Uzbekistan',
  تاجیکستان: 'Tajikistan',
  ترکمنستان: 'Turkmenistan',
  قرغزستان: 'Kyrgyzstan',
  آذربایجان: 'Azerbaijan',
  گرجستان: 'Georgia',
  ارمنستان: 'Armenia',
  'بنگله‌دیش': 'Bangladesh',
  بنگلادیش: 'Bangladesh',
  نیپال: 'Nepal',
  سریلانکا: 'Sri Lanka',
  مالدیو: 'Maldives',
  تایلند: 'Thailand',
  مالیزیا: 'Malaysia',
  سنگاپور: 'Singapore',
  اندونیزیا: 'Indonesia',
  فیلیپین: 'Philippines',
  ویتنام: 'Vietnam',
  'کوریای جنوبی': 'South Korea',
  'هانگ کانگ': 'Hong Kong',
  تایوان: 'Taiwan',
  ماکائو: 'Macau',
  برونی: 'Brunei',
  میانمار: 'Myanmar',
  کمبودیا: 'Cambodia',
  لاوس: 'Laos',
  مغولستان: 'Mongolia',
  'افریقای جنوبی': 'South Africa',
  مراکش: 'Morocco',
  الجزایر: 'Algeria',
  تونس: 'Tunisia',
  لیبیا: 'Libya',
  سودان: 'Sudan',
  ایتوپیا: 'Ethiopia',
  کینیا: 'Kenya',
  تانزانیا: 'Tanzania',
  یوگندا: 'Uganda',
  رواندا: 'Rwanda',
  بوروندی: 'Burundi',
  سومالیا: 'Somalia',
  جیبوتی: 'Djibouti',
  نایجریا: 'Nigeria',
  گانا: 'Ghana',
  'کشورهای افریقای غربی': 'West African States',
  'کشورهای افریقای مرکزی': 'Central African States',
  گامبیا: 'Gambia',
  سیرالیون: 'Sierra Leone',
  لیبریا: 'Liberia',
  گینیا: 'Guinea',
  موریتانیا: 'Mauritania',
  'کیپ ورد': 'Cape Verde',
  موزمبیق: 'Mozambique',
  زامبیا: 'Zambia',
  مالاوی: 'Malawi',
  بوتسوانا: 'Botswana',
  نامیبیا: 'Namibia',
  اسواتینی: 'Eswatini',
  لیسوتو: 'Lesotho',
  ماداگاسکر: 'Madagascar',
  موریس: 'Mauritius',
  سیشل: 'Seychelles',
  آنگولا: 'Angola',
  کانگو: 'Congo',
  برازیل: 'Brazil',
  ارجنتین: 'Argentina',
  چیلی: 'Chile',
  کولمبیا: 'Colombia',
  پیرو: 'Peru',
  یوروگوای: 'Uruguay',
  پاراگوای: 'Paraguay',
  بولیویا: 'Bolivia',
  وینزویلا: 'Venezuela',
  گویانا: 'Guyana',
  سورینام: 'Suriname',
  مکسیکو: 'Mexico',
  گواتیمالا: 'Guatemala',
  هندوراس: 'Honduras',
  نیکاراگوا: 'Nicaragua',
  کاستاریکا: 'Costa Rica',
  پاناما: 'Panama',
  دومینیکن: 'Dominican Republic',
  هائیتی: 'Haiti',
  جامائیکا: 'Jamaica',
  باربادوس: 'Barbados',
  'ترینیداد و توباگو': 'Trinidad and Tobago',
  'کارائیب شرقی': 'Eastern Caribbean',
  باهاما: 'Bahamas',
  بلیز: 'Belize',
  کیوبا: 'Cuba',
  آروبا: 'Aruba',
  'کوراسائو و سنت مارتن': 'Curaçao and Sint Maarten',
  آیسلند: 'Iceland',
  ناروی: 'Norway',
  سویدن: 'Sweden',
  دنمارک: 'Denmark',
  پولند: 'Poland',
  چک: 'Czechia',
  مجارستان: 'Hungary',
  رومانیا: 'Romania',
  بلغاریا: 'Bulgaria',
  سربیا: 'Serbia',
  البانیا: 'Albania',
  'مقدونیه شمالی': 'North Macedonia',
  'بوسنیا و هرزگووینا': 'Bosnia and Herzegovina',
  مولداویا: 'Moldova',
  اوکراین: 'Ukraine',
  بلاروس: 'Belarus',
  اسرائیل: 'Israel',
  لبنان: 'Lebanon',
  سوریه: 'Syria',
  یمن: 'Yemen',
  'اقیانوسیه فرانسه': 'French Pacific',
  فیجی: 'Fiji',
  'پاپوا گینه نو': 'Papua New Guinea',
  'جزایر سلیمان': 'Solomon Islands',
  تونگا: 'Tonga',
  ساموا: 'Samoa',
};

const FA_LATIN = {
  ا: 'a', أ: 'a', إ: 'e', آ: 'a', ب: 'b', پ: 'p', ت: 't', ث: 's', ج: 'j', چ: 'ch',
  ح: 'h', خ: 'kh', د: 'd', ذ: 'z', ر: 'r', ز: 'z', ژ: 'zh', س: 's', ش: 'sh', ص: 's',
  ض: 'z', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ک: 'k', ك: 'k', گ: 'g',
  ل: 'l', م: 'm', ن: 'n', و: 'o', ه: 'h', ة: 'h', ی: 'i', ي: 'i', ى: 'i', ئ: 'y',
  ء: '', '‌': '', ' ': ' ',
};

/** Rough Latin transliteration for Dari/Pashto/Arabic display names in English UI. */
export function transliterateFa(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let out = '';
  for (const ch of raw) {
    out += FA_LATIN[ch] ?? (ARABIC_RE.test(ch) ? '' : ch);
  }
  return out
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function englishCurrencyName(code) {
  if (!code) return null;
  if (CURRENCY_FALLBACK_EN[code]) return CURRENCY_FALLBACK_EN[code];
  try {
    const label = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code);
    if (label && label !== code) return label;
  } catch {
    /* ignore */
  }
  return CURRENCY_FALLBACK_EN[code] || null;
}

function resolveCurrencyCode(currency) {
  if (!currency) return '';
  if (typeof currency === 'string') {
    const direct = EXTRA_NAME_TO_CODE[currency] || seedMeta.nameToCode?.[currency];
    return direct || '';
  }
  if (currency.code) return String(currency.code).toUpperCase();
  const name = currency.name || '';
  return EXTRA_NAME_TO_CODE[name] || seedMeta.nameToCode?.[name] || '';
}

/** Currency label for current language — never leaves Dari text when English is active. */
export function localizeCurrency(t, currency) {
  const code = resolveCurrencyCode(currency);
  const name = typeof currency === 'string' ? currency : (currency?.name || '');
  const lang = currentLang();

  if (code === 'TMN') return t('currencyTMN');

  if (lang === 'en') {
    return englishCurrencyName(code) || (hasArabicScript(name) ? (code || transliterateFa(name)) : (name || code || '—'));
  }

  if (name) return name;
  if (code === 'TMN') return t('currencyTMN');
  return code || '—';
}

export function localizeCountry(t, country) {
  const text = String(country || '').trim();
  if (!text) return '—';
  if (currentLang() === 'en') {
    return COUNTRY_EN[text] || (hasArabicScript(text) ? transliterateFa(text) : text);
  }
  return text;
}

/** Person / free-text names: map known seeds, otherwise transliterate Arabic script in English. */
export function localizePersonName(t, name, localizeValue) {
  if (name == null || name === '') return '—';
  const mapped = localizeValue(t, name);
  if (currentLang() !== 'en') return mapped;
  if (!hasArabicScript(mapped)) return mapped;
  return transliterateFa(mapped) || mapped;
}
