import path from "path";
import fs from "fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type UserConfig } from "vite";
import { reviewPreview } from './tools/review-preview';

// https://vite.dev/config/
export default defineConfig(async ({ mode, command }): Promise<UserConfig> => {
  if (mode === 'review' && command === 'build') throw new Error('Review mode is local development only');
  const env = loadEnv(mode, process.cwd());
  const apiTarget = env.VITE_API_TARGET || "http://127.0.0.1:3000";
  return {
    base: mode === 'review' ? '/' : env.VITE_RELEASE_BASE || "/themes/PurCarte/dist/",
    plugins: [
      react(),
      tailwindcss(),
      ...(mode === 'review' ? [reviewPreview(apiTarget)] : []),
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
      outDir: env.VITE_RELEASE_OUT || "dist",
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
      host: "127.0.0.1",
      proxy: {
        ...(mode === 'review' ? { '/themes': { target: apiTarget, changeOrigin: true, secure: true } } : {}),
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
          secure: true,
          headers: {
            Origin: apiTarget,
          },
        },
      },
    },
  };
});
