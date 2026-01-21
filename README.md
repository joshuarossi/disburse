# Disburse

Non-custodial stablecoin treasury management for Web3 teams.

## Tech Stack

- **Frontend**: React 19 + Vite + TypeScript
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **Runtime**: Bun
- **Hosting**: Cloudflare Pages

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or higher

### Installation

```bash
bun install
```

### Development

```bash
bun run dev
```

### Build

```bash
bun run build
```

### Preview Production Build

```bash
bun run preview
```

## Deployment

This project is configured for Cloudflare Pages:

- **Build command**: `bun run build`
- **Install command**: `bun install`
- **Output directory**: `dist`

The `public/_redirects` file handles SPA routing.

## Project Structure

```
src/
├── components/
│   ├── ui/           # Reusable UI components
│   └── landing/      # Landing page components
├── pages/            # Page components
├── lib/              # Utilities
└── App.tsx           # Main app with routing
```

## License

MIT
