"use client";

import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const compact = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
const full = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const AXIS = { fontSize: 11, fill: "#667085" };
const tooltipStyle = { borderRadius: 8, border: "1px solid #e4e7ec", fontSize: 12 };

function Empty({ label }: { label: string }) {
  return <div className="grid h-56 place-items-center rounded-lg border border-dashed border-line text-[13px] text-muted">{label}</div>;
}

export function SpendTrendChart({ data }: { data: { month: string; spend: number; trailingAvg: number }[] }) {
  if (data.every((d) => d.spend === 0)) return <Empty label="No spend in this period" />;
  return (
    <div className="h-64" role="img" aria-label="Monthly spend bars with trailing three-month average line">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eef0f3" vertical={false} />
          <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={AXIS} tickFormatter={compact} tickLine={false} axisLine={false} width={58} />
          <Tooltip formatter={(v) => full(Number(v))} contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="spend" name="Actual spend" fill="#122c47" radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Line dataKey="trailingAvg" name="Trailing 3-mo avg" stroke="#f97316" strokeWidth={2} dot={false} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryMixChart({ data }: { data: { category: string; spend: number }[] }) {
  if (data.length === 0) return <Empty label="No category spend" />;
  return (
    <div style={{ height: Math.max(220, data.length * 30 + 20) }} role="img" aria-label="Spend by category">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eef0f3" horizontal={false} />
          <XAxis type="number" tick={AXIS} tickFormatter={compact} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="category" interval={0} tick={AXIS} width={170} tickLine={false} axisLine={false} />
          <Tooltip formatter={(v) => full(Number(v))} contentStyle={tooltipStyle} cursor={{ fill: "#f8fafc" }} />
          <Bar dataKey="spend" name="Spend" fill="#175cd3" radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RiskDistributionChart({ data }: { data: { department: string; High: number; Medium: number; Low: number }[] }) {
  if (data.every((d) => d.High + d.Medium + d.Low === 0)) return <Empty label="No analyzed claims yet" />;
  return (
    <div className="h-64" role="img" aria-label="Analyzed claims by department and risk level">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="#eef0f3" vertical={false} />
          <XAxis dataKey="department" tick={AXIS} tickLine={false} axisLine={false} interval={0} tickFormatter={(v: string) => v.replace(" Engineering", "").replace("Plant ", "")} />
          <YAxis tick={AXIS} allowDecimals={false} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f8fafc" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="High" stackId="r" fill="#b42318" maxBarSize={48} />
          <Bar dataKey="Medium" stackId="r" fill="#f79009" maxBarSize={48} />
          <Bar dataKey="Low" stackId="r" fill="#12b76a" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ParetoChart({ data }: { data: { anomalyType: string; count: number }[] }) {
  if (data.length === 0) return <Empty label="No exceptions raised in this period" />;
  return (
    <div style={{ height: Math.max(220, data.length * 26 + 20) }} role="img" aria-label="Exception counts by anomaly type">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eef0f3" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="anomalyType" interval={0} tick={AXIS} width={190} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f8fafc" }} />
          <Bar dataKey="count" name="Exceptions" fill="#b54708" radius={[0, 4, 4, 0]} maxBarSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BudgetChart({ data }: { data: { code: string; utilization: number; spendCents: number; budgetCents: number }[] }) {
  if (data.length === 0 || data.every((d) => d.spendCents === 0)) return <Empty label="No project spend" />;
  const rows = data.map((d) => ({ ...d, pct: Math.round(d.utilization * 1000) / 10, label: d.code.replace("PRJ-", "") }));
  return (
    <div className="h-64" role="img" aria-label="Project budget utilization, red above 90%">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="#eef0f3" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={0} angle={-18} textAnchor="end" height={48} />
          <YAxis tick={AXIS} unit="%" tickLine={false} axisLine={false} domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]} />
          <Tooltip formatter={(v) => `${v}%`} contentStyle={tooltipStyle} cursor={{ fill: "#f8fafc" }} />
          <Bar dataKey="pct" name="Utilization" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {rows.map((r) => (
              <Cell key={r.code} fill={r.pct > 90 ? "#b42318" : "#122c47"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
