import { ImageResponse } from "next/og";

export const alt =
  "Sermon Intelligence, free transcript tools for church media teams";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: "100%",
          height: "100%",
          flexDirection: "column",
          justifyContent: "space-between",
          overflow: "hidden",
          background:
            "linear-gradient(135deg, #09090b 0%, #111827 58%, #071d35 100%)",
          color: "white",
          padding: "68px 76px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -180,
            right: -110,
            display: "flex",
            width: 560,
            height: 560,
            borderRadius: 999,
            background: "rgba(11, 110, 208, 0.28)",
            filter: "blur(20px)",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            color: "#7dbef7",
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          Overflow Creative
          <div
            style={{
              display: "flex",
              width: 86,
              height: 3,
              borderRadius: 999,
              background: "#0b6ed0",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              display: "flex",
              maxWidth: 980,
              fontSize: 78,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: "-0.045em",
            }}
          >
            Sermon Intelligence
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: 900,
              color: "#d4d4d8",
              fontSize: 31,
              lineHeight: 1.35,
            }}
          >
            Turn a sermon transcript into YouTube metadata and social clip ideas.
          </div>
        </div>

        <div style={{ display: "flex", gap: 14 }}>
          {["Titles", "Descriptions", "Chapters", "Social Clips"].map(
            (label) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  border: "1px solid rgba(125, 190, 247, 0.3)",
                  borderRadius: 999,
                  background: "rgba(11, 110, 208, 0.12)",
                  color: "#bfdbfe",
                  padding: "12px 22px",
                  fontSize: 20,
                  fontWeight: 700,
                }}
              >
                {label}
              </div>
            ),
          )}
        </div>
      </div>
    ),
    size,
  );
}
