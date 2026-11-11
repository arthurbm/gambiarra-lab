// The QR people scan to get a boneco. Shown on the telão during the entrance;
// it points at the world's public address (FREVO_PUBLIC_URL on the server),
// or at the page's own origin when the server has none.
import { useEffect, useMemo, useState } from "react";
import { encode } from "uqr";

const SCHEME = /^https?:\/\//;
const TRAILING_SLASH = /\/$/;

function usePublicUrl(): string {
  const [url, setUrl] = useState(window.location.origin);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((response) => (response.ok ? response.json() : null))
      .then((config: { publicUrl?: string | null } | null) => {
        if (!cancelled && config?.publicUrl) {
          setUrl(config.publicUrl);
        }
      })
      .catch(() => {
        // The page's own origin stays.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return url;
}

/** One path with a unit square per dark module. */
function qrPath(modules: boolean[][]): string {
  let path = "";
  for (const [y, row] of modules.entries()) {
    for (const [x, dark] of row.entries()) {
      if (dark) {
        path += `M${x} ${y}h1v1h-1z`;
      }
    }
  }
  return path;
}

export function EntradaQr() {
  const url = usePublicUrl();
  const qr = useMemo(() => encode(url, { border: 2 }), [url]);
  const shown = url.replace(SCHEME, "").replace(TRAILING_SLASH, "");
  return (
    <section aria-label="Entre na praça" className="entrada-qr">
      <h2>Entre na praça</h2>
      <svg
        aria-label={`QR para ${shown}`}
        className="entrada-qr-code"
        role="img"
        shapeRendering="crispEdges"
        viewBox={`0 0 ${qr.size} ${qr.size}`}
      >
        <rect fill="#fff" height={qr.size} width={qr.size} />
        <path d={qrPath(qr.data)} fill="#000" />
      </svg>
      <p className="entrada-qr-url">{shown}</p>
      <p className="entrada-qr-hint">Sem cadastro, direto no navegador.</p>
    </section>
  );
}
