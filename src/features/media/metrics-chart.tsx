import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/providers/i18n";
import { demoMetrics } from "./model";

export function MetricsChart() {
  const { t } = useI18n();
  const [metric, setMetric] = useState<"requests" | "latency">("requests");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("labs.media.chart")}</CardTitle>
        <CardDescription>{t("labs.media.chartHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="chart-metric">{t("labs.media.metric")}</Label>
          <select
            id="chart-metric"
            value={metric}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            onChange={(event) =>
              setMetric(
                event.target.value === "latency" ? "latency" : "requests",
              )
            }
          >
            <option value="requests">{t("labs.media.requests")}</option>
            <option value="latency">{t("labs.media.latency")}</option>
          </select>
        </div>
        <div
          className="h-56 w-full min-w-0"
          role="img"
          aria-label={`${t("labs.media.chart")} · ${t(`labs.media.${metric}`)}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={demoMetrics} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" stroke="var(--muted-foreground)" />
              <YAxis stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  borderColor: "var(--border)",
                  color: "var(--foreground)",
                }}
              />
              <Line
                type="monotone"
                dataKey={metric}
                name={t(`labs.media.${metric}`)}
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{t("labs.media.chart")}</caption>
          <thead>
            <tr>
              {["day", "requests", "latency"].map((key) => (
                <th scope="col" className="border-b p-2 font-medium" key={key}>
                  {t(`labs.media.${key as "day" | "requests" | "latency"}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {demoMetrics.map((item) => (
              <tr key={item.day}>
                <th scope="row" className="p-2 font-normal">
                  {item.day}
                </th>
                <td className="p-2">{item.requests}</td>
                <td className="p-2">{item.latency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
