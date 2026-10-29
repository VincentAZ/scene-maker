import type { Asset } from "../shared/scene";
import { libraryEntry } from "../shared/characterLibrary";
export function AssetArt({ asset }: { asset: Asset }) {
  const entry = libraryEntry(asset);
  if (entry)
    return <img src={entry.thumbnail} alt="" loading="lazy" decoding="async" />;
  const c = asset.color;
  return (
    <svg viewBox="0 0 160 125" aria-hidden="true">
      <ellipse cx="80" cy="112" rx="36" ry="7" fill="#0000000c" />
      {asset.category === "characters" ? (
        <g>
          <path
            d="M68 75L65 107M90 75L95 107"
            stroke="#49564f"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            d="M62 46L53 76M98 46L107 76"
            stroke={c}
            strokeWidth="13"
            strokeLinecap="round"
          />
          <path
            d="M53 76L57 88M107 76L103 88"
            stroke={asset.skin}
            strokeWidth="9"
            strokeLinecap="round"
          />
          <path d="M65 44Q80 36 95 44L99 75Q80 85 61 75Z" fill={c} />
          <rect x="74" y="31" width="12" height="13" rx="5" fill={asset.skin} />
          <ellipse cx="80" cy="24" rx="15" ry="19" fill={asset.skin} />
          {asset.body !== "mannequin" && (
            <>
              <path
                d="M64 24Q60 0 80 3Q99 2 96 25L90 14Q77 21 65 16Z"
                fill="#49382e"
              />
              <circle cx="74" cy="25" r="1.4" fill="#343a31" />
              <circle cx="86" cy="25" r="1.4" fill="#343a31" />
              {asset.body === "feminine" && (
                <path
                  d="M65 15Q56 34 64 44L69 33M95 15Q103 34 96 44L91 33"
                  fill="#49382e"
                />
              )}
            </>
          )}
          {["Chef", "Barista"].includes(asset.style) && (
            <path d="M71 47H89L94 78H66Z" fill="#eadcc3" />
          )}
          {["Builder", "Firefighter", "Astronaut", "Chef"].includes(
            asset.style,
          ) && (
            <path
              d="M61 19Q62 -2 80 1Q98 -2 99 19Z"
              fill={asset.style === "Chef" ? "#fffdf2" : c}
            />
          )}
          <path
            d="M61 109H70M91 109H102"
            stroke="#343d37"
            strokeWidth="9"
            strokeLinecap="round"
          />
        </g>
      ) : asset.category === "environments" ? (
        <g>
          <path d="M10 85L72 49L151 82L90 118Z" fill="#c2b297" />
          <path d="M10 85V27L72 5V49Z" fill="#d3c8af" />
          <path d="M72 5L151 31V82L72 49Z" fill="#e8dcc3" />
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              d={`M${82 + i * 22} ${18 + i * 7}v24l15 5V${23 + i * 7}Z`}
              fill="#9cab9c"
            />
          ))}
          <ellipse cx="83" cy="75" rx="24" ry="10" fill="#a17f58" />
          <path d="M83 75V99" stroke="#5c6653" strokeWidth="5" />
          <path d="M35 75V60" stroke="#577b55" strokeWidth="8" />
          <ellipse cx="35" cy="52" rx="12" ry="20" fill="#789265" />
        </g>
      ) : asset.style === "cup" ? (
        <g>
          <path d="M56 53H105L99 100Q81 113 61 100Z" fill={c} />
          <ellipse cx="80" cy="53" rx="25" ry="9" fill="#deb391" />
          <ellipse cx="80" cy="54" rx="20" ry="6" fill="#604732" />
          <path
            d="M104 62Q134 61 115 85L102 86"
            fill="none"
            stroke={c}
            strokeWidth="8"
          />
          <path
            d="M74 35Q65 27 77 17M88 35Q80 28 89 19"
            fill="none"
            stroke="#bfb8a7"
            strokeWidth="2"
          />
        </g>
      ) : asset.style === "plant" ? (
        <g>
          <path d="M60 83H102L95 113H67Z" fill="#c0896e" />
          {[-30, -15, 10, 28].map((x, i) => (
            <g key={x}>
              <path
                d={`M80 87L${80 + x} ${37 + i * 9}`}
                stroke="#69865b"
                strokeWidth="3"
              />
              <ellipse
                cx={80 + x}
                cy={37 + i * 9}
                rx="14"
                ry="24"
                fill={c}
                transform={`rotate(${x},${80 + x},${37 + i * 9})`}
              />
            </g>
          ))}
        </g>
      ) : asset.style === "ladder" ? (
        <g stroke={c} strokeWidth="7">
          <path d="M57 112V15M105 112V15" />
          {[30, 50, 70, 90].map((y) => (
            <path key={y} d={`M57 ${y}H105`} />
          ))}
        </g>
      ) : asset.style === "table" ? (
        <g>
          <path d="M80 62V108" stroke="#5b6355" strokeWidth="9" />
          <ellipse cx="80" cy="108" rx="23" ry="6" fill="#5b6355" />
          <ellipse cx="80" cy="59" rx="48" ry="17" fill={c} />
        </g>
      ) : (
        <g>
          <path d="M42 73L81 51L122 72L82 96Z" fill={c} />
          <path d="M42 73V97L82 119V96Z" fill={c} opacity=".8" />
          <path d="M122 72V96L82 119V96Z" fill={c} opacity=".65" />
          <path d="M42 73V38L80 17L80 51Z" fill={c} />
        </g>
      )}
    </svg>
  );
}
