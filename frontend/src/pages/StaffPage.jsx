import { useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, messageOf } from '../api/client.js';
import {
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  PrimaryButton,
  SearchBox,
  StatusBadge,
  Table,
} from '../components/Common.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useCompany } from '../context/CompanyContext.jsx';
import { dateTime } from '../utils/format.js';
import { isSuperAdmin as isSuperAdminRole, localizeValue, ROLE_OPTIONS, translatePersonName, translateRole } from '../utils/labels.js';
import { useDeleteConfirm } from '../components/ConfirmDelete.jsx';

const initial = {
  name: '',
  phone: '',
  username: '',
  password: '',
  role: 'صندوق‌دار',
  branchId: '',
  permissions: [],
  isActive: true,
};

const permissionKeys = [
  'dashboard', 'customers', 'accounts', 'currencies', 'rates', 'buy', 'sell',
  'exchange', 'remittances', 'cashboxes', 'balance', 'expenses', 'reports', 'branches',
  'staff', 'audit',
];

function parsePermissions(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const superAdminOnlyPermissions = ['branches', 'staff', 'audit'];

export default function StaffPage() {
  const { t } = useTranslation();
  const { show } = useToast();
  const { user, isSuperAdmin, isBranchScoped, branchId, refreshUser } = useAuth();
  const { isAppMenuEnabled } = useCompany();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [lookups, setLookups] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(initial);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [removeAvatar, setRemoveAvatar] = useState(false);

  const roleOptions = ROLE_OPTIONS.filter(([value]) => isSuperAdmin || value !== 'مدیر کل');
  const editablePermissions = permissionKeys.filter((p) => {
    if (!isSuperAdmin && superAdminOnlyPermissions.includes(p)) return false;
    return isAppMenuEnabled(p);
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...initial,
      branchId: isBranchScoped && branchId ? String(branchId) : '',
    });
    setAvatarFile(null);
    setAvatarPreview('');
    setRemoveAvatar(false);
    setOpen(true);
  };

  const { askDelete, dialog: deleteDialog } = useDeleteConfirm({
    onDeleted: () => {
      show(t('success'));
      load();
    },
    translateLabel: (row) => row.name,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([api.get('/staff'), api.get('/lookups')]);
      const list = (a.data.data.rows || []).map((row) => ({
        ...row,
        permissions: parsePermissions(row.permissions),
      }));
      setRows(list);
      setLookups(b.data.data);
      setError('');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => () => {
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview);
    }
  }, [avatarPreview]);

  const edit = (r) => {
    setEditing(r);
    setForm({
      name: r.name,
      phone: r.phone || '',
      username: r.username,
      password: '',
      role: r.role,
      branchId: r.branchId ? String(r.branchId) : '',
      permissions: parsePermissions(r.permissions),
      isActive: Boolean(r.isActive),
    });
    setAvatarFile(null);
    setAvatarPreview('');
    setRemoveAvatar(false);
    setOpen(true);
  };

  const togglePerm = (p) => {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(p)
        ? f.permissions.filter((x) => x !== p)
        : [...f.permissions, p],
    }));
  };

  const onAvatarChange = (e) => {
    const file = e.target.files?.[0] || null;
    setRemoveAvatar(false);
    setAvatarFile(file);
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview);
    }
    setAvatarPreview(file ? URL.createObjectURL(file) : '');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (form.role === 'مدیر شعبه' && !form.branchId && !isBranchScoped) {
      show(t('branchRequiredForManager'), 'error');
      return;
    }
    try {
      const payload = {
        ...form,
        branchId: isBranchScoped ? branchId : (form.branchId ? Number(form.branchId) : null),
        permissions: form.permissions.filter((p) => editablePermissions.includes(p)),
      };
      let saved;
      if (editing) {
        const { data } = await api.put(`/staff/${editing.id}`, payload);
        saved = data.data;
      } else {
        const { data } = await api.post('/staff', payload);
        saved = data.data;
      }

      if (saved?.id && avatarFile) {
        const body = new FormData();
        body.append('avatar', avatarFile);
        const { data } = await api.post(`/staff/${saved.id}/avatar`, body);
        saved = data.data;
      } else if (saved?.id && removeAvatar && editing?.avatarUrl) {
        const { data } = await api.delete(`/staff/${saved.id}/avatar`);
        saved = data.data;
      }

      if (user?.id && saved?.id && Number(user.id) === Number(saved.id)) {
        await refreshUser();
      }

      show(t('success'));
      setOpen(false);
      load();
    } catch (err) {
      show(messageOf(err), 'error');
    }
  };

  const remove = (r) => {
    askDelete(r, (row) => api.delete(`/staff/${row.id}`));
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [r.name, r.phone, r.username, r.role].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  return (
    <>
      <PageHeader
        title={t('staff')}
        actions={(
          <PrimaryButton onClick={openCreate}>
            {t('add')}
          </PrimaryButton>
        )}
      />

      <div className="panel">
        <SearchBox value={search} onChange={setSearch} onRefresh={load} />
        <Table
          rows={filteredRows}
          columns={[
            {
              key: 'name',
              label: t('name'),
              render: (r) => (
                <div className="staff-name-cell">
                  <UserAvatar user={r} />
                  <div>
                    <strong>{translatePersonName(t, r.name)}</strong>
                    <small>@{r.username}</small>
                  </div>
                </div>
              ),
            },
            { key: 'role', label: t('role'), render: (r) => translateRole(t, r.role) },
            {
              key: 'branch',
              label: t('branch'),
              render: (r) => r.branch?.name ? localizeValue(t, r.branch.name) : t('all'),
            },
            {
              key: 'permissions',
              label: t('permissions'),
              render: (r) => (isSuperAdminRole(r.role) ? (
                <span className="badge success">{t('all')}</span>
              ) : (
                <div className="summary-chips">
                  {r.permissions.slice(0, 4).map((p) => (
                    <span className="badge info" key={p}>{t(p)}</span>
                  ))}
                  {r.permissions.length > 4 && <span>+{r.permissions.length - 4}</span>}
                </div>
              )),
            },
            {
              key: 'lastSeenAt',
              label: t('lastSeen'),
              render: (r) => dateTime(r.lastSeenAt),
            },
            {
              key: 'status',
              label: t('status'),
              render: (r) => (
                <StatusBadge active={r.isActive}>
                  {r.isActive ? t('active') : t('inactive')}
                </StatusBadge>
              ),
            },
            {
              key: 'actions',
              label: t('actions'),
              render: (r) => (
                <div className="row-actions">
                  <button type="button" className="icon-btn" onClick={() => edit(r)}>
                    <Pencil size={17} />
                  </button>
                  <button type="button" className="icon-btn danger" onClick={() => remove(r)}>
                    <Trash2 size={17} />
                  </button>
                </div>
              ),
            },
          ]}
        />
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('edit') : t('add')} wide>
        <form className="form-grid" onSubmit={submit}>
          <div className="staff-avatar-field full">
            <UserAvatar
              name={form.name || editing?.name}
              avatarUrl={removeAvatar ? null : (avatarPreview || editing?.avatarUrl)}
              className="large"
            />
            <div>
              <Field label={t('profilePhotoOptional')}>
                <input type="file" accept="image/*" onChange={onAvatarChange} />
              </Field>
              <small>{t('profilePhotoHint')}</small>
              {(editing?.avatarUrl || avatarFile) && !removeAvatar ? (
                <button
                  type="button"
                  className="btn tiny soft"
                  onClick={() => {
                    setRemoveAvatar(true);
                    setAvatarFile(null);
                    if (avatarPreview && avatarPreview.startsWith('blob:')) {
                      URL.revokeObjectURL(avatarPreview);
                    }
                    setAvatarPreview('');
                  }}
                >
                  {t('removePhoto')}
                </button>
              ) : null}
            </div>
          </div>
          <Field label={t('fullName')}>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('phone')}>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label={t('username')}>
            <input
              required
              minLength={3}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>
          <Field label={t('password')}>
            <input
              required={!editing}
              minLength={editing ? 0 : 8}
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            {editing ? <small>{t('passwordHelp')}</small> : null}
          </Field>
          <Field label={t('role')}>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roleOptions.map(([value, key]) => (
                <option key={value} value={value}>{t(key)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('branch')}>
            {isBranchScoped ? (
              <input
                readOnly
                value={lookups?.branches?.find((b) => String(b.id) === String(form.branchId || branchId))?.name
                  ? localizeValue(t, lookups.branches.find((b) => String(b.id) === String(form.branchId || branchId)).name)
                  : t('branch')}
              />
            ) : (
              <select
                required={form.role === 'مدیر شعبه'}
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              >
                <option value="">{form.role === 'مدیر شعبه' ? t('selectBranch') : t('all')}</option>
                {lookups?.branches?.map((b) => (
                  <option key={b.id} value={b.id}>{localizeValue(t, b.name)}</option>
                ))}
              </select>
            )}
            {form.role === 'مدیر شعبه' && !form.branchId && !isBranchScoped ? (
              <small>{t('branchRequiredForManager')}</small>
            ) : null}
          </Field>
          <Field label={t('status')} className="full">
            <label className="toggle">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <span />
              {form.isActive ? t('active') : t('inactive')}
            </label>
          </Field>
          <div className="permissions-box full">
            <div className="permissions-head">
              <strong>{t('permissions')}</strong>
              <div>
                <button
                  type="button"
                  className="btn tiny soft"
                  onClick={() => setForm({ ...form, permissions: [...editablePermissions] })}
                >
                  {t('selectAll')}
                </button>
                <button
                  type="button"
                  className="btn tiny soft"
                  onClick={() => setForm({ ...form, permissions: [] })}
                >
                  {t('clearAll')}
                </button>
              </div>
            </div>
            <div className="permissions-grid">
              {editablePermissions.map((p) => (
                <label key={p}>
                  <input
                    type="checkbox"
                    checked={form.permissions.includes(p)}
                    onChange={() => togglePerm(p)}
                  />
                  <span>{t(p)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="form-actions full">
            <button className="btn soft" type="button" onClick={() => setOpen(false)}>{t('cancel')}</button>
            <button className="btn primary" type="submit">{t('save')}</button>
          </div>
        </form>
      </Modal>
      {deleteDialog}
    </>
  );
}
