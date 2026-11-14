# Technicon ERP frontend: design analysis and master prompt

Analysed from the code on branch `feat/quotation-line-key-features`, commit `691538f`. Values below come from `app/client/tailwind.config.js`, `src/styles.css`, `src/styles/shell.css`, `src/styles/ds.css` and the React components.

**Not checked in a browser.** Running logged-in pages needs the API and a database, so this describes what the code specifies, not screenshots. Contrast figures are calculated from the colour values.

**Where to go:** the analysis is in sections 1 to 14, the problems found are in section 15, and the copy-paste prompt is in [section 16](#16-master-prompt).

## Quick summary

The app is a calm, card-based business dashboard: soft grey page, white rounded cards, pill-shaped controls and dashed hairlines inside cards. Navy (blue in dark mode) marks primary actions and the active page. Orange is kept for the single main call to action and chart highlights. Motion is deliberately noticeable: content rises and un-blurs on arrival, and controls move with a slight spring.

The newer `ts-` design system is strong and widely used. The main weaknesses are leftover CSS from an older design, no shared toast or dialog component, and loading and empty states that don't match the design system.

## 1. Stack and files

| Area | What is used |
|---|---|
| Framework | React 18, TypeScript, Vite 5, React Router 6 |
| Styling | Tailwind CSS 3 for tokens and utilities, plus hand-written `ts-` classes |
| Primitives | shadcn/ui style components on Radix UI (`src/components/ui/`) |
| Icons | `lucide-react` in 29 files, plus `src/components/icons.tsx` |
| Charts | Mostly custom SVG and CSS (`src/components/ds/`); Recharts appears in 2 files |
| Font | Outfit from Google Fonts, weights 300 to 800 |

| File | Role | Status |
|---|---|---|
| `src/styles.css` | Theme tokens, base rules, older component classes | Tokens are current; the lower part is mostly legacy |
| `src/styles/shell.css` | Header, navigation, menus, dock, page entrance | Current |
| `src/styles/ds.css` | Cards, tables, fields, charts, forms, kanban (`ts-` classes) | Current; **use this first** |
| `tailwind.config.js` | Maps CSS variables to Tailwind names | Current |
| `design/technicon-erp.html` | Original visual reference | Visual reference only |
| `CLAUDE.md` | Redesign rules | Must be followed |

## 2. Design identity

- **Personality:** a calm, premium operations tool. It's dense enough for daily work, without looking like a spreadsheet.
- **Signature details:**
  - Large, light page titles
  - White 22px cards on a pale background
  - Pill buttons, tabs, search boxes and navigation
  - Dashed hairlines between rows inside cards
  - Hatched chart bars with one solid highlighted bar
  - A floating dark dock
  - Blur-to-sharp entrance animations
- **Colour restraint:** neutral surfaces carry the screen. Brand colour marks only what's active, clickable or most important.
- **Hierarchy:** size and medium weight (500), not heavy bold text.

## 3. Colours

All colours are CSS variables holding RGB channels, so Tailwind opacity works (`bg-ink/10`). The theme switches with the `dark` class on `<html>`. Hex values below are converted from those channels.

**Surfaces**

| Token | Tailwind name | Light | Dark | Used for |
|---|---|---|---|---|
| `--bg` | `canvas` | `#F7F8FA` | `#0D0D0D` | Page background |
| `--surface` | `surface` | `#F9FAFB` | `#161616` | Soft panels, inputs |
| `--surface-2` | `surface2` | `#FFFFFF` | `#1B1B1B` | White cards, menus, modals |
| `--tile` | `tile` | `#EEF0F3` | `#222221` | Tracks, tabs, chips |

**Text**

| Token | Tailwind name | Light | Dark | Used for |
|---|---|---|---|---|
| `--fg` | `fg` | `#171717` | `#F1F1EF` | Main text |
| `--muted` | `subtle` | `#6B7280` | `#9B9B97` | Secondary text |
| `--faint` | `faint` | `#9CA3AF` | `#62625F` | Hints, axis labels, placeholders |

**Dark elements**

| Token | Tailwind name | Light | Dark | Used for |
|---|---|---|---|---|
| `--ink` | `ink` | `#121211` | `#F1F1EF` | Tooltips, inverted items |
| `--on-ink` | `onink` | `#F6F6F4` | `#121211` | Text on ink |
| `--charcoal` | `charcoal` | `#3A3A37` | `#242423` | Dark card variant |
| `--on-charcoal` | `oncharcoal` | `#F3F3F1` | `#F1F1EF` | Text on charcoal |
| `--dock` | `dock` | `#111110` | `#191918` | Floating dock |
| `--dock-fg` | `dockfg` | `#C9C9C5` | `#BDBDB9` | Dock icons |

**Brand**

| Token | Tailwind name | Light | Dark | Used for |
|---|---|---|---|---|
| `--brand-navy` | `brandnavy` | `#0744B4` | `#0744B4` | Primary brand colour |
| `--brand-blue` | `brandblue` | `#31AAF6` | `#31AAF6` | Bright brand colour |
| `--brand-orange` | `brandorange` | `#F36F1E` | `#F36F1E` | Highlight colour |

**Roles**

| Token | Tailwind name | Light | Dark | Used for |
|---|---|---|---|---|
| `--accent` | `accent2` | `#0744B4` | `#31AAF6` | Primary action, active, focus |
| `--on-accent` | `onaccent` | `#FFFFFF` | `#121211` | Text on accent |
| `--cta` | `cta` | `#F36F1E` | `#F36F1E` | Main call to action |
| `--on-cta` | `oncta` | `#171717` | `#171717` | Text on CTA |
| `--chart-line` | CSS variable only | `#0744B4` | `#31AAF6` | Chart strokes |
| `--chart-fill` | CSS variable only | `#31AAF6` | `#31AAF6` | Bars and areas |
| `--chart-hi` | CSS variable only | `#F36F1E` | `#F36F1E` | Highlighted value |

**Status**

| Token | Tailwind name | Light | Dark | Used for |
|---|---|---|---|---|
| `--good` | `good` | `#23784F` | `#5FC794` | Success text |
| `--good-bg` | `goodbg` | `#D8EBDE` | `#202F28` | Success background |
| `--warn` | `warn` | `#865A00` | `#E8BC55` | Warning text |
| `--warn-bg` | `warnbg` | `#F4E6BD` | `#362F1F` | Warning background |
| `--bad` | `bad` | `#A8382F` | `#EF8B80` | Error text |
| `--bad-bg` | `badbg` | `#F3DCD8` | `#342625` | Error background |

**Lines:** `--line-rgb` is `#111827` in light mode and `#FFFFFF` in dark mode, used at low opacity. `line` is 7% for soft dividers and `line2` is 13% for standard borders.

**How colour is used:**

| Colour role | Used for | Avoid |
|---|---|---|
| `accent` (navy, or blue in dark mode) | Primary buttons (`ts-dark`), active navigation, focus rings, selected tabs | Decoration |
| `cta` (orange with dark text) | The single "New quotation" button | Other buttons; white text on orange (the code comment measures this at only 3.0:1) |
| `brand-blue` | Live dots, card header icons, chart fill | Body text in light mode |
| `chart-line`, `chart-fill`, `chart-hi` | Series strokes, bars, the highlighted value | Hardcoded chart colours |
| `good`, `warn`, `bad` with their `-bg` pairs | Status only | Decoration |
| `dock`, `dock-fg` | The floating dock | General surfaces |

Pipeline stage colours are: draft in bright blue, sent in the chart line colour, accepted in orange, rejected in `bad`.

## 4. Typography

Outfit throughout, with `font-variant-numeric: tabular-nums` on the body so figures align.

| Role | Size | Weight | Notes |
|---|---|---|---|
| Body | 14px, line height 1.45 | 400 | Set on `body` |
| Login headline | 40px | 500 | Letter spacing -.025em |
| Page title (`ts-title`, `ts-phead h1`) | 36px, 30px at 760px and below | 500 | Letter spacing -.025em, line height 1.1 |
| Small page title (`ts-title-sm`) | 28px, 24px at 760px and below | 500 | |
| Gauge value / large value | 38px / 34px | 500 | Letter spacing -.02em |
| Grand total (`ts-grand b`) | 28px | 500 | |
| KPI value (`ts-val`) | 27px, 22px in `ts-kpi-sm` | 500 | Letter spacing -.02em |
| Card header (`ts-ch`) | 13.5px in muted, 15px for `b` | 400 / 500 | |
| Table cell / header | 13.5px / 12.5px | 400 | Headers are muted and not uppercase |
| Field label (`ts-lbl`) | 11.5px | 500 | Uppercase, spacing .07em, muted |
| Button | 14px, 12.5px for `ts-xs` | 400 | |
| Hint, sub-text | 12px | 400 | `faint` or `muted` |

Rule of thumb: the `ts-` system stays at weight 500 or below. The exceptions are the brand name and two tiny labels (`ts-hv`, `ts-ty`). Older `styles.css` classes use 700 and 800, which is one way to spot legacy styling.

## 5. Spacing, shape and depth

| Spacing | Value |
|---|---|
| Page content width | Up to 1400px (`ts-shell`) |
| Page side padding (`ts-page-pad`) | 24px, 16px at 860px and below |
| Grid gap between cards (`ts-grid`) | 16px |
| Card padding | 20px; table cards 16px 18px; small KPI cards 16px 18px |
| Page header margin (`ts-phead`) | 30px above, 22px below |
| Toolbar | 12px gap, 18px below |
| Form grid (`ts-fgrid`) | 14px rows, 16px columns |

| Shape | Radius |
|---|---|
| Card, modal | 22px |
| Kanban column | 20px |
| Menu, quotation line | 18px |
| Kanban card | 15px |
| Tooltip, inner box | 14px |
| Input, menu item | 12px |
| Status chip | 7px |
| Button, nav, tabs, search | 999px |
| Icon button, avatar | Circle |

**Depth:**

| Name | Where | Effect |
|---|---|---|
| `--shadow` | Cards, nav, icon buttons | Soft shadow with a 1px inner highlight |
| Floating | Menus, modals | `--shadow`, a 7% line ring, and `0 30px 60px -24px rgba(0,0,0,.35)` |
| Dock | The dock | `0 18px 40px -18px rgba(0,0,0,.55)` plus a line ring |
| CTA | Orange button | `0 10px 22px -12px` in orange at 55% |

**Lines:** solid lines mark structure, such as table headers. Dashed lines separate repeated content, such as table rows, list rows and card footers.

## 6. App shell and navigation

- **Shell:** `AppShell` wraps every signed-in page. It's keyed by path, so each page replays the entrance animation.
- **Header:** three columns: logo, centred pill navigation, actions. Below 1240px the navigation drops to its own row and scrolls sideways.
- **Navigation:** Dashboard as a link, then dropdown groups: Sales (8 links), Inventory (6), Analytics (8), Pipeline (5) and System (3). Menu items show a title and a one-line description. The structure lives in `src/components/layout/nav.ts`.
- **Active indicator:** an accent pill slides between items in 420ms. The leading edge moves first and the trailing edge follows 110ms later, which creates a stretch.
- **Actions:** orange "New quotation" (press `N`), notifications bell, account avatar.
- **Dock:** a dark floating pill, fixed to the left edge and vertically centred on desktop, and at the bottom centre at 860px and below. It holds search (`⌘K`), pipeline, settings, Ask TECHNICON and the theme switch. On desktop its labels appear as tooltips.

## 7. Page patterns

**Every page**

```
ts-page-pad
  ts-phead: ts-crumb, ts-title, ts-muted description, ts-grow spacer, actions
  ts-warnbox (only on error)
  content
```

**Dashboard** (`pages/Dashboard.tsx`)

1. `ts-phead`, then `ts-toolbar` with a `Seg` period control and action buttons
2. `ts-grid ts-kpis`: 4 KPI cards with `CountUp` and `Spark`
3. `ts-row2`: `Gauge` card and `RevenueBars` card
4. `ts-row3`, then `ts-row-half`: ranked lists and follow-ups

**List page** (`pages/DeliveryChallans.tsx` is a clean example)

1. Page header with `ts-ghost` and `ts-dark` buttons
2. `section.ts-card.ts-white.ts-tcard.ts-tbl`
3. `ts-tbar`: `ts-search`, `select.ts-fi.ts-sel`, `ts-showing` ("Showing x of y")
4. `ts-tblwrap` with a table, right-aligned figures (`ts-r`), `ts-st` status chips and `ts-racts` actions
5. Skeleton rows while loading, `td.ts-empty` when empty, then `Pagination`

**Detail page** (`pages/QuotationDetail.tsx`): `ts-back`, title, `ts-steps` stepper, `ts-dw-meta` facts grid, line items, totals, linked documents and action buttons.

**Form page** (`pages/QuotationNew.tsx`): `ts-qgrid` with the form on the left and a sticky 340px summary on the right. Fields use `ts-lbl` and `ts-fi` in a `ts-fgrid` with `ts-g2`, `ts-g3` or `ts-g4`. Repeating lines use `ts-qline`.

**Kanban** (`pages/sales/SalesPipeline.tsx`): `ts-kboard` columns of at least 280px, using `ts-kcol` and `ts-kcard`. Cards lift 2px on hover.

**Login** (`pages/Login.tsx`): two panels at 860px and above. The left is a white card with the logo, a 40px headline and a drawn trend curve. The right is a centred form.

**Modal:** a `fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]` overlay with `ts-modal` inside, usually `max-w-md w-full`.

## 8. Components

| Need | Use | Notes |
|---|---|---|
| Card | `ts-card ts-white` | Set `--i` for the entrance stagger. `ts-card` alone is the slightly darker `surface` |
| Primary button | `ts-btn ts-dark` | Accent colour, despite the name |
| Secondary button | `ts-btn ts-ghost` | |
| Small button | Add `ts-xs` | |
| Destructive | `ts-btn ts-danger`, `ts-danger-t`, `ts-iconx` | Solid, text-only and icon-only |
| Main CTA | `ts-newq` | One only, in the header |
| Text input | `ts-fi` | Add `ts-r` for figures |
| Label | `ts-lbl` | Or `ts-fld` with `ts-ferr` for validation |
| Toolbar select | `select.ts-fi.ts-sel` | Pill, `tile` background |
| Searchable select | `SearchableSelect` | |
| Search box | `ts-search` | |
| Segmented control | `Seg` from `components/ds` | Sliding thumb |
| Scrolling tabs | `ts-tabs`, `ts-tab`, `ts-on` | |
| Status chip | `ts-st` with a state class | For example `ts-won`, `ts-pending`, `ts-overdue`, or `ts-tone-good`, `ts-tone-warn`, `ts-tone-bad` |
| Trend pill | `ts-pill ts-up` or `ts-down` | |
| Table | `ts-tbl`, `ts-tblwrap` | Set `--r` for row stagger. Tables have a 720px minimum width |
| Ranked list | `ts-list`, `ts-li` | Rank, name, amount, optional `ts-meter` |
| Alerts | `ts-warnbox`, `ts-okbox` | Inline |
| Dropdown menu | Radix `DropdownMenu` with `ts-menu`, `ts-mi` | |
| Skeleton | `ts-skel` | Pulses for loading |

## 9. Charts

| Component | Look |
|---|---|
| `RevenueBars` | Hatched pill bars. The active bar turns solid `chart-hi` with a dark tooltip and a dashed average line |
| `Gauge` | 220° arc with 41 ticks that light up, a blue-to-orange gradient and a knob. Grey when empty, so it doesn't imply performance |
| `Spark` | Thin line drawn left to right with a clip reveal |
| `CountUp` | Numbers animate from the previous value |
| `ts-hbar` | Hatched horizontal track with a solid fill, coloured by pipeline stage |
| `ts-meter` | 4px progress line in list rows |

Chart rules: use dashed grid lines at 13% line opacity, 11 to 11.5px `faint` axis labels, and only the chart tokens. Empty charts show a plain message rather than fake data.

## 10. Animation

**Easing curves**

| Name | Value | Feels like |
|---|---|---|
| `--out` | `cubic-bezier(.16,1,.3,1)` | Fast start, soft landing. Used for entrances |
| `--spring` | `cubic-bezier(.2,.9,.25,1.04)` | Slight overshoot. Used for controls |
| `--ease` | `cubic-bezier(.65,0,.35,1)` | Even and deliberate. Used for navigation and theme |

**Entrances**

| Element | Effect | Duration, easing |
|---|---|---|
| Page (`tsPageIn`) | Fade, 6px blur, 6px rise, scale .995 | .5s `--out` |
| Page title (`titleIn`) | Fade, 10px blur, 6px rise | .7s `--out` |
| Card (`rise`) | Fade, 5px blur, 16px rise, scale .985, staggered 55ms by `--i` | .7s `--out` |
| Table row (`fadeUp`) | Fade, 6px rise, staggered 30ms by `--r` | .5s `--out` |
| Kanban column (`rise`) | As card, staggered 60ms plus 120ms | .7s `--out` |
| Menu, modal (`panelIn`) | Fade, 6px drop, scale .96 | .35s `--spring` |

**Interactions**

| Element | Effect | Duration, easing |
|---|---|---|
| Button, icon button | Hover rises 1px; press scales to .97 on `ts-btn` and `ts-newq` | .2s `--spring` |
| CTA plus icon | Rotates 90° on hover | .45s `--spring` |
| Navigation pill | Slides with a 110ms stretch | .42s `--ease` |
| Segmented thumb | Slides | .4s `--spring` |
| Dock button | Press scales to .92; tooltip slides in | .25s `--spring` |
| Kanban card | Rises 2px with a stronger shadow | .25s `--spring` |
| New quotation line (`pop`) | Scales from .9 past 1.03 to 1 | .5s `--spring` |
| Removed quotation line | Fades and scales to .96 | .22s `--ease` |
| New table row (`freshRow`) | Green flash that fades | 2.6s `--out` |

**Data and theme**

| Element | Effect | Duration |
|---|---|---|
| `CountUp` | Number counts up, ease-out quart | 1.3s |
| `Gauge` | Arc sweeps, ease-out cubic | 1.7s |
| `RevenueBars` | Heights grow, staggered 45ms after a 300ms delay | .95s `--spring` |
| `Spark` | Clip reveal | 1.2s |
| Meter, horizontal bar | Width grows | 1.2s `--out` |
| Stepper fill | Width grows after .15s | 1s `--out` |
| Login curve (`tsDraw`) | Line draws after .3s | 1.6s `--out` |
| Skeleton (`tsSkel`) | Opacity pulse | 1.4s, repeating |
| Theme switch | New theme grows as a circle from the button (View Transitions API) | 750ms `--ease` |

**Rules:**
- Reduced motion is respected in CSS and in JavaScript through `reducedMotion()`.
- Page entrance uses `backwards`, not `both`. A held transform or filter would trap fixed modals under the header. Keep it that way.

## 11. Loading, empty, error and success states

| State | Current pattern |
|---|---|
| Page loading | `PageSkeleton` while a route's code loads |
| Data loading | `ts-skel` blocks and rows, shaped like the content |
| Empty table | `td.ts-empty`, centred and muted |
| Empty chart | `ts-dempty` or `ts-lcempty` message |
| Error | `ts-warnbox` at the top of the page |
| Success | `ts-okbox`, or the `freshRow` flash |
| Confirmation | Browser `confirm()` in most places (see section 15) |

## 12. Responsive behaviour

| Width | What changes |
|---|---|
| 1480px and below | CTA keyboard hint hides |
| 1240px and below | Navigation moves to its own row and scrolls sideways |
| 1100px and below | KPIs become 2 columns; `ts-row2` and `ts-row3` stack; the quotation summary stops being sticky and stacks |
| 860px and below | Dock moves to the bottom; CTA becomes an icon circle; page padding drops to 16px; shell gains 110px bottom padding |
| 760px and below | Page titles shrink; form grids go to 1 column |
| 520px and below | KPIs and `ts-row3` go to 1 column |

Tables don't turn into cards on phones. They scroll sideways inside `ts-tblwrap`.

Custom Tailwind breakpoints exist (`mobile-sm` 390px, `tablet-lg` 860px, `desktop-lg` 1180px, `desktop-xl` 1440px). Pages mostly use the standard `sm`, `md` and `lg`.

## 13. Theme and accessibility

**Theme:** `src/lib/theme.ts` and an inline script in `index.html` apply the saved or system theme before first paint, so there's no flash. It's stored in `localStorage` as `tech-theme`, and follows the system until someone chooses.

**Already good:**
- Global `:focus-visible` outline in the accent colour
- Input focus ring
- Reduced motion support
- `aria-label` on the dock, and `aria-current` on navigation
- Tabular figures
- Contrast notes for accent and CTA in the CSS

**Contrast, calculated from the tokens:**

| Pair | Light | Dark |
|---|---:|---:|
| Main text on card | 17.9:1 (Passes) | 15.2:1 (Passes) |
| Muted text on card | 4.8:1 (Passes) | 6.2:1 (Passes) |
| Faint text on card | 2.5:1 (Fails) | 2.8:1 (Fails) |
| Faint text on page | 2.4:1 (Fails) | 3.2:1 (Large text only) |
| Accent button text | 8.4:1 (Passes) | 7.3:1 (Passes) |
| CTA text | 6.1:1 (Passes) | 6.1:1 (Passes) |
| Good on its background | 4.4:1 (Large text only) | 6.7:1 (Passes) |
| Warn on its background | 4.9:1 (Passes) | 7.4:1 (Passes) |
| Bad on its background | 4.9:1 (Passes) | 6.0:1 (Passes) |

The verdicts use the WCAG AA thresholds: 4.5:1 for normal text and 3:1 for large text. `faint` is used for hints, placeholders and axis labels, so it is the pair to watch.

## 14. Content conventions

- **Money:** `₹` with Indian grouping (`inr`), or lakh and crore short forms (`lakh`, `lakhShort`) such as `₹12.5L` and `₹1.20 Cr`.
- **Dates:** `fmtDay` gives "Oct 21, 2026", or "Oct 21" in short form.
- **Text:** sentence case for labels and headers ("Quotation no.", "Grand total").
- **Tone:** plain and specific, such as "No revenue in this period yet".
- **Menu items:** a title with a short description.

## 15. Problems found

| # | Problem | Evidence | Suggested fix |
|---:|---|---|---|
| 1 | **The design system's description is out of date.** It says "monochrome warm grey with one dark hero card per row" | `styles.css:7`. `ts-charcoal` and `ts-inv` have no use in pages or components; light surfaces are cool grey | Decide if dark hero cards should return, then update the comment |
| 2 | **Leftover CSS from an older design** | `styles.css` has 28 lines using undefined variables (`--hairline`, `--shadow-card`, `--shadow-lift`) or old colours. These undefined values remove the intended border or shadow | Remove unused classes, and move remaining uses to `ts-` |
| 3 | **Colours outside the palette** | Old blue `rgba(59,111,212)`, red `rgba(229,72,77)`, `#E1E8F6`, `#5C6584` in `styles.css`; `#e0483d`, `#5a5a57` in `shell.css`; `#69d39f` in `ds.css` | Replace with tokens |
| 4 | **"Active" status colour conflict** | `.ts-st.ts-active` is green at `ds.css:233`, then amber at `ds.css:407`. The later rule wins | Choose one |
| 5 | **Conflicting and duplicate rules** | `.ts-kfoot` is defined twice with different layouts (`ds.css:57`, `:448`); `.ts-btn:disabled` and `.ts-btn.ts-danger` are repeated | Merge them |
| 6 | **Page skeleton doesn't use tokens** | `PageSkeleton.tsx` uses `slate` and `indigo` colours and `rounded-xl` | Rebuild with `ts-skel` and tokens |
| 7 | **State views look different** | `state-views.tsx` uses emoji icons (⚠️ 🔄 🔍), and its default text assumes sales data | Restyle with Lucide icons, and require specific text |
| 8 | **No toast or confirm dialog component** | 25 `confirm()` and 17 `alert()` calls | Add shared `ConfirmDialog` and toast components |
| 9 | **Modals aren't a shared component** | 5 overlay variants; only 3 files use `role="dialog"` or `aria-modal` | Add one `Modal` with focus handling |
| 10 | **Text on the fringe of readability** | `faint` contrast above; 66 uses of `text-[10px]` | Use `muted` where text must be read; set a minimum size |
| 11 | **Many one-off values** | 157 `text-[13px]`, 144 `text-[12.5px]`, 114 inline `style={{}}` in pages | Add named text styles for common cases |
| 12 | **Unused or undefined code** | `app-sidebar`, `ui/sidebar` and `ui/select` have no importers; `.num` appears in about 40 files with no CSS rule | Remove the code, or define the class |
| 13 | **Several chart approaches** | Custom SVG in `ds/`, older chart components and Recharts | Standardise on `ds/` |
| 14 | **Tables are hard to use on phones** | 720px minimum with sideways scrolling | Add a card layout for key lists |
| 15 | **Wording and date format** | "Performa invoices" in `nav.ts`; US-style dates in `fmtDay`, while the business uses ₹ and Indian formats | Confirm "Proforma" and the preferred date format |
| 16 | **Stale comment** | `TopNav.tsx` describes a white `mix-blend-mode` pill; the CSS uses an accent pill | Update the comment |

## 16. Master prompt

Copy everything inside the block below. Replace the task at the bottom. It works inside this repository, and it holds enough values to recreate the look elsewhere.

````text
You are a senior product designer and frontend engineer working on the Technicon Services ERP.
Build the task at the end so it looks and behaves as if the original team made it. Match the existing design exactly. Don't reinterpret or "improve" it.

## PROJECT
- React 18, TypeScript, Vite, React Router 6, Tailwind CSS 3, Radix UI, lucide-react.
- Frontend: app/client/src. Styles: src/styles.css (tokens), src/styles/shell.css, src/styles/ds.css.
- Read CLAUDE.md, and read a similar existing page before writing anything.

## HARD RULES
1. Do not change the backend, database schema, environment variables or auth.
2. Keep every existing call in src/api.ts as it is. Use real data only. Never invent numbers or sample records.
3. Reuse ts- classes and components from src/components/ds and src/components/ui first. Add new CSS only if nothing fits, and add it to ds.css with the ts- prefix.
4. Use colour tokens only. Never use hardcoded hex or Tailwind palette colours such as slate, gray or indigo.
5. Every screen must work in light and dark mode, and from phone width upward.
6. Work on one page at a time. After each page, run: npm --prefix app/client run build, and fix every error.

## LOOK AND FEEL
A calm, premium operations tool. Soft page background, white rounded cards, pill-shaped controls, dashed hairlines inside cards, large light titles. Neutral surfaces carry the screen. Brand colour marks only what is active, clickable or most important. Hierarchy comes from size and medium weight, not heavy bold.

## COLOUR TOKENS (light / dark)
--bg: #F7F8FA / #0D0D0D
--surface: #F9FAFB / #161616
--surface-2: #FFFFFF / #1B1B1B
--tile: #EEF0F3 / #222221
--fg: #171717 / #F1F1EF
--muted: #6B7280 / #9B9B97
--faint: #9CA3AF / #62625F
--ink: #121211 / #F1F1EF
--on-ink: #F6F6F4 / #121211
--charcoal: #3A3A37 / #242423
--on-charcoal: #F3F3F1 / #F1F1EF
--dock: #111110 / #191918
--dock-fg: #C9C9C5 / #BDBDB9
--brand-navy: #0744B4 / #0744B4
--brand-blue: #31AAF6 / #31AAF6
--brand-orange: #F36F1E / #F36F1E
--accent: #0744B4 / #31AAF6
--on-accent: #FFFFFF / #121211
--cta: #F36F1E / #F36F1E
--on-cta: #171717 / #171717
--chart-line: #0744B4 / #31AAF6
--chart-fill: #31AAF6 / #31AAF6
--chart-hi: #F36F1E / #F36F1E
--good: #23784F / #5FC794
--good-bg: #D8EBDE / #202F28
--warn: #865A00 / #E8BC55
--warn-bg: #F4E6BD / #362F1F
--bad: #A8382F / #EF8B80
--bad-bg: #F3DCD8 / #342625
Lines: rgb(var(--line-rgb) / .07) for soft dividers, / .13 for standard borders.

Colour roles:
- accent: primary buttons, active navigation, focus, selected tabs.
- cta: orange with dark text, only for the single main action. Never put white text on orange.
- good, warn, bad and their -bg pairs: status only.
- chart-line, chart-fill, chart-hi: charts only.
- Tailwind names: bg-canvas, bg-surface, bg-surface2, bg-tile, text-fg, text-subtle, text-faint, border-line, border-line2, bg-goodbg, text-good, and so on.

## TYPE
Font: Outfit, with tabular figures. Body: 14px, line height 1.45.
- Page title: 36px, weight 500, spacing -.025em, line height 1.1; 30px at 760px and below.
- KPI value: 27px, weight 500, spacing -.02em.
- Card header: 13.5px muted. Table cell: 13.5px. Table header: 12.5px muted, regular weight, not uppercase.
- Field label: 11.5px, weight 500, uppercase, spacing .07em, muted.
- Button: 14px; small button 12.5px. Hint: 12px.
- Do not go above weight 500. Do not use 700 or 800, which belong to the old design. Keep text at 11px or larger.

## SHAPE, SPACE, DEPTH
- Radius: card and modal 22px; menu 18px; tooltip and inner box 14px; input 12px; status chip 7px; buttons, navigation, tabs and search are full pills.
- Spacing: page padding 24px, 16px at 860px and below. Card gap 16px. Card padding 20px. Page content up to 1400px wide.
- Depth: cards use var(--shadow). Menus and modals use var(--shadow), a 7% line ring, and 0 30px 60px -24px rgba(0,0,0,.35).
- Lines: solid for structure, such as table headers. Dashed for repeated content, such as table rows, list rows and card footers.

## COMPONENTS TO USE
- Card: ts-card ts-white, with style={{ ['--i' as string]: n }} for stagger.
- Buttons: ts-btn ts-dark (primary), ts-btn ts-ghost (secondary), ts-xs (small), ts-danger, ts-danger-t, ts-iconx.
- Fields: ts-lbl and ts-fi; ts-r for figures; ts-fgrid with ts-g2, ts-g3 or ts-g4; ts-fld with ts-ferr for validation.
- Toolbar: ts-toolbar, ts-tbar, ts-search, select.ts-fi.ts-sel, ts-showing.
- Tabs: Seg from components/ds, or ts-tabs, ts-tab, ts-on.
- Status: ts-st with a state class, or ts-tone-good, ts-tone-warn, ts-tone-bad. Trend: ts-pill ts-up or ts-down.
- Table: ts-card ts-white ts-tcard ts-tbl containing ts-tblwrap; ts-r for figures; ts-racts for actions; td.ts-empty when empty; Pagination for paging.
- Lists: ts-list and ts-li. Alerts: ts-warnbox, ts-okbox. Skeleton: ts-skel. Menus: Radix DropdownMenu with ts-menu and ts-mi.
- Data display: CountUp, Spark, Gauge, RevenueBars from components/ds. Money and dates: inr, lakh, lakhShort, fmtDay from components/ds/format.
- Icons: lucide-react only, no emoji.

## PAGE RECIPES
Every page:
  ts-page-pad > ts-phead (ts-crumb, ts-title, ts-muted description, ts-grow, actions) > ts-warnbox on error > content.
List: one table card with ts-tbar on top. Show skeleton rows while loading, an empty message when empty, then Pagination.
Dashboard: ts-toolbar, then ts-grid ts-kpis (4 KPI cards), then ts-row2, ts-row3, ts-row-half.
Detail: ts-back, title and status, ts-steps if there is a workflow, ts-dw-meta facts, line items, totals, linked documents.
Form: ts-qgrid with the form on the left and a sticky 340px summary on the right for long documents; a single card for short forms.
Modal: fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px], containing ts-modal max-w-md w-full, with role="dialog" and aria-modal="true".
Kanban: ts-kboard, ts-kcol, ts-kcard.

## MOTION
Easing: --out cubic-bezier(.16,1,.3,1) for entrances; --spring cubic-bezier(.2,.9,.25,1.04) for controls; --ease cubic-bezier(.65,0,.35,1) for navigation.
- Page and card entrances are already built into AppShell and ts-card. Don't add others on top. Set --i on cards (55ms stagger) and --r on table rows (30ms stagger).
- Card: fade, 5px blur, 16px rise, scale .985, .7s --out.
- Menus and modals: panelIn, .35s --spring.
- Buttons: hover rises 1px, press scales to .97, .2s --spring.
- Numbers: CountUp. Charts animate only when data arrives.
- Never use animation fill "both" on a page wrapper: a held transform or filter traps fixed modals under the header.
- Always respect prefers-reduced-motion. For JavaScript animation, use reducedMotion().

## STATES (REQUIRED FOR EVERY SCREEN)
Loading: ts-skel shaped like the content. Empty: a plain, specific message and the next action. Error: ts-warnbox with a clear message. Success: ts-okbox or a freshRow flash. Never show fake data or a blank screen.

## RESPONSIVE
Breakpoints used by the system: 1240, 1100, 860, 760 and 520px. At 860px and below, the dock moves to the bottom, so leave space for it. Tables scroll inside ts-tblwrap. Toolbars and header actions must wrap and never widen the page. Check 390px, 768px, 1280px and 1440px.

## ACCESSIBILITY
Use real buttons and links. Keep the global focus outline. Give icon-only buttons an aria-label. Link every label to its input. Mark status with text as well as colour. Use text-subtle, not text-faint, for anything people must read.

## CONTENT
Sentence case for labels and headers. Plain, specific wording. Money uses ₹ with Indian grouping or lakh and crore short forms. Right-align figures. Show missing values as an em dash.

## DO NOT COPY THESE OLD PATTERNS
- Classes from the old part of styles.css: .btn, .card, .stat, .badge, .field, .modal-overlay, .data-table.
- Variables that don't exist: --hairline, --shadow-card, --shadow-lift.
- The blue rgba(59,111,212) shadows, weights 700 and 800, emoji icons, or slate and indigo skeletons as in PageSkeleton.tsx.
- New alert() or confirm() calls. If a shared dialog or toast exists, use it. If not, build the confirmation with ts-modal and point this out.

## BEFORE YOU FINISH
- [ ] Matches a similar existing page side by side
- [ ] Light and dark mode both correct
- [ ] Loading, empty, error and success states all present
- [ ] Works at 390px with no sideways page scroll
- [ ] No hardcoded colours, and no backend or api.ts changes
- [ ] Build passes: npm --prefix app/client run build
- [ ] Report what changed, what you verified and anything you could not check

## TASK
[Describe the page or change here: its purpose, who uses it, the data and API calls it needs, and the actions it must support.]
````
