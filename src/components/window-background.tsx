import { useId } from "react";
import type { Background } from "@/lib/backgrounds";
import { cn } from "@/lib/utils";
import { useSettings } from "@/providers/settings";

const STARS = [
  [70, 62, 17],
  [184, 113, 11],
  [300, 47, 13],
  [435, 98, 8],
  [810, 38, 7],
  [990, 84, 12],
  [1130, 40, 8],
  [1300, 106, 19],
  [1400, 215, 10],
  [88, 265, 11],
  [168, 405, 16],
  [38, 530, 8],
  [146, 655, 10],
  [60, 825, 18],
  [275, 950, 10],
  [490, 920, 7],
  [925, 967, 9],
  [1140, 900, 15],
  [1320, 805, 10],
  [1410, 670, 18],
] as const;

const BLOSSOMS = [
  [38, 227, 1.2],
  [110, 170, 1.15],
  [176, 145, 1.3],
  [245, 102, 0.95],
  [312, 80, 1.25],
  [385, 38, 0.9],
  [140, 86, 0.85],
  [207, 25, 1.1],
  [46, 116, 0.9],
  [350, 139, 0.85],
  [90, 295, 0.8],
  [21, 365, 1],
] as const;

const LEAVES = [
  [91, 895, -65, 1.15],
  [116, 796, 48, 1.05],
  [119, 690, -51, 1.2],
  [140, 583, 55, 0.95],
  [163, 482, -44, 1.05],
  [198, 367, 57, 0.85],
  [241, 258, -38, 0.95],
  [283, 150, 53, 0.7],
  [325, 44, -31, 0.8],
] as const;

type PatternArtworkProps = {
  kind: Background;
  className?: string;
  preview?: boolean;
};

/** 原创静态插画供窗口与缩略图复用；独立 SVG ID 避免多张预览互相引用。 */
export function PatternArtwork({
  kind,
  className,
  preview = false,
}: PatternArtworkProps) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `skin-${instance}-${name}`;
  const glow = `url(#${id("glow")})`;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cn(
        "pattern-artwork",
        preview && "pattern-artwork--preview",
        className,
      )}
      data-pattern={kind}
      viewBox="0 0 1440 1000"
      preserveAspectRatio={preview ? "xMidYMid meet" : "xMidYMid slice"}
      fill="none"
    >
      {kind !== "plain" && (
        <>
          <defs>
            <radialGradient id={id("glow")}>
              <stop stopColor="var(--skin-color)" />
              <stop offset="1" stopColor="var(--skin-color)" stopOpacity="0" />
            </radialGradient>
            {kind === "starlight" && (
              <symbol id={id("star")} viewBox="-12 -12 24 24">
                <path
                  d="m 0 -11 3.3 7 7.7 1.1 -5.5 5.4 1.3 7.7 L 0 6 -6.8 10.2 -5.5 2.5 -11 -2.9 -3.3 -4 Z"
                  stroke="currentColor"
                  strokeWidth="0.8"
                  vectorEffect="non-scaling-stroke"
                />
              </symbol>
            )}
            {kind === "sakura" && (
              <symbol id={id("blossom")} viewBox="-28 -28 56 56">
                {[0, 72, 144, 216, 288].map((angle) => (
                  <path
                    key={angle}
                    d="M 0 1 C -15 -6 -15 -21 -5 -23 L 0 -19 5 -23 C 15 -21 15 -6 0 1 Z"
                    transform={`rotate(${angle})`}
                    fill="var(--skin-secondary)"
                    stroke="var(--skin-ink)"
                    strokeWidth="0.65"
                  />
                ))}
                <circle r="3" fill="var(--skin-highlight)" />
                <g stroke="var(--skin-highlight)" strokeWidth="1.1">
                  <path d="M -6 -4 5 5 M -5 5 5 -5 M 0 -7 V 7" />
                </g>
              </symbol>
            )}
            {kind === "botanical" && (
              <symbol id={id("leaf")} viewBox="-36 -78 72 84">
                <path
                  d="M 0 0 C -33 -13 -34 -49 0 -74 C 28 -47 28 -15 0 0 Z"
                  fill="var(--skin-secondary)"
                  stroke="var(--skin-ink)"
                  strokeWidth="0.8"
                />
                <path
                  d="M 0 -4 V -62 M 0 -27 -15 -41 M 0 -38 13 -50"
                  stroke="var(--skin-ink)"
                  strokeWidth="0.7"
                />
              </symbol>
            )}
            {kind === "cloudscape" && (
              <symbol id={id("cloud")} viewBox="-150 -65 300 110">
                <path
                  d="M -133 29 C -149 7 -129 -15 -102 -9 C -105 -56 -38 -70 -14 -32 C 10 -67 73 -47 74 -12 C 116 -28 152 3 133 29 Z"
                  fill="var(--skin-secondary)"
                  stroke="var(--skin-ink)"
                  strokeWidth="0.9"
                />
                <path
                  d="M -96 13 C -60 21 -39 10 -17 16 M 38 11 C 65 19 88 8 108 16"
                  stroke="var(--skin-ink)"
                  strokeWidth="0.7"
                />
              </symbol>
            )}
          </defs>

          <g className="skin-glow">
            <ellipse cx="90" cy="40" rx="700" ry="600" fill={glow} />
            <ellipse
              cx="1400"
              cy="960"
              rx="680"
              ry="570"
              fill={glow}
              opacity="0.65"
            />
          </g>

          {kind === "starlight" && (
            <>
              <g
                className="skin-lines"
                stroke="var(--skin-ink)"
                strokeWidth="0.8"
                strokeLinecap="round"
              >
                <path d="M -130 288 C 290 -112 1000 -140 1530 167" />
                <path
                  d="M -110 311 C 330 -100 1020 -112 1540 196"
                  strokeDasharray="2 16"
                />
                <path d="M 70 62 184 113 300 47 435 98 M 38 530 168 405 88 265 M 1140 900 1320 805 1410 670" />
                <path d="M 880 1080 C 1150 840 1320 810 1540 835" />
              </g>
              <g
                className="skin-fill"
                color="var(--skin-ink)"
                fill="var(--skin-secondary)"
              >
                {STARS.map(([x, y, size], index) => (
                  <use
                    key={`${x}-${y}`}
                    href={`#${id("star")}`}
                    x={x - size}
                    y={y - size}
                    width={size * 2}
                    height={size * 2}
                    transform={`rotate(${index % 2 ? 14 : -12} ${x} ${y})`}
                  />
                ))}
              </g>
              <g
                className="skin-lines"
                stroke="var(--skin-highlight)"
                strokeWidth="1.2"
                strokeLinecap="round"
              >
                {(
                  [
                    [125, 36],
                    [360, 183],
                    [1215, 210],
                    [1350, 460],
                    [85, 740],
                    [1000, 915],
                  ] as const
                ).map(([x, y]) => (
                  <path
                    key={`${x}-${y}`}
                    d={`M ${x - 5} ${y} H ${x + 5} M ${x} ${y - 5} V ${y + 5}`}
                  />
                ))}
              </g>
            </>
          )}

          {kind === "sakura" && (
            <>
              <g
                className="skin-lines"
                stroke="var(--skin-ink)"
                strokeLinecap="round"
              >
                <path
                  d="M -45 397 C 17 276 93 175 207 115 S 320 74 401 -20"
                  strokeWidth="2.6"
                />
                <path
                  d="M 73 229 48 106 M 149 157 136 77 208 13 M 209 115 301 157 356 135 M 304 72 306 2"
                  strokeWidth="1.3"
                />
                <path
                  d="M 1490 1040 C 1360 895 1321 867 1190 856 L 1136 793 M 1350 914 1377 819"
                  strokeWidth="1.7"
                />
              </g>
              <g className="skin-fill">
                {BLOSSOMS.map(([x, y, scale]) => (
                  <use
                    key={`${x}-${y}`}
                    href={`#${id("blossom")}`}
                    x={x - 27 * scale}
                    y={y - 27 * scale}
                    width={54 * scale}
                    height={54 * scale}
                    transform={`rotate(${x % 45} ${x} ${y})`}
                  />
                ))}
                {(
                  [
                    [1190, 856],
                    [1255, 871],
                    [1350, 914],
                    [1377, 819],
                    [1140, 795],
                  ] as const
                ).map(([x, y]) => (
                  <use
                    key={`${x}-${y}`}
                    href={`#${id("blossom")}`}
                    x={x - 27}
                    y={y - 27}
                    width="54"
                    height="54"
                  />
                ))}
              </g>
              <g className="skin-fill" fill="var(--skin-secondary)">
                {(
                  [
                    [322, 235, 25],
                    [170, 392, -30],
                    [67, 560, 48],
                    [1300, 370, 20],
                    [1358, 598, -25],
                    [1190, 717, 40],
                    [256, 831, -12],
                  ] as const
                ).map(([x, y, angle]) => (
                  <path
                    key={`${x}-${y}`}
                    d="M 0 0 C -20 -5 -19 -24 -4 -29 C 11 -19 12 -6 0 0 Z"
                    transform={`translate(${x} ${y}) rotate(${angle})`}
                  />
                ))}
              </g>
            </>
          )}

          {kind === "moonlit" && (
            <>
              <ellipse
                className="skin-glow"
                cx="1270"
                cy="150"
                rx="300"
                ry="260"
                fill={glow}
              />
              <g className="skin-fill">
                <path
                  d="M 1290 56 A 88 88 0 1 0 1362 197 A 74 74 0 0 1 1290 56 Z"
                  fill="var(--skin-highlight)"
                  stroke="var(--skin-ink)"
                  strokeWidth="1"
                />
                <path
                  d="M -80 952 C 4 928 63 845 123 832 S 220 894 281 863 S 372 758 433 744 S 529 813 586 835 S 706 802 766 790 S 900 871 987 880 S 1115 806 1202 783 S 1374 871 1510 922 V 1030 H -80 Z"
                  fill="var(--skin-secondary)"
                  opacity="0.7"
                />
                <path
                  d="M -80 1008 C 61 962 119 886 207 899 S 343 978 431 956 S 582 863 670 870 S 801 946 892 933 S 1009 877 1086 889 S 1257 976 1333 939 S 1435 883 1510 898 V 1050 H -80 Z"
                  fill="var(--skin-color)"
                  opacity="0.7"
                />
                <path
                  d="M 408 985 C 667 947 962 943 1510 979 V 1040 H 365 Z"
                  fill="var(--skin-secondary)"
                  opacity="0.5"
                />
                <path
                  d="M 1100 245 C 1136 231 1164 240 1194 230 C 1193 213 1215 204 1228 216 C 1244 199 1267 213 1272 225 C 1310 218 1330 242 1375 232 S 1436 234 1480 225 L 1490 248 C 1399 260 1321 248 1248 254 S 1148 247 1100 255 Z"
                  fill="var(--skin-secondary)"
                />
                <g transform="translate(173 905)" fill="var(--skin-ink)">
                  <path d="M 0 -112 C -3 -91 -13 -75 -22 -66 L -12 -68 C -17 -48 -31 -31 -39 -25 L -23 -28 C -28 -9 -42 5 -49 11 L -8 5 V 38 H 8 V 5 L 49 11 C 42 5 28 -9 23 -28 L 39 -25 C 31 -31 17 -48 12 -68 L 22 -66 C 13 -75 3 -91 0 -112 Z" />
                </g>
                <g
                  transform="translate(108 944) scale(0.65)"
                  fill="var(--skin-ink)"
                >
                  <path d="M 0 -112 C -3 -91 -13 -75 -22 -66 L -12 -68 C -17 -48 -31 -31 -39 -25 L -23 -28 C -28 -9 -42 5 -49 11 L -8 5 V 38 H 8 V 5 L 49 11 C 42 5 28 -9 23 -28 L 39 -25 C 31 -31 17 -48 12 -68 L 22 -66 C 13 -75 3 -91 0 -112 Z" />
                </g>
              </g>
              <g
                className="skin-lines"
                stroke="var(--skin-ink)"
                strokeWidth="1"
                strokeLinecap="round"
              >
                <path d="M -80 952 C 4 928 63 845 123 832 S 220 894 281 863 S 372 758 433 744 S 529 813 586 835 M 987 880 C 1080 886 1115 806 1202 783 S 1374 871 1510 922" />
                <path d="M -80 158 C 12 119 90 153 145 133 S 252 108 303 129 M 1054 312 C 1151 287 1235 323 1332 294 S 1440 283 1490 303" />
                <path d="M 66 82 H 76 M 71 77 V 87 M 308 51 H 316 M 312 47 V 55 M 1080 86 H 1090 M 1085 81 V 91" />
                <path d="M 628 978 Q 711 970 784 977 M 881 962 Q 958 956 1045 962 M 1096 988 Q 1179 982 1250 987 M 813 999 Q 864 994 924 998" />
                <path
                  d="M 1198 963 H 1247 M 1213 973 H 1266 M 1238 984 H 1283"
                  stroke="var(--skin-highlight)"
                />
              </g>
            </>
          )}

          {kind === "botanical" && (
            <>
              <g
                className="skin-lines"
                stroke="var(--skin-ink)"
                strokeLinecap="round"
              >
                <path
                  d="M 48 1060 C 132 835 90 663 169 463 S 284 168 352 -60"
                  strokeWidth="1.5"
                />
                <path
                  d="M 1510 736 C 1318 774 1365 967 1130 1060"
                  strokeWidth="1.3"
                />
              </g>
              <g className="skin-fill">
                {LEAVES.map(([x, y, angle, scale]) => (
                  <use
                    key={`${x}-${y}`}
                    href={`#${id("leaf")}`}
                    x={x - 36 * scale}
                    y={y - 78 * scale}
                    width={72 * scale}
                    height={84 * scale}
                    transform={`rotate(${angle} ${x} ${y})`}
                  />
                ))}
                {(
                  [
                    [1425, 795, 100],
                    [1360, 861, -30],
                    [1314, 931, 108],
                    [1223, 1015, -25],
                  ] as const
                ).map(([x, y, angle]) => (
                  <use
                    key={`${x}-${y}`}
                    href={`#${id("leaf")}`}
                    x={x - 47}
                    y={y - 101}
                    width="94"
                    height="110"
                    transform={`rotate(${angle} ${x} ${y})`}
                  />
                ))}
              </g>
              <g
                className="skin-lines"
                stroke="var(--skin-highlight)"
                strokeWidth="0.8"
              >
                <circle cx="65" cy="300" r="24" />
                <circle cx="1260" cy="110" r="37" />
                <path d="M 1163 174 C 1215 156 1303 162 1363 140" />
              </g>
            </>
          )}

          {kind === "cloudscape" && (
            <>
              <g className="skin-fill">
                <circle
                  cx="1275"
                  cy="115"
                  r="53"
                  fill="var(--skin-highlight)"
                />
                {(
                  [
                    [103, 140, 1.3],
                    [1330, 240, 1.65],
                    [170, 947, 1.7],
                    [1300, 965, 1.25],
                  ] as const
                ).map(([x, y, scale]) => (
                  <use
                    key={`${x}-${y}`}
                    href={`#${id("cloud")}`}
                    x={x - 150 * scale}
                    y={y - 65 * scale}
                    width={300 * scale}
                    height={110 * scale}
                  />
                ))}
              </g>
              <g
                className="skin-lines"
                stroke="var(--skin-ink)"
                strokeWidth="1.2"
                strokeLinecap="round"
              >
                <path d="M 1040 99 Q 1055 87 1070 101 Q 1085 88 1101 98 M 1114 149 Q 1123 140 1133 150 Q 1143 140 1153 148" />
                <path
                  d="M -60 357 C 30 335 90 361 162 345 M 1280 618 C 1360 596 1400 617 1480 594 M 946 944 C 1040 923 1095 949 1150 931"
                  strokeWidth="0.8"
                />
              </g>
            </>
          )}
        </>
      )}
    </svg>
  );
}

/** 装饰固定铺满窗口，不参与滚动、点击、拖拽或键盘焦点。 */
export function WindowBackground() {
  const { settings } = useSettings();
  return (
    <div
      className="window-background"
      data-window-background
      aria-hidden="true"
    >
      <PatternArtwork kind={settings.background} />
    </div>
  );
}
