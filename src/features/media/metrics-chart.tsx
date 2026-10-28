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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/providers/i18n";
import { demoMetrics } from "./model";

export function MetricsChart() {
  const { t } = useI18n();
  const [metric, setMetric] = useState<"requests" | "latency">("requests");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("labs.media.chart")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="chart-metric">{t("labs.media.metric")}</Label>
          <Select
            value={metric}
            onValueChange={(value) =>
              setMetric(value === "latency" ? "latency" : "requests")
            }
          >
            <SelectTrigger id="chart-metric">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="requests">
                {t("labs.media.requests")}
              </SelectItem>
              <SelectItem value="latency">{t("labs.media.latency")}</SelectItem>
            </SelectContent>
          </Select>
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
