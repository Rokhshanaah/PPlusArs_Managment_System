import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';
import { useCompany } from './CompanyContext.jsx';

const STORAGE_KEY = 'zarin_branch_filter';
const BranchFilterContext = createContext(null);

function readStoredFilter() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || raw === 'all' || raw === '0') return null;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function BranchFilterProvider({ children }) {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const { hasFeature } = useCompany();
  const [selectedBranchId, setSelectedBranchIdState] = useState(readStoredFilter);
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  const setSelectedBranchId = useCallback((value) => {
    const next =
      value == null || value === '' || value === 'all'
        ? null
        : Number(value);

    const normalized =
      Number.isFinite(next) && next > 0 ? next : null;

    setSelectedBranchIdState((prev) => {
      if (prev === normalized) return prev;
      return normalized;
    });

    try {
      if (normalized) {
        localStorage.setItem(STORAGE_KEY, String(normalized));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }

    window.dispatchEvent(
      new CustomEvent('zarin:branch-filter-changed', {
        detail: { branchId: normalized },
      }),
    );
  }, []);

  useEffect(() => {
    if (authLoading) return;

    if (!isSuperAdmin || !hasFeature('branches')) {
      setBranches([]);
      setSelectedBranchIdState((prev) => {
        if (prev == null) return prev;
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        return null;
      });
      return;
    }

    let cancelled = false;
    setLoadingBranches(true);

    api
      .get('/branches', { skipBranchFilter: true })
      .then(({ data }) => {
        if (cancelled) return;
        setBranches((data.data || []).filter((b) => b.isActive !== false));
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBranches(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, isSuperAdmin, hasFeature]);

  useEffect(() => {
    if (!isSuperAdmin || !hasFeature('branches') || !branches.length || selectedBranchId == null) {
      return;
    }

    const exists = branches.some(
      (b) => Number(b.id) === Number(selectedBranchId),
    );

    if (!exists) {
      setSelectedBranchId(null);
    }
  }, [isSuperAdmin, hasFeature, branches, selectedBranchId, setSelectedBranchId]);

  useEffect(() => {
    const onBranchesChanged = () => {
      if (!isSuperAdmin || !hasFeature('branches')) return;
      api
        .get('/branches', { skipBranchFilter: true })
        .then(({ data }) => {
          setBranches((data.data || []).filter((b) => b.isActive !== false));
        })
        .catch(() => {});
    };

    window.addEventListener('zarin:branches:changed', onBranchesChanged);
    return () => {
      window.removeEventListener(
        'zarin:branches:changed',
        onBranchesChanged,
      );
    };
  }, [isSuperAdmin, hasFeature]);

  const selectedBranch = useMemo(
    () =>
      branches.find(
        (b) => Number(b.id) === Number(selectedBranchId),
      ) || null,
    [branches, selectedBranchId],
  );

  const value = useMemo(
    () => ({
      branches,
      loadingBranches,
      selectedBranchId: isSuperAdmin && hasFeature('branches') ? selectedBranchId : null,
      selectedBranchName: selectedBranch?.name || null,
      setSelectedBranchId,
      isAdminFilterActive: Boolean(isSuperAdmin && hasFeature('branches') && selectedBranchId),
    }),
    [
      branches,
      loadingBranches,
      selectedBranchId,
      selectedBranch,
      setSelectedBranchId,
      isSuperAdmin,
      hasFeature,
    ],
  );

  return (
    <BranchFilterContext.Provider value={value}>
      {children}
    </BranchFilterContext.Provider>
  );
}

export function useBranchFilter() {
  const ctx = useContext(BranchFilterContext);
  if (!ctx) {
    return {
      branches: [],
      loadingBranches: false,
      selectedBranchId: null,
      selectedBranchName: null,
      setSelectedBranchId: () => {},
      isAdminFilterActive: false,
    };
  }
  return ctx;
}
