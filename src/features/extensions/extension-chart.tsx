import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ExtensionViewBlock } from "@/lib/tauri";

type ChartBlock = Extract<ExtensionViewBlock, { kind: "chart" }>;
/** Imported only when a plugin actually contributes a chart. */
export function ExtensionChart({ block }: { block: ChartBlock }) {
  const data = block.labels.map((label, index) =>
    Object.fromEntries([
      ["label", label],
      ...block.series.map((series, seriesIndex) => [
        `series${seriesIndex}`,
        series.values[index],
      ]),
    ]),
  );
  const Chart = block.chartType === "bar" ? BarChart : LineChart;
  return (
    <div className="h-64 min-w-0" role="img" aria-label={block.label}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" stroke="var(--muted-foreground)" />
          <YAxis stroke="var(--muted-foreground)" />
          <Tooltip
            contentStyle={{
              background: "var(--surface-popover)",
              backdropFilter: "blur(var(--surface-popup-blur))",
              WebkitBackdropFilter: "blur(var(--surface-popup-blur))",
              borderColor: "var(--border)",
              color: "var(--foreground)",
            }}
          />
          {block.series.length > 1 ? <Legend /> : null}
          {block.series.map((series, index) =>
            block.chartType === "bar" ? (
              <Bar
                key={index}
                dataKey={`series${index}`}
                name={series.label}
                fill={`var(--chart-${(index % 5) + 1})`}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={index}
                type="monotone"
                dataKey={`series${index}`}
                name={series.label}
                stroke={`var(--chart-${(index % 5) + 1})`}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}
