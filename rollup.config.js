import terser from "@rollup/plugin-terser";
import { defineConfig, rollup } from "rollup";
import ts from "typescript";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

rmSync(new URL("./dist", import.meta.url), { recursive: true, force: true });
const root = dirname(fileURLToPath(import.meta.url));

const typescript = {
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
};

// React/Next entries are client components in the App Router.
const clientDirective = (chunk) =>
  chunk.isEntry && ["react", "next"].includes(chunk.name) ? "'use client';" : "";

// Rollup drops module-level directives; they are re-added by `banner` above.
const onwarn = (warning, warn) => {
  if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
  warn(warning);
};

// Built-in plugins as separate files for the script-tag build: name -> [module, export].
// Must list every name in src/plugins/loader-types.ts (checked by scripts/check-package.mjs).
const SCRIPT_PLUGINS = {
  googleAnalytics: ["google-analytics", "googleAnalytics"],
  microsoftUet: ["microsoft-uet", "microsoftUet"],
  openAIAds: ["openai-ads", "openAIAds"],
  clearIdeasChat: ["clearideas-chat", "clearIdeasChat"],
  hubspot: ["hubspot", "hubspot"],
  intercom: ["intercom", "intercom"],
  metaPixel: ["meta-pixel", "metaPixel"],
  linkedInInsight: ["linkedin-insight", "linkedInInsight"],
  microsoftClarity: ["microsoft-clarity", "microsoftClarity"],
  hotjar: ["hotjar", "hotjar"],
};

// Build dist/script-plugins/<name>.<hash>.js: each registers its factory on
// window.__ciAnalyticsPlugins. Returns name -> [file name, SRI integrity].
async function buildScriptPlugins() {
  const outDir = resolve(root, "dist/script-plugins");
  mkdirSync(outDir, { recursive: true });
  const files = {};
  for (const [name, [module, exportName]] of Object.entries(SCRIPT_PLUGINS)) {
    const entryId = `\0script-plugin:${name}`;
    const bundle = await rollup({
      input: entryId,
      onwarn,
      plugins: [
        {
          name: "script-plugin-entry",
          resolveId: (id) => (id === entryId ? id : null),
          load: (id) =>
            id === entryId
              ? `import { ${exportName} } from ${JSON.stringify(resolve(root, "src/plugins", `${module}.ts`))};\n` +
                `(window.__ciAnalyticsPlugins = window.__ciAnalyticsPlugins || {})[${JSON.stringify(name)}] = ${exportName};\n`
              : null,
        },
        typescript,
      ],
    });
    const { output } = await bundle.generate({
      format: "iife",
      plugins: [terser({ format: { comments: false } })],
    });
    await bundle.close();
    const code = output[0].code;
    const hash = createHash("sha384").update(code).digest();
    const fileName = `${name}.${hash.toString("hex").slice(0, 10)}.js`;
    writeFileSync(resolve(outDir, fileName), code);
    files[name] = [fileName, `sha384-${hash.toString("base64")}`];
  }
  return files;
}

// Script-tag build: plugins are fetched from the files above (see loaders.script.ts).
const scriptBuildPlugins = (files) => ({
  name: "script-build-plugin-loaders",
  resolveId(source, importer) {
    if (source === "./loaders" && importer?.endsWith(`${"plugins"}/registry.ts`)) {
      return resolve(root, "src/plugins/loaders.script.ts");
    }
    return null;
  },
  transform(code, id) {
    if (!id.endsWith("loaders.script.ts")) return null;
    const placeholder = "typeof __CI_PLUGIN_FILES__ === 'undefined' ? {} : __CI_PLUGIN_FILES__";
    if (!code.includes(placeholder)) this.error("plugin file placeholder not found");
    // Replaced within one line, so the existing source map stays valid (map: null).
    return { code: code.replace(placeholder, JSON.stringify(files)), map: null };
  },
});

export default async () => {
  const pluginFiles = await buildScriptPlugins();
  return defineConfig([
  {
    input: {
      index: "src/index.ts",
      nuxt: "src/nuxt.ts",
      vite: "src/vite.ts",
      browser: "src/browser.ts",
      react: "src/react.ts",
      next: "src/next.ts",
      plugins: "src/plugins/index.ts",
    },
    external: ["nuxt", "nuxt/app", "react", "react/jsx-runtime", "next/navigation"],
    onwarn,
    output: [
      {
        dir: "dist",
        entryFileNames: "[name].cjs",
        chunkFileNames: "chunks/[name]-[hash].cjs",
        format: "cjs",
        exports: "named",
        sourcemap: true,
        banner: clientDirective,
      },
      {
        dir: "dist",
        entryFileNames: "[name].mjs",
        chunkFileNames: "chunks/[name]-[hash].mjs",
        format: "es",
        sourcemap: true,
        banner: clientDirective,
      },
    ],
    plugins: [typescript],
  },
  {
    // Script-tag build: one minified file exposing window.ClearIdeasAnalytics; built-in
    // plugins are separate files (dist/script-plugins), loaded when configured and allowed.
    input: "src/script-entry.ts",
    onwarn,
    output: {
      file: "dist/analytics.js",
      format: "iife",
      sourcemap: true,
      inlineDynamicImports: true,
      plugins: [terser({ format: { comments: false } })],
    },
    plugins: [scriptBuildPlugins(pluginFiles), typescript],
  },
  ]);
};
