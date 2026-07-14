// src/components/UserManagement/index.jsx
import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { fetchApi, getAssetUrl } from '../../utils/api';
import { userStatusLabel } from '../../utils/labels';
import { onServerEvent } from '../../utils/events';
import { confirmDialog } from '../../utils/confirm';
import { ListSkeleton } from '../Skeleton';

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');

  const visibleUsers = statusFilter === 'ALL' ? users : users.filter(u => u.status === statusFilter);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await fetchApi('/api/users');
      if (data.success) setUsers(data.users);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // โหลดครั้งแรก + อัปเดตทันทีเมื่อมีคนสมัคร/เปลี่ยนสถานะ (SSE) + refresh ตอนกลับมาที่แท็บ
  useEffect(() => {
    fetchUsers();
    const offUsers = onServerEvent('users', fetchUsers);
    window.addEventListener('focus', fetchUsers);
    return () => {
      offUsers();
      window.removeEventListener('focus', fetchUsers);
    };
  }, [fetchUsers]);

  const handleRoleChange = async (userId, newRole) => {
    try {
      const data = await fetchApi(`/api/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole })
      });
      if (data.success) {
        setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
        toast.success('อัปเดตบทบาทผู้ใช้สำเร็จ');
      }
    } catch (err) {
      console.error('Role update failed', err);
    }
  };

  const handleStatusChange = async (userId, newStatus) => {
    const ok = await confirmDialog({
      title: 'ยืนยันการเปลี่ยนสถานะ',
      message: `เปลี่ยนสถานะผู้ใช้นี้เป็น "${userStatusLabel(newStatus)}"?`,
      danger: newStatus === 'Denied'
    });
    if (!ok) return;

    try {
      const data = await fetchApi(`/api/users/${userId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
      });
      
      if (data.success) {
        setUsers(users.map(u => u.id === userId ? { ...u, status: newStatus } : u));
        toast.success('อัปเดตสถานะและส่งอีเมลแจ้งเตือนสำเร็จ');
      }
    } catch (err) {
      console.error('Status update failed', err);
    }
  };

  // 👇 ฟังก์ชันใหม่สำหรับลบผู้ใช้งาน
  const handleDeleteUser = async (userId, username) => {
    const ok = await confirmDialog({
      title: 'ลบผู้ใช้งานถาวร',
      message: `ลบผู้ใช้ "${username}" ออกจากระบบถาวร?\nการกระทำนี้ย้อนกลับไม่ได้`,
      confirmText: 'ลบถาวร',
      danger: true
    });
    if (!ok) return;

    try {
      const data = await fetchApi(`/api/users/${userId}`, {
        method: 'DELETE'
      });
      
      if (data.success) {
        // เอารายชื่อคนที่ถูกลบออกจากตารางทันทีโดยไม่ต้องรีเฟรชหน้า
        setUsers(users.filter(u => u.id !== userId));
        toast.success('ลบผู้ใช้งานสำเร็จ');
      }
    } catch (err) {
      // fetchApi แสดง toast ข้อความ error จาก server ให้แล้ว
      console.error('Delete user failed', err);
    }
  };

  // ตัวเลือกบทบาท + ปุ่มจัดการ ใช้ร่วมกันทั้งตาราง (จอใหญ่) และการ์ด (มือถือ)
  const roleSelect = (user) => (
    <select
      className="select select-bordered select-xs w-full max-w-30"
      value={user.role}
      onChange={(e) => handleRoleChange(user.id, e.target.value)}
      disabled={user.username === currentUser.username}
    >
      <option value="Admin">แอดมิน</option>
      <option value="Manager">ผู้จัดการ</option>
      <option value="Operator">พนักงาน</option>
      <option value="Viewer">ผู้ชม</option>
    </select>
  );

  const actionButtons = (user) => (
    <div className="flex items-center gap-2 flex-wrap">
      {user.status === 'Pending' ? (
        <>
          <button onClick={() => handleStatusChange(user.id, 'Active')} className="btn btn-xs btn-success text-white shadow-sm">อนุมัติ</button>
          <button onClick={() => handleStatusChange(user.id, 'Denied')} className="btn btn-xs btn-warning text-white shadow-sm">ปฏิเสธ</button>
        </>
      ) : user.status === 'Denied' ? (
        <button onClick={() => handleStatusChange(user.id, 'Active')} className="btn btn-xs btn-success text-white shadow-sm" title="เปิดใช้งานบัญชีนี้อีกครั้ง">♻️ คืนสิทธิ์</button>
      ) : user.username !== currentUser.username ? (
        <button onClick={() => handleStatusChange(user.id, 'Denied')} className="btn btn-xs btn-warning text-white shadow-sm" title="ระงับการใช้งานบัญชีนี้">ระงับ</button>
      ) : (
        <span className="text-xs opacity-50 italic mr-2">-</span>
      )}
      {user.username !== currentUser.username && (
        <button onClick={() => handleDeleteUser(user.id, user.username)} className="btn btn-xs btn-error text-white shadow-sm" title="ลบผู้ใช้งานออกจากระบบ">ลบ</button>
      )}
    </div>
  );

  const statusDot = (user) => (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${user.status === 'Active' ? 'bg-success' : user.status === 'Denied' ? 'bg-error' : 'bg-warning animate-pulse'}`}></div>
      <span className="text-xs font-bold opacity-80">{userStatusLabel(user.status)}</span>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 glass-panel p-5 rounded-2xl">
        <div>
          <h1 className="text-2xl font-bold text-gradient w-fit">จัดการผู้ใช้งาน</h1>
          <p className="text-sm text-base-content/60">อนุมัติคำขอสมัครสมาชิกและกำหนดสิทธิ์</p>
        </div>
        <select
          className="select select-bordered select-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">สถานะทั้งหมด</option>
          <option value="Active">ใช้งานอยู่</option>
          <option value="Pending">รออนุมัติ</option>
          <option value="Denied">ถูกระงับ/ปฏิเสธ</option>
        </select>
      </div>

      <div className="card glass-panel overflow-hidden min-h-75">
        {loading ? (
          <ListSkeleton count={6} />
        ) : (
          <div className="overflow-x-auto hidden md:block">
            <table className="table w-full">
              <thead className="bg-base-200/50">
                <tr>
                  <th>ชื่อผู้ใช้งาน</th>
                  <th>อีเมล</th>
                  <th>บทบาท</th>
                  <th>สถานะ</th>
                  <th>การอนุมัติ / การจัดการ</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.length === 0 && (
                  <tr><td colSpan="5" className="text-center opacity-50 py-8">ไม่มีผู้ใช้ในสถานะนี้</td></tr>
                )}
                {visibleUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-base-200/40">
                    <td className="font-medium flex items-center gap-3">
                      <div className="avatar">
                        <div className="w-8 h-8 rounded-full border border-base-300 overflow-hidden">
                          <img src={getAssetUrl(user.avatarUrl) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random`} alt="avatar" />
                        </div>
                      </div>
                      {user.username}
                    </td>
                    <td className="text-sm opacity-80">{user.email}</td>
                    <td>{roleSelect(user)}</td>
                    <td>{statusDot(user)}</td>
                    <td>{actionButtons(user)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* การ์ด (จอมือถือ) */}
        {!loading && (
          <div className="md:hidden divide-y divide-base-200">
            {visibleUsers.length === 0 && <div className="text-center opacity-50 py-8 text-sm">ไม่มีผู้ใช้ในสถานะนี้</div>}
            {visibleUsers.map((user) => (
              <div key={user.id} className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="avatar shrink-0">
                    <div className="w-10 h-10 rounded-full border border-base-300 overflow-hidden">
                      <img src={getAssetUrl(user.avatarUrl) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random`} alt="avatar" />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{user.username}</p>
                    <p className="text-xs opacity-70 truncate">{user.email}</p>
                  </div>
                  {statusDot(user)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs opacity-60 w-14 shrink-0">บทบาท</span>
                  {roleSelect(user)}
                </div>
                {actionButtons(user)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
