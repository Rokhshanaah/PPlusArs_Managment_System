import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { isSuperAdmin as isSuperAdminRole } from '../utils/labels.js';

const AuthContext = createContext(null);

function readPermissions(user) {
  if (Array.isArray(user?.permissions)) return user.permissions;
  if (typeof user?.permissions === 'string' && user.permissions.trim()) {
    try {
      const parsed = JSON.parse(user.permissions);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('zarin_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('zarin_token')));

  useEffect(() => {
    const unauthorized = () => { setUser(null); setLoading(false); };
    window.addEventListener('zarin:unauthorized', unauthorized);
    const token = localStorage.getItem('zarin_token');
    if (!token) {
      setLoading(false);
      return () => window.removeEventListener('zarin:unauthorized', unauthorized);
    }
    api.get('/auth/me').then(({ data }) => {
      setUser(data.data);
      localStorage.setItem('zarin_user', JSON.stringify(data.data));
    }).catch(() => setUser(null)).finally(() => setLoading(false));
    return () => window.removeEventListener('zarin:unauthorized', unauthorized);
  }, []);

  const login = async (credentials) => {
    const { data } = await api.post('/auth/login', credentials);
    localStorage.setItem('zarin_token', data.data.token);
    localStorage.setItem('zarin_user', JSON.stringify(data.data.user));
    setUser(data.data.user);
    return data.data.user;
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    localStorage.removeItem('zarin_token');
    localStorage.removeItem('zarin_user');
    setUser(null);
  };

  const refreshUser = async () => {
    const { data } = await api.get('/auth/me');
    setUser(data.data);
    localStorage.setItem('zarin_user', JSON.stringify(data.data));
    return data.data;
  };

  const value = useMemo(() => {
    const permissions = readPermissions(user);
    const superAdmin = isSuperAdminRole(user?.role);
    const branchId = user?.branchId ? Number(user.branchId) : null;
    const branchName = user?.branch?.name || null;
    const branchScoped = !superAdmin && branchId != null;

    return {
      user,
      loading,
      login,
      logout,
      refreshUser,
      permissions,
      isSuperAdmin: superAdmin,
      branchId,
      branchName,
      isBranchScoped: branchScoped,
      hasPermission: (p) => superAdmin || permissions.includes(p),
      canAccessBranch: (id) => !branchScoped || Number(id) === branchId,
    };
  }, [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
