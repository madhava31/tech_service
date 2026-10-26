/** @type {import('tailwindcss').Config} */
// Technicon design system (from design/technicon-erp.html).
// Every colour is a CSS variable defined in src/styles.css, with a light and a dark value,
// so the whole app switches theme by toggling the `dark` class on <html>.
// Colours are stored as RGB channels so opacity modifiers (bg-ink/10) keep working.
const t = (name) => `rgb(var(--${name}) / <alpha-value>)`;

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
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      screens: {
        'desktop-xl': '1440px',
        'desktop-lg': '1180px',
        'tablet-lg': '860px',
        'mobile-sm': '390px',
      },
      colors: {
        // Design-system tokens
        canvas: t('bg'),
        surface: t('surface'),
        surface2: t('surface-2'),
        tile: t('tile'),
        fg: t('fg'),
        subtle: t('muted'),
        faint: t('faint'),
        ink: t('ink'),
        onink: t('on-ink'),
        charcoal: t('charcoal'),
        oncharcoal: t('on-charcoal'),
        dock: t('dock'),
        dockfg: t('dock-fg'),
        good: t('good'),
        goodbg: t('good-bg'),
        bad: t('bad'),
        badbg: t('bad-bg'),
        warn: t('warn'),
        warnbg: t('warn-bg'),
        line: 'rgb(var(--line-rgb) / 0.07)',
        line2: 'rgb(var(--line-rgb) / 0.13)',

        // shadcn semantic names, mapped onto the tokens so existing UI components restyle
        border: 'rgb(var(--line-rgb) / 0.13)',
        input: 'rgb(var(--line-rgb) / 0.13)',
        ring: t('fg'),
        background: t('bg'),
        foreground: t('fg'),
        primary: { DEFAULT: t('ink'), foreground: t('on-ink') },
        secondary: { DEFAULT: t('tile'), foreground: t('fg') },
        destructive: { DEFAULT: t('bad'), foreground: t('on-ink') },
        muted: { DEFAULT: t('tile'), foreground: t('muted') },
        accent: { DEFAULT: t('tile'), foreground: t('fg') },
        popover: { DEFAULT: t('surface-2'), foreground: t('fg') },
        card: { DEFAULT: t('surface-2'), foreground: t('fg') },
        sidebar: {
          DEFAULT: t('dock'),
          foreground: t('dock-fg'),
          primary: t('on-ink'),
          "primary-foreground": t('ink'),
          accent: t('charcoal'),
          "accent-foreground": t('on-charcoal'),
          border: 'rgb(var(--line-rgb) / 0.13)',
          ring: t('fg'),
        },
        // Legacy palette names, kept so any remaining tc-* usage follows the theme
        tc: {
          bg: t('bg'),
          sidebar: t('dock'),
          card: t('surface-2'),
          surface: t('surface'),
          sunken: t('tile'),
          border: 'rgb(var(--line-rgb) / 0.13)',
          borderStrong: 'rgb(var(--line-rgb) / 0.2)',
          text: t('fg'),
          secondary: t('muted'),
          muted: t('faint'),
          accent: t('ink'),
          accentMuted: t('charcoal'),
          accentLight: t('muted'),
          success: t('good'),
          warning: t('warn'),
          danger: t('bad'),
          info: t('fg'),
        },
      },
      backgroundImage: {
        aurora: "none",
        navy: "linear-gradient(135deg, rgb(var(--ink)) 0%, rgb(var(--charcoal)) 100%)",
        "navy-deep": "linear-gradient(135deg, rgb(var(--ink)) 0%, rgb(var(--charcoal)) 100%)",
      },
      borderRadius: {
        xl: "18px",
        "2xl": "22px",
        lg: "16px",
        md: "10px",
        sm: "8px",
        card: "22px",
        ctl: "12px",
      },
      boxShadow: {
        card: "var(--shadow)",
        lift: "var(--shadow), 0 0 0 1px rgb(var(--line-rgb) / 0.07), 0 30px 60px -24px rgba(0,0,0,.35)",
        rail: "0 18px 40px -18px rgba(0,0,0,.55)",
        navy: "0 10px 22px -12px rgba(0,0,0,.45)",
        hero: "0 18px 36px -22px rgba(0,0,0,.6)",
      },
      transitionTimingFunction: {
        ease: "cubic-bezier(.65,0,.35,1)",
        spring: "cubic-bezier(.2,.9,.25,1.04)",
        out: "cubic-bezier(.16,1,.3,1)",
      },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(16px) scale(.985)", filter: "blur(5px)" }, to: { opacity: "1", transform: "none", filter: "none" } },
        fadeUp: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        titleIn: { from: { opacity: "0", filter: "blur(10px)", transform: "translateY(6px)" }, to: { opacity: "1", filter: "blur(0)", transform: "none" } },
        panelIn: { from: { opacity: "0", transform: "translateY(-6px) scale(.96)" }, to: { opacity: "1", transform: "none" } },
        growY: { from: { transform: "scaleY(0)" }, to: { transform: "scaleY(1)" } },
      },
      animation: {
        rise: "rise .7s cubic-bezier(.16,1,.3,1) both",
        "fade-up": "fadeUp .45s cubic-bezier(.16,1,.3,1) both",
        "title-in": "titleIn .7s cubic-bezier(.16,1,.3,1) both",
        "panel-in": "panelIn .35s cubic-bezier(.2,.9,.25,1.04) both",
      },
    },
  },
  plugins: [],
}
