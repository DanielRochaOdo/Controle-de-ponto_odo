import React from 'react';
import Sidebar from './Sidebar';

const Layout = ({ children }) => (
  <div className="min-h-screen bg-[#F8FCF5] text-slate-900">
    <Sidebar />
    <main className="lg:pl-56">
      <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
        {children}
      </div>
    </main>
  </div>
);

export default Layout;
