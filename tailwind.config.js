/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        severity: {
          critical: "#ef4444",
          high: "#f59e0b",
          medium: "#eab308",
          low: "#10b981",
          idle: "#475569",
        },
      },
      keyframes: {
        twinkle: {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "0.65" },
        },
        spinSlow: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        nodePulse: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.2)" },
        },
      },
      animation: {
        twinkle: "twinkle 4s ease-in-out infinite",
        spinSlow: "spinSlow 60s linear infinite",
        nodePulse: "nodePulse 800ms ease-in-out infinite",
      },
    },
  },
  safelist: ["animate-twinkle", "animate-spinSlow", "animate-nodePulse"],
  plugins: [],
};
