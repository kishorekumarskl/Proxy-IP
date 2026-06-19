import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 20px 60px rgba(15, 23, 42, 0.08)"
      },
      backgroundImage: {
        "dashboard-glow":
          "radial-gradient(circle at top left, rgba(59,130,246,0.20), transparent 35%), radial-gradient(circle at top right, rgba(20,184,166,0.16), transparent 35%)"
      }
    }
  },
  plugins: []
};

export default config;
