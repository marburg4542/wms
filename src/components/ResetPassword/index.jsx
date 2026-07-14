// src/components/ResetPassword/index.jsx
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FaLock } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { fetchApi } from '../../utils/api';

export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pwd !== confirm) {
      return toast.error('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
    }

    setLoading(true);
    try {
      const data = await fetchApi('/api/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: pwd }),
      });
      if (data.success) {
        toast.success('รีเซ็ตรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบ');
        navigate('/login');
      }
    } catch (err) {
      // fetchApi แสดง toast ข้อความ error จาก server ให้แล้ว
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full min-h-[86vh] flex justify-center items-center p-4">
      <div className="card w-full max-w-md glass-panel p-8 text-center">
        <h2 className="text-2xl font-bold mb-6 text-base-content">ตั้งรหัสผ่านใหม่</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-control relative">
            <FaLock className="absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40 z-10" />
            <input
              className="input input-bordered pl-12 rounded-full w-full bg-base-100 text-sm focus:outline-none"
              type="password"
              placeholder="รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <div className="form-control relative">
            <FaLock className="absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40 z-10" />
            <input
              className="input input-bordered pl-12 rounded-full w-full bg-base-100 text-sm focus:outline-none"
              type="password"
              placeholder="ยืนยันรหัสผ่านใหม่"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary rounded-full w-full text-white font-semibold mt-4 flex items-center justify-center gap-2"
            disabled={loading}
          >
            {loading && <span className="loading loading-spinner loading-xs"></span>}
            บันทึกรหัสผ่านใหม่
          </button>
        </form>
        <p className="mt-6 text-sm text-center">
          <span
            onClick={() => navigate('/login')}
            className="link link-primary font-semibold cursor-pointer"
          >
            กลับไปเข้าสู่ระบบ
          </span>
        </p>
      </div>
    </div>
  );
}
