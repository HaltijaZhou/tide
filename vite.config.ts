import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({

  plugins: [
    // Vditor 运行时资源本地化（Lute/i18n/图标/内容主题 CSS），离线可用。
    // Vditor 的 cdn 选项指向 dist 的父目录，运行时拼 `cdn + /dist/js/...`，
    // 故拷贝到 /vditor/dist 后 cdn 设为 '/vditor'。
    // 注：本插件会把 src 相对 root 的完整目录原样拼进 dest，
    // 因此用 rename 以 `../` 抵消 `node_modules/vditor/dist` 前缀（3 层 + 文件自身目录深度）。
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/vditor/dist",
          dest: "vditor/dist",
          rename: (_name, _ext, fullPath) => {
            const rel = String(fullPath)
              .replace(/^.*[\\/]node_modules[\\/]vditor[\\/]dist[\\/]/, "")
              .replace(/\\/g, "/");
            const depth = rel.includes("/") ? rel.split("/").length - 1 : 0;
            return "../".repeat(depth + 3) + rel;
          },
        },
      ],
    }),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
