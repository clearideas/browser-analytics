import { defineConfig } from "rollup";
import ts from "typescript";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

rmSync(new URL("./dist", import.meta.url), { recursive: true, force: true });

export default defineConfig({
  input: {
    index: "src/index.ts",
    nuxt: "src/nuxt.ts",
    vite: "src/vite.ts",
  },
  external: ["vue", "vue-router", "nuxt", "nuxt/app", "web-vitals"],
  output: [
    {
      dir: "dist",
      entryFileNames: "[name].cjs",
      chunkFileNames: "chunks/[name]-[hash].cjs",
      format: "cjs",
      sourcemap: true,
    },
    {
      dir: "dist",
      entryFileNames: "[name].mjs",
      chunkFileNames: "chunks/[name]-[hash].mjs",
      format: "es",
      sourcemap: true,
    },
  ],
  plugins: [
    {
      name: "typescript-transpile",
      resolveId(source, importer) {
        if (!importer || !source.startsWith(".")) return null;
        const path = resolve(dirname(importer), source + ".ts");
        return existsSync(path) ? path : null;
      },
      transform(code, id) {
        if (!id.endsWith(".ts")) return null;
        const result = ts.transpileModule(code, {
          fileName: id,
          compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.ESNext,
            sourceMap: true,
            inlineSources: true,
          },
        });
        return { code: result.outputText, map: result.sourceMapText };
      },
    },
  ],
});
