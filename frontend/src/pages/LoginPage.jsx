import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { LockKeyhole, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.jsx';
import { useCompany } from '../context/CompanyContext.jsx';
import { LanguageSwitcher } from '../components/Common.jsx';
import BrandWordmark from '../components/BrandWordmark.jsx';
import PageMotion from '../components/PageMotion.jsx';
import { messageOf } from '../api/client.js';

export default function LoginPage() {
  const { t } = useTranslation();
  const { user, login } = useAuth();
  const { displayName, languageEnabled } = useCompany();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: 'admin', password: '12345678' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form);
      navigate('/');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageMotion>
      <div className="login-page">
        {languageEnabled ? (
          <div className="login-language">
            <LanguageSwitcher />
          </div>
        ) : null}

        <div className="login-shell">
          <div className="login-image-side">
            <img src="/images/login-money.jpg" alt={displayName} />
            <div className="wave-mobile">
              <svg viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
                {/* White cover into the form — no seam */}
                <path
                  d="M0,-40 H1200 V70 C1120,98 1030,98 910,62 C760,18 620,18 470,52 C320,88 180,88 0,40 Z"
                  fill="#ffffff"
                />
                {/* Bold green wave ribbon (filled, not stroke) */}
                <path
                  d="M0,40 C180,88 320,88 470,52 C620,18 760,18 910,62 C1030,98 1120,98 1200,70
                     L1200,88
                     C1120,116 1030,116 910,80 C760,36 620,36 470,70 C320,106 180,106 0,58 Z"
                  fill="#1d4ed8"
                />
              </svg>
            </div>
          </div>

          <div className="login-form-side">
            <div className="wave-desktop">
              <svg viewBox="0 0 180 700" preserveAspectRatio="none" aria-hidden="true">
                <path
                  d="M180 0 H78 C28 80 22 170 55 265 C95 375 88 465 42 560 C18 620 22 665 48 700 H180 Z"
                  fill="#ffffff"
                />
                <path
                  d="M78 0 C28 80 22 170 55 265 C95 375 88 465 42 560 C18 620 22 665 48 700"
                  fill="none"
                  stroke="#1d4ed8"
                  strokeWidth="16"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>

            <form className="login-form-box login-panel" onSubmit={submit}>
              <div className="login-wordmark">
                <BrandWordmark size="login" />
              </div>
              <p>{t('loginSubtitle')}</p>
              {error ? <div className="login-error">{error}</div> : null}

              <label className="login-field">
                <span>{t('username')}</span>
                <div>
                  <input
                    autoFocus
                    autoComplete="username"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="admin"
                  />
                  <UserRound />
                </div>
              </label>

              <label className="login-field">
                <span>{t('password')}</span>
                <div>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="••••••••"
                  />
                  <LockKeyhole />
                </div>
              </label>

              <button className="login-btn" disabled={loading}>
                {loading ? t('signingIn') : t('signIn')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </PageMotion>
  );
}
