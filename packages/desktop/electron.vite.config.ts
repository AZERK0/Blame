import { defineConfig } from "electron-vite"
import appPlugin from "@blame/app/vite"

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ["electron-context-menu", "electron-window-state"],
      },
      rollupOptions: {
        input: { index: "src/main/index.ts" },
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
