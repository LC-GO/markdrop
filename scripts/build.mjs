import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import esbuild from "esbuild";

const root = process.cwd();
const distDir = join(root, "dist");
const watch = process.argv.includes("--watch");

const entries = [
  {
    entryPoints: ["src/background/service-worker.ts"],
    outfile: "dist/background/service-worker.js",
  },
  {
    entryPoints: ["src/content/content-script.ts"],
    outfile: "dist/content/content-script.js",
  },
  {
    entryPoints: ["src/options/options.ts"],
    outfile: "dist/options/options.js",
  },
  {
    entryPoints: ["src/popup/popup.ts"],
    outfile: "dist/popup/popup.js",
  },
];

async function copyStatic() {
  await cp(join(root, "public", "manifest.json"), join(distDir, "manifest.json"), { force: true });
  await cp(join(root, "public", "icons"), join(distDir, "icons"), {
    recursive: true,
    force: true,
  });
  await cp(join(root, "src", "options", "options.html"), join(distDir, "options", "options.html"), {
    force: true,
  });
  await cp(join(root, "src", "options", "options.css"), join(distDir, "options", "options.css"), {
    force: true,
  });
  await cp(join(root, "src", "popup", "popup.html"), join(distDir, "popup", "popup.html"), {
    force: true,
  });
  await cp(join(root, "src", "popup", "popup.css"), join(distDir, "popup", "popup.css"), {
    force: true,
  });
}

await rm(distDir, { recursive: true, force: true });
await mkdir(join(distDir, "background"), { recursive: true });
await mkdir(join(distDir, "content"), { recursive: true });
await mkdir(join(distDir, "options"), { recursive: true });
await mkdir(join(distDir, "popup"), { recursive: true });
await mkdir(join(distDir, "icons"), { recursive: true });
await copyStatic();

const common = {
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const contexts = await Promise.all(entries.map((entry) => esbuild.context({ ...common, ...entry })));
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("Markdrop build is watching for changes.");
} else {
  await Promise.all(entries.map((entry) => esbuild.build({ ...common, ...entry })));
  console.log("Built Markdrop extension into dist/.");
}
