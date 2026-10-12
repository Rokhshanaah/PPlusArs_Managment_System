import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('zarin_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  try {
    const language = localStorage.getItem('zarin_language');
    if (language) config.headers['X-Language'] = language;
  } catch {
    /* ignore */
  }

  if (!config.skipBranchFilter) {
    try {
      const filter = localStorage.getItem('zarin_branch_filter');
      if (filter && filter !== 'all' && filter !== '0') {
        config.headers['X-Branch-Id'] = filter;
      }
    } catch {
      /* ignore */
    }
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('zarin_token');
      localStorage.removeItem('zarin_user');
      window.dispatchEvent(new Event('zarin:unauthorized'));
    }
    return Promise.reject(error);
  },
);

export const messageOf = (error) =>
  error.response?.data?.message || error.message || 'خطا رخ داد.';
