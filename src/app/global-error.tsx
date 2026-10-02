"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#f7f7f8",
          color: "#18181b",
          display: "flex",
          minHeight: "100dvh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
        }}
      >
        <div role="alert" style={{ maxWidth: 440, padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            Something went wrong
          </p>
          <p style={{ fontSize: 13, color: "#71717a", marginTop: 8 }}>
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "#a1a1aa", marginTop: 8 }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              background: "#18181b",
              color: "#ffffff",
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
