import cats from "../../resources/skins/cat-doodles.svg?url&no-inline";
import coffee from "../../resources/skins/coffee-break.svg?url&no-inline";
import mountains from "../../resources/skins/mountain-notes.svg?url&no-inline";
import stars from "../../resources/skins/star-notes.svg?url&no-inline";
import clouds from "../../resources/skins/cloud-notes.svg?url&no-inline";
import moons from "../../resources/skins/moon-orbits.svg?url&no-inline";
import leaves from "../../resources/skins/leaf-notes.svg?url&no-inline";
import planes from "../../resources/skins/paper-flights.svg?url&no-inline";
import { BACKGROUND_STYLES, type BuiltinBackground } from "@/lib/backgrounds";
import { cn } from "@/lib/utils";

const ARTWORKS = {
  aurora: cats,
  dune: coffee,
  inkwash: mountains,
  starlight: stars,
  sakura: clouds,
  moonlit: moons,
  botanical: leaves,
  cloudscape: planes,
} satisfies Record<Exclude<BuiltinBackground, "plain">, string>;

type PatternArtworkProps = {
  kind: BuiltinBackground;
  className?: string;
  preview?: boolean;
};

/** 静态 SVG 仅提供线条蒙版，颜色直接复用应用主题及强调色。 */
export function PatternArtwork({
  kind,
  className,
  preview = false,
}: PatternArtworkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pattern-artwork",
        preview && "pattern-artwork--preview",
        className,
      )}
      data-pattern={kind}
      data-art-style={BACKGROUND_STYLES[kind]}
    >
      {kind !== "plain" && (
        <span
          className="skin-scene"
          style={{ maskImage: 'url("' + ARTWORKS[kind] + '")' }}
        />
      )}
    </span>
  );
}
