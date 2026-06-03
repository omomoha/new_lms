import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#13403A",      // ink — dominant deep forest green
          primaryDark: "#0C2C28",  // ink2 — darker fill
          accent: "#8FB85C",       // moss — lime accent
          teal: "#2C7A6B",         // teal — secondary
          cream: "#F5F7F4",        // page background
          mint: "#E7F1DE",         // highlight bands / selected states
          ink: "#1E302C",          // body text
          muted: "#5E6E69",        // muted text
          // Legacy keys kept for backward compatibility
          dark: "#0C2C28",
          light: "#E7F1DE",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
