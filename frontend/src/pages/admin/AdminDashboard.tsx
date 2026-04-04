import { useState, useEffect } from "react";
import { Users, LayoutDashboard, Layers, Receipt } from "lucide-react";
import client from "@/api/client";
import { cn } from "@/lib/utils";

interface Stats { users: number; groups: number; expenses: number; settlements: number }

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color: string }) {
  return (
    <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/15 p-5 flex items-center gap-4">
      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", color)}><Icon size={22} /></div>
      <div>
        <p className="text-2xl font-bold text-on-surface">{value.toLocaleString()}</p>
        <p className="text-sm text-on-surface-variant">{label}</p>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get<Stats>("/admin/stats").then((r) => setStats(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  if (!stats) return null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-on-surface">Dashboard</h1>
        <p className="text-sm text-on-surface-variant mt-0.5">System overview</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Users" value={stats.users} color="bg-tertiary-container/20 text-tertiary" />
        <StatCard icon={Layers} label="Total Groups" value={stats.groups} color="bg-primary-container/20 text-primary" />
        <StatCard icon={Receipt} label="Total Expenses" value={stats.expenses} color="bg-amber-50 text-amber-600" />
        <StatCard icon={LayoutDashboard} label="Settlements" value={stats.settlements} color="bg-purple-50 text-purple-600" />
      </div>
    </div>
  );
}
