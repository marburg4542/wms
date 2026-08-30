// src/components/Navbar/index.jsx
import React, { useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AuthContext } from '../../AuthContext';
import { fetchApi } from '../../utils/api';
import { onServerEvent, resetEventStream } from '../../utils/events';

// เสียง "ติ๊งต่อง" สั้นๆ สร้างด้วย Web Audio API เพื่อไม่ต้องพึ่งไฟล์เสียง
let audioCtx = null;
const playNotificationSound = () => {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.15;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch {
    // เบราว์เซอร์บล็อกเสียงจนกว่าผู้ใช้จะมี interaction กับหน้าเว็บ — ข้ามไปเงียบๆ
  }
};

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, setIsAuthenticated } = useContext(AuthContext);

  const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
  const username = currentUser.username || 'User';
  const avatarUrl = currentUser.avatarUrl;

  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

  const [searchQuery, setSearchQuery] = useState('');
  const handleSearch = (e) => {
    if (e.key === 'Enter' && searchQuery.trim() !== '') {
      navigate(`/inventory?search=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
    }
  };

  const [notifications, setNotifications] = useState([]);
  // เก็บ id ของแจ้งเตือนที่เคยเห็นแล้ว เพื่อให้เสียงดังเฉพาะรายการใหม่จริงๆ
  // (null = ยังไม่เคยโหลด จะไม่เล่นเสียงในรอบแรกหลังเปิดหน้า)
  const knownIdsRef = useRef(null);

  // สถานะ "อ่านแล้ว/ลบแล้ว" ต้องจำข้ามรอบ poll (เก็บลง localStorage แยกตามผู้ใช้)
  // ไม่งั้นแจ้งเตือนที่ผู้ใช้ล้างไปแล้วจะถูกสร้างซ้ำจากข้อมูล transaction ทุก 30 วินาที
  const notifStorageKey = `wms-notif-state:${currentUser.username || 'guest'}`;
  const notifStateRef = useRef(null);
  const notifUserRef = useRef(undefined);
  if (notifUserRef.current !== currentUser.username) {
    notifUserRef.current = currentUser.username;
    try {
      const saved = JSON.parse(localStorage.getItem(notifStorageKey) || '{}');
      notifStateRef.current = { read: new Set(saved.read || []), dismissed: new Set(saved.dismissed || []) };
    } catch {
      notifStateRef.current = { read: new Set(), dismissed: new Set() };
    }
  }
  const saveNotifState = useCallback(() => {
    const state = notifStateRef.current;
    localStorage.setItem(notifStorageKey, JSON.stringify({ read: [...state.read], dismissed: [...state.dismissed] }));
  }, [notifStorageKey]);

  const fetchNotificationsData = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      let newNotifs = [];
      // Admin/Manager สนใจเฉพาะใบที่ค้างอยู่ ส่วนคนอื่นดูผลใบเบิกของตัวเองย้อนหลัง 7 วันพอ
      // จะได้ไม่ต้องดึงประวัติทั้งหมดมาทุกรอบ poll
      const isManagerial = ['Admin', 'Manager'].includes(currentUser.role);
      const txQuery = isManagerial
        ? '?view=active'
        : `?since=${encodeURIComponent(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())}`;
      const dataTx = await fetchApi(`/api/transactions${txQuery}`);

      if (dataTx.success) {
        if (currentUser.role === 'Admin' || currentUser.role === 'Manager') {
          const pendingTx = dataTx.transactions.filter(t => t.status === 'Pending');
          const txNotifs = pendingTx.map(t => ({
            id: `tx-${t.id}`, text: `📦 ขอเบิกสินค้า: ${t.requesterUsername} ส่งใบเบิก ${t.transactionId || 'ใหม่'}`, isRead: false, type: 'warning', link: '/homepage'
          }));
          newNotifs = [...newNotifs, ...txNotifs];
        } else {
          const resolvedTx = dataTx.transactions.filter(t => t.requesterUsername === currentUser.username && t.status !== 'Pending');
          const resNotifs = resolvedTx.map(t => {
            const statusText = t.status === 'Approved' ? '✅ อนุมัติ' : t.status === 'Partial' ? '⚠️ อนุมัติบางส่วน' : '❌ ปฏิเสธ';
            // อนุมัติแล้วแต่ยังไม่กด Picked up = ของพร้อมแล้ว รอผู้ขอมารับ
            const pickupHint = ['Approved', 'Partial'].includes(t.status) && !t.pickedUpAt ? ' — มารับสินค้าได้เลย' : '';
            // แนบหมายเหตุจาก admin ไปด้วย เผื่อมีเงื่อนไข เช่น นัดเวลารับของ หรือเหตุผลที่จ่ายไม่ครบ
            const adminNote = t.adminMessage ? ` (หมายเหตุ: ${t.adminMessage})` : '';
            return {
              id: `tx-res-${t.id}`, text: `✉️ ผลขอเบิก ${t.transactionId || 'ของคุณ'}: ${statusText}${pickupHint}${adminNote}`, isRead: false, type: t.status === 'Approved' ? 'info' : 'error', link: '/homepage'
            };
          });
          newNotifs = [...newNotifs, ...resNotifs];
        }
      }

      // แจ้งเตือนคำขอสมัครสมาชิกใหม่ (เฉพาะ Admin เพราะ /api/users จำกัดสิทธิ์ไว้)
      if (currentUser.role === 'Admin') {
        const dataUsers = await fetchApi('/api/users');
        if (dataUsers.success) {
          const pendingUsers = dataUsers.users.filter(u => u.status === 'Pending');
          const userNotifs = pendingUsers.map(u => ({
            id: `user-${u.id}`,
            text: `👤 คำขอสมัครสมาชิก: "${u.username}" รอการอนุมัติ`,
            isRead: false,
            type: 'warning',
            link: '/users'
          }));
          newNotifs = [...newNotifs, ...userNotifs];
        }
      }

      // ตัด id เก่าที่ต้นทางเลิกอ้างถึงแล้วออกจาก state ที่จำไว้ ไม่ให้ localStorage โตไปเรื่อยๆ
      const state = notifStateRef.current;
      const allIds = new Set(newNotifs.map(n => n.id));
      state.read = new Set([...state.read].filter(id => allIds.has(id)));
      state.dismissed = new Set([...state.dismissed].filter(id => allIds.has(id)));
      saveNotifState();

      // ซ่อนรายการที่ผู้ใช้ลบทิ้งแล้ว และคงสถานะอ่านแล้วจากที่บันทึกไว้
      newNotifs = newNotifs
        .filter(n => !state.dismissed.has(n.id))
        .map(n => ({ ...n, isRead: state.read.has(n.id) }));

      if (knownIdsRef.current) {
        const fresh = newNotifs.filter(n => !knownIdsRef.current.has(n.id));
        if (fresh.length > 0) {
          playNotificationSound();
          toast(fresh.length === 1 ? fresh[0].text : `มีการแจ้งเตือนใหม่ ${fresh.length} รายการ`, { icon: '🔔' });
        }
      }
      knownIdsRef.current = new Set(newNotifs.map(n => n.id));

      setNotifications(newNotifs);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, [isAuthenticated, currentUser.role, currentUser.username, saveNotifState]);

  // โหลดแจ้งเตือนทันที + รับสัญญาณ SSE แบบ real-time โดยคง polling 30 วิไว้เป็น fallback
  useEffect(() => {
    fetchNotificationsData();
    const interval = setInterval(fetchNotificationsData, 300000)  // 5 นาที — SSE ส่ง event ให้อยู่แล้ว อันนี้เป็นแค่ fallback เผื่อ stream หลุด;
    const onFocus = () => fetchNotificationsData();
    window.addEventListener('focus', onFocus);
    const offTx = onServerEvent('transactions', fetchNotificationsData);
    const offUsers = onServerEvent('users', fetchNotificationsData);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      offTx();
      offUsers();
    };
  }, [fetchNotificationsData]);

  const unreadCount = notifications.filter(n => !n.isRead).length;
  const markAllAsRead = (e) => {
    e.stopPropagation();
    notifications.forEach(n => notifStateRef.current.read.add(n.id));
    saveNotifState();
    setNotifications(notifications.map(n => ({ ...n, isRead: true })));
  };
  const clearAllNotifications = (e) => {
    e.stopPropagation();
    notifications.forEach(n => notifStateRef.current.dismissed.add(n.id));
    saveNotifState();
    setNotifications([]);
  };
  const deleteNotification = (e, id) => {
    e.stopPropagation();
    notifStateRef.current.dismissed.add(id);
    saveNotifState();
    setNotifications(notifications.filter(n => n.id !== id));
  };

  const handleClickNotification = (notif) => {
    notifStateRef.current.read.add(notif.id);
    saveNotifState();
    setNotifications(notifications.map(n => n.id === notif.id ? { ...n, isRead: true } : n));
    if (notif.link) navigate(notif.link);
    document.activeElement.blur();
  };

  const handleLogout = () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('currentUser');
    resetEventStream(); // ปิด SSE connection ของ session เดิม
    setIsAuthenticated(false);
    navigate('/login');
  };

  if (location.pathname === '/login' || !isAuthenticated) return null;

  return (
    <div className="navbar sticky top-0 z-40 glass-panel border-x-0 border-t-0 rounded-none px-2 md:px-4">
      <div className="navbar-start w-auto">
        <div className="dropdown">
          <label tabIndex={0} className="btn btn-ghost btn-circle">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7" /></svg>
          </label>
          <ul tabIndex={0} className="menu menu-md dropdown-content glass-modal rounded-box z-50 mt-3 w-64 p-2 gap-1">
            <li className="menu-title text-base-content/50 text-xs">เมนูระบบคลังสินค้า</li>
            <li><Link to="/homepage">📊 แดชบอร์ด & คำขอเบิก</Link></li>
            <li><Link to="/inventory">📦 สินค้าคงคลัง</Link></li>
            <li><Link to="/storage">🗺️ ผังคลัง</Link></li>
            {['Admin', 'Manager'].includes(currentUser.role) && (
              <li><Link to="/products">🏷️ รายการอะไหล่</Link></li>
            )}
            {['Admin', 'Manager'].includes(currentUser.role) && (
              <li><Link to="/analysis">📈 วิเคราะห์คลัง</Link></li>
            )}
            {currentUser.role === 'Admin' && (
              <li><Link to="/users">👥 จัดการผู้ใช้งาน</Link></li>
            )}
          </ul>
        </div>
        <Link to="/homepage" className="text-xl font-black tracking-widest hidden md:flex ml-2"><span className="text-gradient">WMS</span><span className="text-base-content">iCreativeSystems</span></Link>
      </div>

      <div className="navbar-center hidden lg:flex flex-1"></div>

      <div className="navbar-end flex flex-1 justify-end gap-2 md:gap-4">
        <div className="form-control relative hidden sm:block w-full max-w-50 md:max-w-xs">
          <input type="text" placeholder="🔍 ค้นหา (กด Enter)..." className="input input-bordered input-sm w-full bg-base-200/50 backdrop-blur-sm pr-10 focus:ring-1 focus:ring-primary" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={handleSearch} />
        </div>

        <div className="dropdown dropdown-end">
          <label tabIndex={0} className="btn btn-ghost btn-circle btn-sm" onClick={fetchNotificationsData}>
            <div className="indicator">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
              {unreadCount > 0 && <span className="badge badge-xs badge-error indicator-item animate-pulse text-[10px] text-white">{unreadCount}</span>}
            </div>
          </label>
          <ul tabIndex={0} className="menu menu-sm dropdown-content glass-modal rounded-box w-80 max-w-[calc(100vw-1rem)] z-50 fixed! top-17 right-1 left-auto p-2">
            <li className="menu-title flex justify-between items-center border-b border-base-200 pb-2 mb-2">
              <span className="text-base-content font-bold">แจ้งเตือนใหม่</span>
              {notifications.length > 0 && (
                <div className="flex gap-1"><button onClick={markAllAsRead} className="btn btn-xs btn-ghost text-primary px-1">อ่านทั้งหมด</button><button onClick={clearAllNotifications} className="btn btn-xs btn-ghost text-error px-1">ล้างทั้งหมด</button></div>
              )}
            </li>
            {notifications.length === 0 ? <li className="p-4 text-center text-xs opacity-50">ไม่มีแจ้งเตือนใหม่</li> : notifications.map((notif) => (
              <li key={notif.id}>
                <div className={`flex justify-between items-start gap-2 p-3 w-full cursor-pointer hover:bg-base-200 ${!notif.isRead ? 'bg-base-200/50' : 'opacity-60'}`} onClick={() => handleClickNotification(notif)}>
                  <span className="text-xs font-medium flex gap-2 flex-1"><span className="mt-0.5">{notif.type === 'warning' ? '⚠️' : notif.type === 'error' ? '❌' : 'ℹ️'}</span><span className="whitespace-normal">{notif.text}</span></span>
                  <button className="btn btn-ghost btn-xs btn-circle text-base-content/40 hover:text-error h-6 w-6 min-h-0" onClick={(e) => deleteNotification(e, notif.id)}>✕</button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Toggle Theme ใหม่อยู่ตรงนี้ครับ */}
        <label className="swap swap-rotate btn btn-ghost btn-circle btn-sm">
          <input 
            type="checkbox" 
            onChange={toggleTheme} 
            checked={theme === 'dark'} 
          />
          {/* sun icon */}
          <svg className="swap-off h-5 w-5 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z" />
          </svg>
          {/* moon icon */}
          <svg className="swap-on h-5 w-5 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z" />
          </svg>
        </label>

        <div className="dropdown dropdown-end">
          <label tabIndex={0} className="btn btn-ghost btn-circle avatar ml-1">
            <div className="w-9 rounded-full overflow-hidden border border-base-300 ring-2 ring-primary/20"><img src={avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=0D8ABC&color=fff`} alt="User" /></div>
          </label>
          <ul tabIndex={0} className="mt-3 p-2 menu menu-sm dropdown-content glass-modal rounded-box w-52 z-50">
            <li className="font-semibold px-4 py-2 text-base-content/70 border-b border-base-200 mb-1">สวัสดี, {username}</li>
            <li><button onClick={() => navigate('/settings')}>⚙️ ตั้งค่าบัญชี</button></li>
            <li><button onClick={handleLogout} className="text-error">🚪 ออกจากระบบ</button></li>
          </ul>
        </div>
      </div>
    </div>
  );
}