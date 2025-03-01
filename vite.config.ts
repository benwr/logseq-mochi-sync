import { defineConfig } from "vite";
import logseqDevPlugin from "vite-plugin-logseq";

export default defineConfig({
  base: "./",
  plugins: [logseqDevPlugin()],
  build: {
    sourcemap: true,
    target: "modules",
    minify: "esbuild",
  },
});
