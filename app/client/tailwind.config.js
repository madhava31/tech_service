/** @type {import('tailwindcss').Config} */
// Aurora light theme. Key names are unchanged from the previous dark theme on purpose —
// every existing `bg-tc-card` / `text-tc-secondary` / `border-tc-border` usage keeps working,
// it just resolves to the light palette now.
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['"Schibsted Grotesk"', 'system-ui', 'sans-serif'],
      },
      screens: {
        'desktop-xl': '1440px',
        'desktop-lg': '1180px',
        'tablet-lg': '860px',
        'mobile-sm': '390px',
      },
      colors: {
        border: "var(--border, #E4E8F2)",
        input: "var(--input, #E4E8F2)",
        ring: "var(--ring, #3B6FD4)",
        background: "var(--background, #F4F6FC)",
        foreground: "var(--foreground, #141B34)",
        tc: {
          bg: "#F4F6FC",
          sidebar: "#FFFFFF",
          card: "#FFFFFF",
          surface: "#F7F8FC",
          sunken: "#EEF1F9",
          border: "#E4E8F2",
          borderStrong: "#D4DAEA",
          text: "#141B34",
          secondary: "#7A839E",
          muted: "#A8AEC4",
          accent: "#3B6FD4",
          accentMuted: "#6B78D6",
          accentLight: "#6D9BE8",
          success: "#2FBF71",
          warning: "#E8A33D",
          danger: "#E5484D",
          info: "#6B78D6",
        },
        primary: {
          DEFAULT: "#3B6FD4",
          foreground: "#F4F6FC",
        },
        secondary: {
          DEFAULT: "#F7F8FC",
          foreground: "#141B34",
        },
        destructive: {
          DEFAULT: "#E5484D",
          foreground: "#FFFFFF",
        },
        muted: {
          DEFAULT: "#F7F8FC",
          foreground: "#7A839E",
        },
        accent: {
          DEFAULT: "#3B6FD4",
          foreground: "#F4F6FC",
        },
        popover: {
          DEFAULT: "#FFFFFF",
          foreground: "#141B34",
        },
        card: {
          DEFAULT: "#FFFFFF",
          foreground: "#141B34",
        },
        sidebar: {
          DEFAULT: "#FFFFFF",
          foreground: "#141B34",
          primary: "#3B6FD4",
          "primary-foreground": "#FFFFFF",
          accent: "#EEF1F9",
          "accent-foreground": "#3B6FD4",
          border: "#E4E8F2",
          ring: "#3B6FD4",
        },
      },
      backgroundImage: {
        // The soft blue-lavender wash behind the whole app, taken from the reference dashboard.
        aurora: "linear-gradient(180deg,#DFE6F8 0%,#EDF1FA 32%,#F4F6FC 68%)",
        navy: "linear-gradient(135deg,#3B6FD4 0%,#2F5CB8 100%)",
        "navy-deep": "linear-gradient(135deg,#4A7DD8 0%,#2F5CB8 100%)",
      },
      borderRadius: {
        // `xl` is deliberately larger than Tailwind's 12px default: the reference design's
        // signature is generously rounded cards, and ~274 existing elements already use
        // rounded-xl, so widening it here restyles them all without touching markup.
        xl: "18px",
        "2xl": "24px",
        lg: "16px",
        md: "10px",
        sm: "8px",
        card: "20px",
        ctl: "12px",
      },
      boxShadow: {
        card: "0 2px 12px rgba(20,27,52,0.06)",
        lift: "0 8px 24px rgba(20,27,52,0.10)",
        rail: "0 4px 20px rgba(20,27,52,0.08)",
        navy: "0 6px 18px rgba(59,111,212,0.28)",
      },
    },
  },
  plugins: [],
}
