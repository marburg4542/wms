// src/components/Login/index.jsx
import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaUserAlt, FaLock, FaEnvelope, FaLockOpen } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { AuthContext } from '../../AuthContext';
import { fetchApi } from '../../utils/api'; // 🔥 นำเข้า fetchApi มาใช้งาน
import { subscribeIfGranted } from '../../utils/push';

export default function LoginPage() {
  const { setIsAuthenticated } = useContext(AuthContext);
  const navigate = useNavigate();

  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);

  // Register fields
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Forgot password field
  const [email, setEmail] = useState('');

  // Load remembered username
  useEffect(() => {
    const savedUsername = localStorage.getItem('rememberedUsername');
    if (savedUsername) {
      setUsername(savedUsername);
      setRemember(true);
    }
  }, []);

  // 1) Login
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const data = await fetchApi('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
    
      if (data.success) {
        // จัดการ Remember Me
        if (remember) {
          localStorage.setItem('rememberedUsername', username);
        } else {
          localStorage.removeItem('rememberedUsername');
        }

        sessionStorage.setItem('token', data.token);
        sessionStorage.setItem('currentUser', JSON.stringify({
          id: data.id,
          username: data.username, 
          email: data.email,
          avatarUrl: data.avatarUrl, 
          role: data.role 
        }));
        setIsAuthenticated(true);
        subscribeIfGranted(); // สมัคร push ถ้าเคยอนุญาต — การขอสิทธิ์ครั้งแรกทำผ่านปุ่มในหน้าตั้งค่า
        navigate('/homepage');
      }
    } catch (err) {
      // fetchApi แสดง toast ข้อความ error จาก server ให้แล้ว
      console.error('Login Failed', err);
    }
  };

  // 2) Register
  const handleRegister = async (e) => {
    e.preventDefault();
    if (regPassword !== confirmPassword) {
      return toast.error('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    }
    try {
      const data = await fetchApi('/api/register', {
        method: 'POST',
        body: JSON.stringify({
          username: regUsername,
          email: regEmail,
          password: regPassword,
        }),
      });
      
      if (data.success) {
        toast.success('สมัครสมาชิกสำเร็จ กรุณารอการอนุมัติจากผู้ดูแลระบบ');
        setMode('login');
      }
    } catch (err) {
      console.error('Registration Failed', err);
    }
  };

  // 3) Forgot Password
  const handleForgot = async (e) => {
    e.preventDefault();
    try {
      const data = await fetchApi('/api/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      
      if (data.success) {
        toast.success('ส่งลิงก์รีเซ็ตรหัสผ่านไปที่อีเมลแล้ว');
        setMode('login');
      }
    } catch (err) {
      console.error('Forgot Password Failed', err);
    }
  };

  return (
    <div className="w-full min-h-[86vh] flex justify-center items-center p-4">
      <div className="card w-full max-w-md glass-panel p-8">
        {mode === 'login' && (
          <>
            <h2 className="text-2xl font-bold mb-6 text-base-content text-center">เข้าสู่ระบบ WMS</h2>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="form-control relative">
                <FaUserAlt className="absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40 z-10" />
                <input
                  className="input input-bordered pl-12 rounded-full w-full bg-base-100 text-sm focus:outline-none"
                  type="text"
                  placeholder="ชื่อผู้ใช้"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                />
              </div>
              <div className="form-control relative">
                <FaLock className="absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40 z-10" />
                <input
                  className="input input-bordered pl-12 rounded-full w-full bg-base-100 text-sm focus:outline-none"
                  type="password"
                  placeholder="รหัสผ่าน"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="flex justify-between items-center text-xs px-2">
                <label className="label cursor-pointer gap-2 py-0">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs checkbox-primary rounded"
                    checked={remember}
                    onChange={() => setRemember(r => !r)}
                  />
                  <span className="label-text">จดจำชื่อผู้ใช้</span>
                </label>
                <span
                  onClick={() => setMode('forgot')}
                  className="link link-hover text-primary font-medium cursor-pointer"
                >
                  ลืมรหัสผ่าน?
                </span>
              </div>
              <button type="submit" className="btn btn-primary rounded-full w-full text-white font-semibold mt-4">
                เข้าสู่ระบบ
              </button>
            </form>
            <p className="mt-6 text-sm text-center text-base-content/70">
              ยังไม่มีบัญชีผู้ใช้?{' '}
              <span
                onClick={() => setMode('register')}
                className="link link-primary font-semibold cursor-pointer ml-1"
              >
                สมัครสมาชิก
              </span>
            </p>
          </>
        )}

        {mode === 'register' && (
          <>
            <h2 className="text-2xl font-bold mb-6 text-base-content text-center">สมัครสมาชิก</h2>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="form-control relative">
                <FaUserAlt className="absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40 z-10" />
                <input
                  className="input input-bordered pl-12 rounded-full w-full bg-base-100 text-sm focus:outline-none"
                  type="text"
                  placeholder="ชื่อผู้ใช้"
                  value={regUsername}
                  onChange={e => setRegUsername(e.target.value)}
                  required
                />
              </div>
              <div className="form-control relative">
                <FaEnvelope className="absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40 z-10" />
                <input
                  className="input input-bordered pl-12 rounded-full w-full bg-base-100 text-sm focus:outline-none"
                  type="email"
                  placeholder="อีเมล"
                  value={regEmail}
                  onChange={e => setRegEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-control relative">
                <FaLockOpen className="absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40 z-10" />
                <input
                  className="input input-bordered pl-12 rounded-full w-full bg-base-100 text-sm focus:outline-none"
                  type="password"
                  placeholder="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)"
                  value={regPassword}
                  onChange={e => setRegPassword(e.target.value)}
                  required
                />
              </div>
              <div className="form-control relative">
                <FaLockOpen className="absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40 z-10" />
                <input
                  className="input input-bordered pl-12 rounded-full w-full bg-base-100 text-sm focus:outline-none"
                  type="password"
                  placeholder="ยืนยันรหัสผ่าน"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary rounded-full w-full text-white font-semibold mt-4">
                สมัครสมาชิก
              </button>
            </form>
            <p className="mt-6 text-sm text-center text-base-content/70">
              มีบัญชีอยู่แล้ว?{' '}
              <span
                onClick={() => setMode('login')}
                className="link link-primary font-semibold cursor-pointer ml-1"
              >
                เข้าสู่ระบบ
              </span>
            </p>
          </>
        )}

        {mode === 'forgot' && (
          <>
            <h2 className="text-2xl font-bold mb-6 text-base-content text-center">ลืมรหัสผ่าน</h2>
            <form onSubmit={handleForgot} className="space-y-4">
              <div className="form-control relative">
                <FaEnvelope className="absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40 z-10" />
                <input
                  className="input input-bordered pl-12 rounded-full w-full bg-base-100 text-sm focus:outline-none"
                  type="email"
                  placeholder="อีเมลที่ใช้สมัคร"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary rounded-full w-full text-white font-semibold mt-4">
                ส่งลิงก์รีเซ็ตรหัสผ่าน
              </button>
            </form>
            <p className="mt-6 text-sm text-center text-base-content/70">
              นึกรหัสผ่านออกแล้ว?{' '}
              <span
                onClick={() => setMode('login')}
                className="link link-primary font-semibold cursor-pointer ml-1"
              >
                กลับไปเข้าสู่ระบบ
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
