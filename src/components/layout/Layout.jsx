import React from 'react';
import Sidebar from './Sidebar';

const Layout = ({ children }) => (
  <div className="min-h-screen bg-[#f7faf5] text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
    <Sidebar />
    <main className="lg:pl-60">
      <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
        {children}
      </div>
    </main>
  </div>
);

export default Layout;
