import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Prevent Vite/Rollup build failures when dependencies reference Node built-ins
      // in optional code paths (e.g. loaders.gl process utils).
      child_process: path.resolve(__dirname, "./src/shims/child_process.ts"),
    },
  },
}));
