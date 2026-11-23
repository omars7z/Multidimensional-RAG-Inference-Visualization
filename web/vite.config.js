import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev` serves the UI with hot reload and forwards /api to the Python server (python ui.py).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8001" } },
  build: { outDir: "dist", emptyOutDir: true },
});
