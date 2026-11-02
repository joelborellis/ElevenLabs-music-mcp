import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained HTML file: MCP Apps hosts receive the widget as resource
// text, so scripts and styles must be inlined (no separate chunks/assets).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "../assets",
    emptyOutDir: false,
    rollupOptions: { input: "studio.html" },
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
});
