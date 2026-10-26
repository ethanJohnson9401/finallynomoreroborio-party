
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // Generate static HTML, CSS, and JavaScript.
    // Cloudflare Worker Assets will serve these files.
    output: "export",

    // Keep Turbopack scoped to the dashboard.
    turbopack: {
        root: process.cwd(),
    },

    // No server-side Next.js runtime required.
    poweredByHeader: false,
};

export default nextConfig;
