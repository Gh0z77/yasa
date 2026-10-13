# Yasa app

This project was created with Yasa — an AI app builder. It is a regular
Vite + React + TypeScript + Tailwind CSS project, so you can keep working on it locally.

## Run locally

You need [Node.js](https://nodejs.org) 22.12 or newer (20.19+ also works).

```bash
npm install
npm run dev
```

Then open the URL printed in the terminal (usually http://localhost:5173).

## Scripts

| Command             | What it does                             |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Start the dev server with hot reload     |
| `npm run build`     | Build the production bundle into `dist/` |
| `npm run preview`   | Serve the production build locally       |
| `npm run typecheck` | Type-check the project with TypeScript   |

## Project structure

```
index.html              HTML entry (title, meta tags, fonts)
src/main.tsx            App bootstrap
src/App.tsx             Root component
src/index.css           Tailwind CSS v4 + design tokens (colors, radius, fonts, animations)
src/components/ui/      Reusable UI components (button, card, dialog, ...)
src/components/brand-icons.tsx  Social / brand logos as inline SVG
src/hooks/              Reusable hooks (useLocalStorage, useIsMobile)
src/lib/utils.ts        `cn()` class-name helper
```

## Styling

- Tailwind CSS v4 is configured in CSS — there is no `tailwind.config.js`. Design tokens live in
  `src/index.css` (`:root` for light, `.dark` for dark) and are used through utilities such as
  `bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`, `border-border`.
- Add the `dark` class to `<html>` to switch to the dark theme.
- Import from `src` with the `@/` alias, e.g. `import { Button } from "@/components/ui/button"`.

## Deploy

`npm run build` produces a static site in `dist/` that can be hosted anywhere
(Vercel, Netlify, Cloudflare Pages, GitHub Pages, nginx, ...).
