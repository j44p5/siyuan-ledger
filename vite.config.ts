import {defineConfig, type Plugin} from "vite";
import {resolve} from "path";
import {cpSync, mkdirSync, rmSync, existsSync} from "fs";

/**
 * 自定义插件：在 bundle 关闭后把静态资源拷到 dist 根。
 * 替代 vite-plugin-static-copy（它是 ESM-only，与 CJS 配置文件冲突）。
 */
function copyStaticAssets(): Plugin {
  const root = process.cwd();
  const dist = resolve(root, "dist");
  const targets: Array<[string, string]> = [
    ["plugin.json", "."],
    ["static", "."], // static/index.css -> dist/index.css
    ["i18n", "."],
    ["README.md", "."],
  ];
  return {
    name: "copy-static-assets",
    closeBundle() {
      if (!existsSync(dist)) mkdirSync(dist, {recursive: true});
      for (const [src, dest] of targets) {
        const from = resolve(root, src);
        if (!existsSync(from)) continue;
        const to = resolve(dist, dest, src.split("/").pop() as string);
        // static/ 目录要拍平：static/index.css -> dist/index.css
        if (src === "static") {
          cpSync(from, dist, {recursive: true});
          continue;
        }
        cpSync(from, to, {recursive: true});
      }
      // 清理多余：README 拷成 README.md 即可
      void rmSync;
    },
  };
}

export default defineConfig({
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: true,
    minify: "esbuild",
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      fileName: () => "index.js",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: ["siyuan"],
      output: {
        entryFileNames: "index.js",
        assetFileNames: "[name][extname]",
      },
    },
  },
  plugins: [copyStaticAssets()],
});
