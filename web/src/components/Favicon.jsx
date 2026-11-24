import { useState } from "react";
import { Icon } from "../icons.jsx";
import { faviconUrl } from "../sources.js";

/** The source site's favicon in a small rounded tile; a globe or file icon when there is none or it fails to load. */
export function Favicon({ hit, size = 16 }) {
  const src = faviconUrl(hit);
  const [failed, setFailed] = useState(false);
  return (
    <span className="favicon" style={{ width: size + 6, height: size + 6 }} aria-hidden="true">
      {src && !failed
        ? <img src={src} width={size} height={size} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : <Icon name={hit.source_type === "url" ? "globe" : "file"} size="xs" />}
    </span>
  );
}
