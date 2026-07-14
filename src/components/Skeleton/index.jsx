// โครงร่างโหลด (loading skeleton) แทน spinner ให้ดูลื่นขึ้น
import React from 'react';

// การ์ดสินค้า (หน้ารายการอะไหล่)
export function ProductCardSkeleton({ count = 8 }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card glass-panel overflow-hidden">
          <div className="skeleton h-44 w-full rounded-none"></div>
          <div className="card-body p-5 gap-3">
            <div className="skeleton h-5 w-3/4"></div>
            <div className="skeleton h-4 w-1/2"></div>
            <div className="skeleton h-4 w-2/3"></div>
            <div className="skeleton h-8 w-full mt-2"></div>
          </div>
        </div>
      ))}
    </div>
  );
}

// แถวรายการ (หน้าคลังสินค้า / จัดการผู้ใช้ บนมือถือ)
export function ListSkeleton({ count = 6 }) {
  return (
    <div className="divide-y divide-base-200">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <div className="skeleton w-14 h-14 rounded-lg shrink-0"></div>
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 w-2/3"></div>
            <div className="skeleton h-3 w-1/2"></div>
          </div>
          <div className="skeleton h-8 w-16 rounded-lg shrink-0"></div>
        </div>
      ))}
    </div>
  );
}

// การ์ดสถิติ + ตาราง (แดชบอร์ด)
export function DashboardSkeleton() {
  return (
    <div className="p-4 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-panel rounded-2xl p-5 space-y-3">
            <div className="skeleton h-3 w-2/3"></div>
            <div className="skeleton h-8 w-1/3"></div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="glass-panel rounded-2xl p-5 space-y-3">
            <div className="skeleton h-5 w-1/2 mb-2"></div>
            {Array.from({ length: 4 }).map((__, j) => <div key={j} className="skeleton h-6 w-full"></div>)}
          </div>
        ))}
      </div>
    </div>
  );
}
