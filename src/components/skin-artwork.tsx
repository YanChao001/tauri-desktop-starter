import { useId } from "react";
import { BACKGROUND_STYLES, type BuiltinBackground } from "@/lib/backgrounds";
import { cn } from "@/lib/utils";

type PatternArtworkProps = {
  kind: BuiltinBackground;
  className?: string;
  preview?: boolean;
};

/** 八种独立视觉风格共用窗口与画廊的绘制入口。 */
export function PatternArtwork({
  kind,
  className,
  preview = false,
}: PatternArtworkProps) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `anime-${instance}-${name}`;
  const stamp = (
    name: string,
    x: number,
    y: number,
    width: number,
    height = width,
  ) => <use href={"#" + id(name)} x={x} y={y} width={width} height={height} />;
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
      data-art-style={BACKGROUND_STYLES[kind]}
      viewBox="0 0 1440 1000"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
    >
      {kind !== "plain" ? (
        <>
          <defs>
            {kind === "aurora" ? (
              <linearGradient id={id("flow")} x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="var(--skin-secondary)" />
                <stop offset="0.55" stopColor="var(--skin-color)" />
                <stop offset="1" stopColor="var(--skin-highlight)" />
              </linearGradient>
            ) : null}
            {kind === "sakura" ? (
              <>
                <symbol id={id("cloud")} viewBox="0 0 240 92">
                  <path
                    d="M 10 74 C -5 45 24 26 49 34 C 48 -3 106 -14 125 23 C 151 3 190 18 190 45 C 225 30 251 55 230 74 Z"
                    fill="var(--skin-paper)"
                  />
                  <path
                    d="M 10 74 H 230 Q 189 85 158 76 Q 111 88 73 77 Z"
                    fill="var(--skin-secondary)"
                  />
                  <path
                    d="M 34 59 Q 49 49 63 55 M 142 46 Q 161 36 174 49"
                    stroke="var(--skin-ink)"
                    strokeWidth="2"
                    opacity="0.5"
                    strokeLinecap="round"
                  />
                </symbol>
                <symbol id={id("traveler")} viewBox="0 0 180 290">
                  <path
                    d="M 31 110 Q 8 45 43 17 Q 93 -20 134 24 Q 169 50 145 120 L 149 160 120 147 46 151 22 162 Z"
                    fill="var(--skin-ink)"
                  />
                  <path
                    d="M 41 73 Q 41 27 89 27 Q 140 27 140 76 Q 140 122 91 125 Q 42 122 41 73"
                    fill="var(--skin-face)"
                  />
                  <path
                    d="M 36 69 Q 31 27 83 20 Q 137 17 148 69 L 121 50 120 69 103 44 95 69 78 46 60 69 Z"
                    fill="var(--skin-ink)"
                  />
                  <ellipse
                    cx="66"
                    cy="82"
                    rx="7"
                    ry="11"
                    fill="var(--skin-ink)"
                  />
                  <ellipse
                    cx="116"
                    cy="82"
                    rx="7"
                    ry="11"
                    fill="var(--skin-ink)"
                  />
                  <path
                    d="M 63 78 H 66 M 113 78 H 116"
                    stroke="var(--skin-paper)"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 85 103 Q 91 108 98 102"
                    stroke="var(--skin-ink)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 49 97 H 61 M 122 97 H 134"
                    stroke="var(--skin-highlight)"
                    strokeWidth="5"
                    opacity="0.75"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 61 126 119 125 137 207 42 207 Z"
                    fill="var(--skin-paper)"
                    stroke="var(--skin-ink)"
                    strokeWidth="2"
                  />
                  <path
                    d="M 59 137 27 193 42 201 70 164 M 121 135 151 191 137 201 109 161"
                    fill="var(--skin-secondary)"
                    stroke="var(--skin-ink)"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M 51 194 H 129 L 139 231 H 39 Z"
                    fill="var(--skin-color)"
                    stroke="var(--skin-ink)"
                    strokeWidth="2"
                  />
                  <path
                    d="M 62 232 V 267 H 77 V 233 M 104 233 V 267 H 120 V 232"
                    fill="var(--skin-face)"
                  />
                  <path
                    d="M 57 262 H 79 V 281 H 48 Q 45 271 57 262 M 104 262 H 124 L 135 278 Q 126 284 104 281 Z"
                    fill="var(--skin-ink)"
                  />
                  <path
                    d="M 53 124 Q 91 140 128 123 L 130 140 Q 91 156 51 140 Z M 123 132 Q 153 119 178 139 L 161 147 176 158 Q 142 144 119 148 Z"
                    fill="var(--skin-highlight)"
                  />
                </symbol>
                <symbol id={id("blossom")} viewBox="0 0 60 60">
                  <path
                    d="M 30 31 C 5 24 8 4 22 5 L 30 13 37 5 C 52 4 55 24 32 31 C 58 19 67 40 54 47 L 43 45 41 57 C 27 63 18 49 29 33 C 15 55 -1 43 5 31 L 17 28 13 16 C 18 7 32 17 30 31 Z"
                    fill="var(--skin-highlight)"
                    stroke="var(--skin-ink)"
                    strokeWidth="1"
                  />
                  <circle cx="30" cy="31" r="4" fill="var(--skin-paper)" />
                </symbol>
              </>
            ) : null}
            {kind === "botanical" ? (
              <symbol id={id("leaf")} viewBox="-40 -90 80 100">
                <path
                  d="M 0 0 C -40 -25 -44 -56 -1 -85 C 40 -58 33 -19 0 0 Z"
                  fill="var(--skin-secondary)"
                  fillOpacity="0.55"
                  stroke="var(--skin-ink)"
                  strokeWidth="1.5"
                />
                <path
                  d="M 0 0 -1 -76 M -1 -24 -21 -43 M -1 -39 21 -58 M -1 -53 -16 -66"
                  stroke="var(--skin-ink)"
                  strokeWidth="1.1"
                />
              </symbol>
            ) : null}
          </defs>
          <g
            className="skin-scene"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            {kind === "aurora" ? (
              <>
                <path
                  d="M -170 62 C 170 -127 466 -66 658 96 S 1167 389 1570 105 L 1570 308 C 1114 532 841 371 602 213 S 115 -5 -170 234 Z"
                  fill={"url(#" + id("flow") + ")"}
                />
                <path
                  d="M -110 695 C 161 450 338 709 635 823 S 1110 868 1530 664 L 1530 1030 H -110 Z"
                  fill={"url(#" + id("flow") + ")"}
                  opacity="0.55"
                />
                <path
                  d="M -160 87 C 187 -106 446 -37 630 118 S 1152 419 1550 164 M -160 109 C 185 -84 432 -15 614 139 S 1147 442 1550 190"
                  stroke="var(--skin-ink)"
                  strokeWidth="1.4"
                  opacity="0.55"
                />
                <path
                  d="M -90 721 C 177 489 349 741 636 850 S 1134 897 1525 711"
                  stroke="var(--skin-paper)"
                  strokeWidth="3"
                />
                <circle
                  cx="1224"
                  cy="171"
                  r="63"
                  stroke="var(--skin-ink)"
                  strokeWidth="1.5"
                />
                <path
                  d="M 1148 366 H 1265 M 1205 309 V 423 M 122 771 H 226"
                  stroke="var(--skin-highlight)"
                  strokeWidth="2"
                />
              </>
            ) : null}
            {kind === "dune" ? (
              <>
                <circle
                  cx="1264"
                  cy="173"
                  r="102"
                  fill="var(--skin-highlight)"
                />
                <path
                  d="M 1162 173 A 102 102 0 0 0 1366 173 Z"
                  fill="var(--skin-color)"
                />
                <path
                  d="M 1120 945 V 778 A 118 118 0 0 1 1356 778 V 945 Z"
                  fill="var(--skin-secondary)"
                />
                <path
                  d="M 1238 660 A 118 118 0 0 1 1356 778 V 945 H 1238 Z"
                  fill="var(--skin-color)"
                />
                <path
                  d="M 1160 945 V 790 A 78 78 0 0 1 1316 790 V 945"
                  stroke="var(--skin-paper)"
                  strokeWidth="3"
                />
                <path
                  d="M 35 808 H 224 V 997 H 35 Z"
                  fill="var(--skin-color)"
                />
                <circle cx="224" cy="808" r="94" fill="var(--skin-secondary)" />
                <path
                  d="M 35 997 224 808 V 997 Z"
                  fill="var(--skin-highlight)"
                />
                <path
                  d="M 70 98 H 259 V 287 H 70 Z M 107 135 H 222 V 250 H 107 Z M 1280 354 H 1404 M 1342 292 V 416 M 1095 970 H 1400"
                  stroke="var(--skin-ink)"
                  strokeWidth="1.5"
                />
                <path
                  d="M 68 673 H 244 M 68 688 H 244 M 68 703 H 244 M 68 718 H 244 M 68 733 H 244"
                  stroke="var(--skin-ink)"
                  strokeWidth="2"
                />
              </>
            ) : null}
            {kind === "inkwash" ? (
              <>
                <circle
                  cx="1251"
                  cy="174"
                  r="70"
                  fill="var(--skin-highlight)"
                />
                <path
                  d="M -75 1010 C -12 893 71 783 156 667 C 182 704 201 749 232 731 C 266 705 296 866 340 839 C 370 820 432 930 491 1020 Z"
                  fill="var(--skin-color)"
                  opacity="0.65"
                />
                <path
                  d="M 871 1030 C 946 864 1007 793 1081 659 C 1112 712 1139 750 1174 730 C 1210 694 1284 869 1312 835 C 1353 788 1427 934 1490 1010 Z"
                  fill="var(--skin-secondary)"
                />
                <path
                  d="M 983 1030 C 1078 857 1149 822 1225 720 C 1256 782 1273 808 1303 792 C 1351 762 1438 924 1490 955 V 1040 Z"
                  fill="var(--skin-ink)"
                  opacity="0.55"
                />
                <path
                  d="M 42 932 Q 89 818 156 667 M 160 696 190 777 221 761 M 1050 949 Q 1131 808 1225 720"
                  stroke="var(--skin-ink)"
                  strokeWidth="2.3"
                />
                <path
                  d="M 921 891 Q 1124 870 1480 895 M -20 958 Q 161 938 352 964"
                  stroke="var(--skin-paper)"
                  strokeWidth="18"
                />
                <path
                  d="M 863 970 Q 1123 951 1453 974 M 1100 991 H 1347 M 420 990 H 663"
                  stroke="var(--skin-ink)"
                  strokeWidth="1.4"
                />
                <path
                  d="M 1138 926 Q 1170 952 1206 927 Z M 1177 925 V 872 L 1204 925 Z"
                  fill="var(--skin-ink)"
                />
                <path
                  d="M 77 255 Q 126 130 224 23 M 135 131 Q 91 100 82 58 Q 128 74 142 115 M 169 83 Q 183 26 223 5 Q 216 55 179 88 M 109 186 Q 146 135 191 140 Q 165 182 120 197"
                  stroke="var(--skin-ink)"
                  strokeWidth="2.5"
                  fill="var(--skin-secondary)"
                />
                <path
                  d="M 1133 385 Q 1148 372 1163 384 Q 1179 371 1194 384 M 1220 407 Q 1232 399 1244 408 Q 1256 398 1268 408"
                  stroke="var(--skin-ink)"
                  strokeWidth="2"
                />
              </>
            ) : null}
            {kind === "starlight" ? (
              <>
                <g stroke="var(--skin-ink)" strokeWidth="1.6">
                  <path d="M 56 100 167 58 286 155 209 279 54 303 M 1172 322 1301 283 1394 415 1278 522 1181 444 Z M 999 906 H 1382 V 719 H 1249 V 772 H 999 Z" />
                  <path
                    d="M 1028 797 H 1349 M 1028 819 H 1216 M 1028 841 H 1314 M 1028 863 H 1175"
                    strokeDasharray="3 8"
                  />
                  <path d="M 22 762 H 196 V 974 H 22 M 44 792 H 166 M 44 820 H 123 M 44 848 H 149" />
                  <ellipse
                    cx="1270"
                    cy="150"
                    rx="139"
                    ry="38"
                    transform="rotate(-25 1270 150)"
                  />
                </g>
                <circle
                  cx="1270"
                  cy="150"
                  r="66"
                  fill="var(--skin-color)"
                  stroke="var(--skin-paper)"
                  strokeWidth="2"
                />
                <path
                  d="M 1210 173 Q 1274 137 1329 130"
                  stroke="var(--skin-paper)"
                  strokeWidth="4"
                />
                {(
                  [
                    [56, 100],
                    [167, 58],
                    [286, 155],
                    [209, 279],
                    [54, 303],
                    [1172, 322],
                    [1301, 283],
                    [1394, 415],
                    [1278, 522],
                    [1181, 444],
                  ] as const
                ).map(([x, y]) => (
                  <circle
                    key={x}
                    cx={x}
                    cy={y}
                    r="5"
                    fill="var(--skin-highlight)"
                  />
                ))}
                <path
                  d="M 341 74 V 96 M 330 85 H 352 M 1370 615 V 637 M 1359 626 H 1381 M 304 898 V 920 M 293 909 H 315 M 1114 705 V 721 M 1106 713 H 1122"
                  stroke="var(--skin-secondary)"
                  strokeWidth="2"
                />
                <path
                  d="M 144 96 H 191 M 1090 941 H 1379 M 1413 747 V 901"
                  stroke="var(--skin-highlight)"
                  strokeWidth="3"
                />
              </>
            ) : null}
            {kind === "sakura" ? (
              <>
                <path
                  d="M -65 333 Q 27 183 176 124 T 427 -25 M 100 178 69 40 M 212 109 295 162 M 306 66 329 -20"
                  stroke="var(--skin-ink)"
                  strokeWidth="7"
                />
                {[
                  [34, 215, 76],
                  [81, 140, 86],
                  [139, 103, 94],
                  [203, 52, 88],
                  [280, 23, 94],
                  [291, 134, 72],
                  [11, 82, 80],
                ].map(([x, y, size]) => (
                  <g key={x}>{stamp("blossom", x!, y!, size!)}</g>
                ))}
                {stamp("cloud", 1101, 132, 340, 130)}
                <path
                  d="M 0 1020 Q 155 861 397 989 T 900 1000 T 1510 868 V 1040 H 0 Z"
                  fill="var(--skin-secondary)"
                />
                <path
                  d="M 1050 941 H 1430 M 1050 955 H 1430 M 1080 925 V 1000 M 1396 913 V 1000"
                  stroke="var(--skin-ink)"
                  strokeWidth="4"
                />
                {stamp("traveler", 1210, 595, 180, 290)}
                {[
                  [1350, 381, -25],
                  [1140, 545, 35],
                  [97, 548, -10],
                  [288, 375, 20],
                  [1391, 644, 45],
                  [252, 853, -25],
                ].map(([x, y, angle]) => (
                  <path
                    key={x}
                    d="M 0 0 Q -18 -11 -6 -27 Q 18 -21 0 0 Z"
                    transform={`translate(${x} ${y}) rotate(${angle})`}
                    fill="var(--skin-highlight)"
                  />
                ))}
              </>
            ) : null}
            {kind === "moonlit" ? (
              <>
                <g shapeRendering="crispEdges">
                  <path
                    d="M 1220 76 H 1300 V 92 H 1332 V 124 H 1348 V 204 H 1332 V 236 H 1300 V 252 H 1220 V 236 H 1188 V 204 H 1172 V 124 H 1188 V 92 H 1220 Z"
                    fill="var(--skin-highlight)"
                  />
                  <path
                    d="M 1190 158 H 1222 V 190 H 1190 Z M 1284 108 H 1316 V 140 H 1284 Z M 1270 204 H 1286 V 220 H 1270 Z"
                    fill="var(--skin-secondary)"
                  />
                  <path
                    d="M -32 1016 V 920 H 0 V 856 H 32 V 792 H 64 V 728 H 96 V 664 H 128 V 728 H 160 V 792 H 192 V 856 H 224 V 920 H 256 V 984 H 352 V 952 H 384 V 888 H 416 V 856 H 448 V 920 H 480 V 984 H 640 V 1048 Z"
                    fill="var(--skin-secondary)"
                  />
                  <path
                    d="M 864 1048 V 984 H 928 V 920 H 960 V 856 H 992 V 792 H 1024 V 728 H 1056 V 792 H 1088 V 856 H 1120 V 920 H 1152 V 984 H 1248 V 920 H 1280 V 856 H 1312 V 792 H 1344 V 728 H 1376 V 792 H 1408 V 856 H 1472 V 1048 Z"
                    fill="var(--skin-color)"
                  />
                  <path
                    d="M 36 920 H 68 V 856 H 84 V 792 H 100 V 760 H 116 V 792 H 132 V 856 H 148 V 920 H 180 V 936 H 116 V 1000 H 100 V 936 H 36 Z"
                    fill="var(--skin-ink)"
                  />
                  <path
                    d="M 64 97 H 80 V 81 H 96 V 97 H 112 V 113 H 96 V 129 H 80 V 113 H 64 Z M 1088 353 H 1104 V 337 H 1120 V 353 H 1136 V 369 H 1120 V 385 H 1104 V 369 H 1088 Z M 1350 500 H 1366 V 516 H 1350 Z M 264 360 H 280 V 376 H 264 Z"
                    fill="var(--skin-paper)"
                  />
                  <g transform="translate(1256 818) scale(2)">
                    <path
                      d="M 0 0 H 8 V 8 H 32 V 0 H 40 V 32 H 32 V 48 H 48 V 32 H 56 V 56 H 8 V 32 H 0 Z"
                      fill="var(--skin-ink)"
                    />
                    <path
                      d="M 8 16 H 16 V 24 H 8 Z M 24 16 H 32 V 24 H 24 Z"
                      fill="var(--skin-highlight)"
                    />
                    <path
                      d="M 0 32 H 40 V 40 H 24 V 56 H 16 V 40 H 0 Z"
                      fill="var(--skin-highlight)"
                    />
                  </g>
                  <path
                    d="M 762 976 H 890 V 984 H 762 Z M 930 1000 H 1114 V 1008 H 930 Z"
                    fill="var(--skin-paper)"
                  />
                </g>
              </>
            ) : null}
            {kind === "botanical" ? (
              <>
                <g stroke="var(--skin-ink)" fill="none">
                  <path
                    d="M -30 1030 C 124 741 106 460 257 40 M 58 873 Q 194 812 257 721 M 86 698 Q 41 613 9 529 M 131 495 Q 228 419 282 291 M 1302 1040 Q 1311 746 1465 518 M 1320 819 Q 1213 751 1167 646 M 1368 673 Q 1433 605 1487 571"
                    strokeWidth="3"
                  />
                  <path
                    d="M 94 979 C 207 840 240 696 228 569 M 1299 994 Q 1222 899 1200 792"
                    strokeWidth="1.4"
                  />
                </g>
                {(
                  [
                    [53, 795, 138, -42],
                    [94, 632, 132, 43],
                    [124, 435, 144, -40],
                    [178, 238, 132, 36],
                    [226, 77, 116, -18],
                    [160, 830, 120, 36],
                    [223, 713, 116, 30],
                    [14, 527, 120, -30],
                    [246, 329, 110, 35],
                    [1268, 835, 138, -37],
                    [1195, 677, 120, -32],
                    [1318, 648, 132, 31],
                    [1406, 551, 120, 35],
                  ] as const
                ).map(([x, y, size, angle]) => (
                  <use
                    key={x}
                    href={"#" + id("leaf")}
                    x={x - size / 2}
                    y={y - size}
                    width={size}
                    height={size * 1.25}
                    transform={"rotate(" + angle + " " + x + " " + y + ")"}
                  />
                ))}
                <path
                  d="M 44 1003 Q 279 910 359 741 M 334 792 304 770 M 316 826 276 798 M 292 861 248 833 M 266 893 218 871 M 235 920 195 901 M 358 740 370 780 M 343 783 356 822 M 326 818 337 858 M 305 853 310 893"
                  stroke="var(--skin-ink)"
                  strokeWidth="2"
                />
                <path
                  d="M 1179 129 H 1388 M 1179 145 H 1330 M 1179 161 H 1262"
                  stroke="var(--skin-color)"
                  strokeWidth="1.3"
                />
                <ellipse
                  cx="1260"
                  cy="196"
                  rx="10"
                  ry="4"
                  transform="rotate(-22 1260 196)"
                  fill="var(--skin-highlight)"
                />
              </>
            ) : null}
            {kind === "cloudscape" ? (
              <>
                <path
                  d="M -60 42 Q 85 -61 197 11 Q 288 71 274 147 Q 183 103 138 173 Q 34 236 -60 180 Z"
                  fill="var(--skin-color)"
                  stroke="var(--skin-ink)"
                  strokeWidth="2"
                />
                <path
                  d="M -60 65 Q 67 -35 174 39 Q 240 83 229 128 Q 151 98 103 168 Q 24 206 -60 165 Z"
                  fill="var(--skin-secondary)"
                  stroke="var(--skin-paper)"
                  strokeWidth="4"
                />
                <circle
                  cx="1260"
                  cy="176"
                  r="102"
                  fill="var(--skin-highlight)"
                  stroke="var(--skin-paper)"
                  strokeWidth="12"
                />
                <path
                  d="M -50 1030 V 856 C 14 748 114 787 137 835 C 190 741 304 776 320 855 C 415 823 482 905 467 1030 Z"
                  fill="var(--skin-color)"
                  stroke="var(--skin-ink)"
                  strokeWidth="2"
                />
                <path
                  d="M -50 1030 V 916 C 30 810 131 864 154 907 C 205 822 296 862 319 923 C 392 886 439 961 428 1030 Z"
                  fill="var(--skin-secondary)"
                  stroke="var(--skin-paper)"
                  strokeWidth="4"
                />
                <path
                  d="M -50 1030 V 978 Q 70 902 156 986 Q 225 935 279 993 L 300 1030 Z"
                  fill="var(--skin-paper)"
                />
                <path
                  d="M 950 1040 C 907 937 987 846 1073 872 C 1062 776 1178 738 1239 812 C 1329 716 1459 794 1500 891 V 1040 Z"
                  fill="var(--skin-color)"
                  stroke="var(--skin-ink)"
                  strokeWidth="2"
                />
                <path
                  d="M 990 1040 C 954 953 1032 894 1113 922 C 1124 832 1207 824 1259 885 C 1343 806 1427 866 1500 940 V 1040 Z"
                  fill="var(--skin-secondary)"
                  stroke="var(--skin-paper)"
                  strokeWidth="4"
                />
                <path
                  d="M 1092 1040 Q 1078 964 1170 978 Q 1239 900 1309 961 Q 1415 916 1500 1007 V 1040 Z"
                  fill="var(--skin-paper)"
                />
                <path
                  d="M 1140 432 1378 338 1289 517 1250 457 Z"
                  fill="var(--skin-paper)"
                  stroke="var(--skin-ink)"
                  strokeWidth="2"
                />
                <path
                  d="M 1250 457 1378 338 1247 492 Z"
                  fill="var(--skin-highlight)"
                  stroke="var(--skin-ink)"
                  strokeWidth="1.5"
                />
                <path
                  d="M 1125 490 Q 1028 508 1028 432"
                  stroke="var(--skin-ink)"
                  strokeWidth="1.5"
                  strokeDasharray="4 10"
                />
              </>
            ) : null}
          </g>
        </>
      ) : null}
    </svg>
  );
}
