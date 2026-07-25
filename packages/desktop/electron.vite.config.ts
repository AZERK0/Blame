import { defineConfig } from "electron-vite"
import appPlugin from "@blame/app/vite"

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ["electron-context-menu", "electron-window-state"],
      },
      rollupOptions: {
        input: {
          "agent-runtime-process": "src/main/agent-runtime-process.ts",
          index: "src/main/bootstrap.ts",
        },
        output: {
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          entryFileNames: "[name].js",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    base: "./",
    plugins: [appPlugin],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: {
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
