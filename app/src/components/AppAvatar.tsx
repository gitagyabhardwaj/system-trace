/**
 * A small, dependency-free app "icon": the first letter of the app name on a
 * stable colored chip. We derive the color deterministically from the app key
 * so the same app always looks the same, without extracting real OS icons
 * (which is platform-specific and tracked as a separate enhancement).
 */

const CHIP_COLORS = [
  "#2DD4BF",
  "#0EA5A0",
  "#34D399",
  "#F59E0B",
  "#F87171",
  "#8B5CF6",
  "#60A5FA",
  "#F472B6",
];

function hashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return CHIP_COLORS[h % CHIP_COLORS.length];
}

export function AppAvatar({
  name,
  appKey,
  size = 24,
}: {
  name: string;
  appKey: string;
  size?: number;
}) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  const bg = hashColor(appKey || name);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-md font-medium text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        fontSize: Math.round(size * 0.5),
      }}
    >
      {letter}
    </span>
  );
}
