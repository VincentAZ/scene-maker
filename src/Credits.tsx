import { ExternalLink } from "lucide-react";
import { creditGroups } from "../shared/contentLibrary";

const kinds = {
  characters: "Character",
  props: "Prop",
  environments: "Set",
} as const;

/** Who made the characters, props and sets in the library, by collection. */
export function Credits() {
  const groups = creditGroups();
  return (
    <div className="credits">
      <p className="muted">
        The library is built from the work of these artists and archives, shared
        under open licences. Thank them when you share your films.
      </p>
      {groups.map((group) => (
        <section key={group.collection}>
          <h3>
            {group.collection}
            <small>
              {group.items.length} {group.items.length === 1 ? "item" : "items"}{" "}
              · {group.licenses.join(", ")}
            </small>
          </h3>
          <ul>
            {group.items.map((item) => (
              <li key={item.id}>
                <span className="credit-kind">{kinds[item.category]}</span>
                <strong>{item.name}</strong>
                <span>
                  {item.author} · {item.license}
                </span>
                <a
                  href={item.source}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Source of ${item.name}`}
                >
                  <ExternalLink size={13} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
