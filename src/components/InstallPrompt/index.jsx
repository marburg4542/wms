// แบนเนอร์ชวนติดตั้ง PWA — โผล่เมื่อเบราว์เซอร์รองรับ (Android Chrome/Edge บน https)
// iOS Safari ไม่ยิง event นี้ (ต้อง "เพิ่มลงหน้าจอโฮม" เอง) จึงจะไม่แสดงบน iOS
import React, { useEffect, useState } from 'react';

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      if (sessionStorage.getItem('pwa-install-dismissed')) return;
      setDeferred(e);
      setVisible(true);
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible || !deferred) return null;

  const install = async () => {
    deferred.prompt();
    await deferred.userChoice;
    setVisible(false);
    setDeferred(null);
  };
  const dismiss = () => {
    sessionStorage.setItem('pwa-install-dismissed', '1');
    setVisible(false);
  };

  return (
    <div className="fixed bottom-4 inset-x-4 z-90 sm:left-auto sm:right-4 sm:w-80 glass-modal rounded-2xl p-4 flex items-center gap-3 animate-fade-in">
      <img src="/icon-192.png" alt="" className="w-10 h-10 rounded-lg shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">ติดตั้ง WMS เป็นแอป</p>
        <p className="text-xs opacity-60">เปิดใช้งานเร็วขึ้น เหมือนแอปในเครื่อง</p>
      </div>
      <button onClick={dismiss} className="btn btn-ghost btn-xs shrink-0">ภายหลัง</button>
      <button onClick={install} className="btn btn-primary btn-sm text-white shrink-0">ติดตั้ง</button>
    </div>
  );
}
