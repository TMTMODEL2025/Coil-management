import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { RoleRecord, UserAccessRecord } from '../types/wms';

export function UserManagementView() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserAccessRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ users: UserAccessRecord[]; roles: RoleRecord[] }>(
        '/api/admin/users'
      );
      setUsers(res.users);
      setRoles(res.roles);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'ไม่สามารถโหลดรายชื่อผู้ใช้งานได้',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpdateUser = async (
    targetUserId: number,
    payload: { roleId?: number; isActive?: boolean }
  ) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/users/${targetUserId}`, {
        method: 'PATCH',
        body: payload,
      });
      setFeedback({ type: 'success', message: 'อัปเดตสิทธิ์ผู้ใช้งานและบันทึก Audit Log เรียบร้อยแล้ว' });
      await load();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'ไม่สามารถอัปเดตสิทธิ์ได้',
      });
    }
  };

  if (profile?.roleCode !== 'ADMIN') {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-600">
        เฉพาะผู้ดูแลระบบ (ADMIN) เท่านั้นที่สามารถจัดการสิทธิ์ผู้ใช้งานได้
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          role="alert"
          className={`rounded-lg px-4 py-3 text-sm border flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            การจัดการผู้ใช้งานและสิทธิ์ RBAC (PostgreSQL Users &amp; Roles)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            ผู้ใช้งานที่ลงชื่อเข้าใช้ผ่าน Google Sign-In จะถูกซิงก์เข้าตาราง{' '}
            <span className="font-mono">users</span> อัตโนมัติ
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2.5 px-4">ผู้ใช้งาน</th>
                <th className="py-2.5 px-3">Email</th>
                <th className="py-2.5 px-3">บทบาท (RBAC Role)</th>
                <th className="py-2.5 px-3">สถานะ</th>
                <th className="py-2.5 px-4 text-right">เข้าสู่ระบบล่าสุด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    กำลังโหลดข้อมูลผู้ใช้งาน...
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="h-11 hover:bg-slate-50">
                    <td className="px-4 font-semibold text-slate-900">
                      {u.displayName || '-'}
                      {u.id === profile.id && (
                        <span className="ml-2 text-slate-400 font-normal">(คุณ)</span>
                      )}
                    </td>
                    <td className="px-3 font-mono text-slate-700">{u.email}</td>
                    <td className="px-3">
                      <select
                        aria-label={`เปลี่ยนสิทธิ์ของ ${u.email}`}
                        value={u.roleId}
                        onChange={(e) =>
                          void handleUpdateUser(u.id, { roleId: Number(e.target.value) })
                        }
                        className="h-8 px-2 rounded border border-slate-300 bg-white font-mono text-xs"
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.code} — {r.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3">
                      <button
                        type="button"
                        disabled={u.id === profile.id}
                        onClick={() => void handleUpdateUser(u.id, { isActive: !u.isActive })}
                        className={`px-2.5 py-1 rounded border text-xs font-medium disabled:opacity-40 cursor-pointer ${
                          u.isActive
                            ? 'border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100'
                            : 'border-red-300 text-red-800 bg-red-50 hover:bg-red-100'
                        }`}
                      >
                        {u.isActive ? 'Active' : 'Suspended'}
                      </button>
                    </td>
                    <td className="px-4 text-right font-mono tabular-nums text-slate-500">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString('th-TH')
                        : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
