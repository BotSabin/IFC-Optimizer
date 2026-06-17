import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        shell: "#101317",
        panel: "#171b21",
        panel2: "#1f252d",
        line: "#2d3440",
        brand: "#38bdf8",
        ok: "#23c55e",
        warn: "#f59e0b",
        danger: "#ef4444"
      }
    }
  },
  plugins: []
} satisfies Config;

