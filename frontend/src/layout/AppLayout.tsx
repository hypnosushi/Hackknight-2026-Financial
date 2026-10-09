import { Outlet } from "react-router-dom";

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <span className="font-semibold text-slate-900">Financial Signals</span>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
