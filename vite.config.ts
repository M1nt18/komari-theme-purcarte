import path from "path";
import fs from "fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const apiTarget = env.VITE_API_TARGET || "http://localhost:3000";

  return {
    base: "/themes/PurCarte/dist/",
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "exclude-examples",
        apply: "build",
        writeBundle(options) {
          if (options.dir) {
            const examplesDir = path.resolve(options.dir, "examples");
            if (fs.existsSync(examplesDir)) {
              fs.rmSync(examplesDir, { recursive: true, force: true });
            }
          }
        },
      },
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      assetsDir: "purcarte-assets",
      outDir: "dist",
      rollupOptions: {
        output: {
          // go embed ignore files start with '_'
          chunkFileNames: "purcarte-assets/chunk-[name]-[hash].js",
          entryFileNames: "purcarte-assets/entry-[name]-[hash].js",
          manualChunks: {
            "react-vendor": ["react", "react-dom"],
          },
        },
      },
    },
    server: {
      host: "0.0.0.0",
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
          secure: false,
          headers: {
            Origin: apiTarget,
          },
        },
      },
    },
  };
});
