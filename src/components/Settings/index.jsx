// src/components/Settings/index.jsx
import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { fetchApi, getAssetUrl } from '../../utils/api';
import { enablePush, pushPermissionState, pushEnvironment } from '../../utils/push';

export default function SettingsPage() {
  const stored = JSON.parse(sessionStorage.getItem('currentUser') || '{}');

  // State สำหรับจัดการข้อมูล
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(stored.avatarUrl || '');
  const [username, setUsername] = useState(stored.username || '');
  const [email, setEmail] = useState(stored.email || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pushState, setPushState] = useState(pushPermissionState());
  const pushEnv = pushEnvironment();

  // เปิดการแจ้งเตือน — เรียกจากการแตะปุ่มโดยตรง (จำเป็นบน iOS)
  const handleEnablePush = async () => {
    const { ok, reason } = await enablePush();
    setPushState(pushPermissionState());
    if (ok) toast.success('เปิดการแจ้งเตือนแล้ว 🔔');
    else if (reason === 'denied') toast.error('การแจ้งเตือนถูกบล็อก — เปิดได้ที่ตั้งค่าเบราว์เซอร์/อุปกรณ์');
    else if (reason === 'unsupported') toast.error('อุปกรณ์นี้ไม่รองรับ (iOS ต้องติดตั้งเป็นแอปก่อน)');
    else toast.error('เปิดการแจ้งเตือนไม่สำเร็จ ลองใหม่อีกครั้ง');
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    if (newPassword && newPassword !== confirmPassword) return toast.error('รหัสผ่านใหม่ไม่ตรงกัน');
    
    try {
      let finalAvatarUrl = stored.avatarUrl;

      // 1. Upload รูปภาพ (ถ้ามีไฟล์ใหม่)
      if (avatarFile) {
        const formData = new FormData();
        formData.append('avatar', avatarFile);
        const data = await fetchApi('/api/upload-avatar', {
          method: 'POST',
          body: formData
        });
        if (data.success) finalAvatarUrl = data.fileUrl;
      }

      // 2. อัปเดตข้อมูล Profile และ Username
      const result = await fetchApi('/api/update-profile', {
        method: 'PUT',
        body: JSON.stringify({ 
          newUsername: username,
          email: email,
          avatarUrl: finalAvatarUrl,
          password: newPassword || undefined
        })
      });

      if (result.success) {
        toast.success('อัปเดตข้อมูลสำเร็จ!');

        // อัปเดต Token และ Session หากมีการเปลี่ยนแปลง
        if (result.token) sessionStorage.setItem('token', result.token);
        sessionStorage.setItem('currentUser', JSON.stringify({
          ...stored,
          username: result.user.username,
          avatarUrl: finalAvatarUrl,
          email: email
        }));

        // รีโหลดหน้าจอเพื่อแสดงผลชื่อใหม่บน Navbar (หน่วงให้ toast แสดงก่อน)
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (err) {
      // fetchApi แสดง toast ข้อความ error จาก server ให้แล้ว
      console.error(err);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto glass-panel rounded-2xl my-4">
      <h2 className="text-2xl font-bold mb-6 text-gradient w-fit">ตั้งค่าบัญชีผู้ใช้</h2>
      <form onSubmit={handleProfileSubmit} className="space-y-6">
        
        {/* ส่วนอัปโหลดรูป */}
        <div className="flex items-center gap-4">
          <img 
            src={getAssetUrl(avatarPreview) || `https://ui-avatars.com/api/?name=${encodeURIComponent(username || 'User')}&background=0D8ABC&color=fff`} 
            alt="Avatar" 
            className="w-20 h-20 rounded-full object-cover border" 
          />
          <input type="file" onChange={handleAvatarChange} className="file-input file-input-bordered w-full max-w-xs" />
        </div>

        {/* Username */}
        <div className="form-control w-full">
          <label className="label font-semibold text-xs opacity-70">ชื่อผู้ใช้</label>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="input input-bordered w-full" />
        </div>

        {/* Email */}
        <div className="form-control w-full">
          <label className="label font-semibold text-xs opacity-70">อีเมล</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input input-bordered w-full" />
        </div>

        {/* Password */}
        <div className="form-control w-full">
          <label className="label font-semibold text-xs opacity-70">รหัสผ่านใหม่ (เว้นว่างหากไม่ต้องการเปลี่ยน)</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input input-bordered w-full" />
        </div>

        <div className="form-control w-full">
          <label className="label font-semibold text-xs opacity-70">ยืนยันรหัสผ่านใหม่</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="input input-bordered w-full" />
        </div>
        
        <button type="submit" className="btn btn-primary w-full sm:w-auto px-6">บันทึกข้อมูล</button>
      </form>

      {/* การแจ้งเตือนแบบ push (เด้งแม้ปิดแอป) */}
      <div className="mt-8 pt-6 border-t border-base-200">
        <h3 className="font-bold text-lg mb-1">🔔 การแจ้งเตือน</h3>
        <p className="text-sm text-base-content/60 mb-3">รับแจ้งเตือนผลใบเบิก/คำขอ เด้งบนอุปกรณ์แม้ปิดแอปไว้</p>
        {pushState === 'granted' ? (
          <div className="flex items-center gap-2 text-success text-sm font-medium">✅ เปิดการแจ้งเตือนอยู่</div>
        ) : pushState === 'denied' ? (
          <div className="text-sm text-error bg-error/10 rounded-lg p-3">
            ⚠️ การแจ้งเตือนถูกบล็อก — เปิดได้ที่ตั้งค่าเบราว์เซอร์ (คลิกไอคอน 🔒 ข้าง URL → การแจ้งเตือน → อนุญาต) หรือตั้งค่าอุปกรณ์ แล้วรีเฟรชหน้า
          </div>
        ) : pushState === 'unsupported' ? (
          <div className="text-sm bg-base-200/50 rounded-lg p-3 space-y-2">
            {pushEnv.isIOS && !pushEnv.isStandalone ? (
              <>
                <p className="text-warning font-medium">⚠️ ตอนนี้เปิดผ่าน Safari อยู่</p>
                <p className="text-base-content/70">iPhone/iPad รับแจ้งเตือนได้เฉพาะเมื่อ<b>เปิดจากไอคอนแอปบนหน้าจอโฮม</b> — ถ้ายังไม่ได้ติดตั้ง: Safari → ปุ่มแชร์ 􀈂 → “เพิ่มลงในหน้าจอโฮม” แล้วเปิดแอปจากไอคอนนั้น</p>
              </>
            ) : pushEnv.isIOS ? (
              <>
                <p className="text-warning font-medium">⚠️ iOS เวอร์ชันไม่รองรับ</p>
                <p className="text-base-content/70">การแจ้งเตือนบน iPhone/iPad ต้องใช้ <b>iOS 16.4 ขึ้นไป</b> — ตรวจสอบที่ ตั้งค่า → ทั่วไป → เกี่ยวกับ</p>
              </>
            ) : (
              <p className="text-base-content/70">เบราว์เซอร์นี้ยังไม่รองรับการแจ้งเตือน — ลองใช้ Chrome หรือ Edge</p>
            )}
          </div>
        ) : (
          <button type="button" onClick={handleEnablePush} className="btn btn-primary btn-outline">เปิดการแจ้งเตือน</button>
        )}
      </div>
    </div>
  );
}
