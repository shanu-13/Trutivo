import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

export default function config(phase: string): NextConfig {
  // NEXT_PUBLIC_API_URL is compiled into the browser bundle, so a production build
  // without it would silently call http://localhost:5000 from users' browsers.
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.NEXT_PUBLIC_API_URL) {
    throw new Error("NEXT_PUBLIC_API_URL must be set for a production build (e.g. https://api.example.com/api).");
  }
  return {
    // Self-contained server output (.next/standalone), used by the Docker image;
    // ordinary builds keep the default output so `npm start` works unchanged.
    output: process.env.NEXT_OUTPUT_STANDALONE === "true" ? "standalone" : undefined,
    poweredByHeader: false,
    // Address changes: old links keep working.
    async redirects() {
      return [
        // The public landing page lives at /trutivo. Temporary (307), so the
        // home address can still change without browsers caching it.
        { source: "/", destination: "/trutivo", permanent: false },
        { source: "/register", destination: "/signup", permanent: true },
      ];
    },
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "X-Frame-Options", value: "DENY" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ],
        },
      ];
    },
  };
}
