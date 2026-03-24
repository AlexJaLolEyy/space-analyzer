# Space Analyzer

A highly modern, 2026-style disk space analyzer for your desktop. Discover where your storage space is going, clean up large files, and compare previous scans, all wrapped up in a sleek, glassmorphism UI with buttery-smooth animations.

## Features

**Core Analysis & Visualization**

- **Turbo MFT Scanner:** Extremely fast scanning engine using NTFS Master File Table direct access to read entire drive compositions in seconds.
- **Multiple Data Views:** Switch seamlessly between:
  - **List View:** Familiar hierarchical layout with precise numbers.
  - **Treemap View:** Classic boxed representation of space usage.
  - **Pie / Donut View:** Beautiful circular breakdowns.
  - **Sunburst View:** Multi-level radial visualization to see an entire drive's nested hierarchy at a glance.
- **Bento Dashboard:** A sleek, modern dashboard inspired by top-tier UI trends to give you an immediate overview of your scan.

**Power Features**

- **Scan History & Snapshots:** Save any scan's state locally, reload it anytime, or compare a past scan against a current one to see exactly what files grew or were added.
- **Smart Cleanup:** Identifies known temporary directories, caches, application logs, and recycle bins, and offers a 1-click way to free up gigabytes of space.
- **Duplicates Finder:** Scan your files by size and hash to find space-wasting duplicate files across the selected directory.
- **Black Holes Panel:** Automatically detects uniquely large and deeply nested folders that might be hiding huge unused assets or old installations.
- **Top 100 Largest Files:** Get straight to the point and find the single largest files eating your space.
- **Export Capabilities:** Export scan data into JSON or CSV for your records or professional reporting.

**Experience & Design**

- 2026-Era Aesthetics (Apple/Google style)
- Heavy use of Glassmorphism (`backdrop-blur`) and deep shadows
- Premium animations powered by `framer-motion`
- Light / Dark Mode adaptive elements
- Accessible, clean typography leveraging the Inter font

## Tech Stack

This project is built on the lightning-fast, modern desktop application stack:

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Framer Motion, Zustand
- **Backend:** Node internals via Tauri (Rust) for minimal footprint and maximum system API access.
- **Graphics/Vis:** `d3-hierarchy` for complex layout calculations like Sunburst/Treemap.

## Development setup

### Prerequisites

- Node.js & Bun package manager
- Rust toolchain (cargo, rustc)
- Tauri prerequisites (MSVC C++ build tools on Windows)

### Running Locally

```bash
# Install dependencies
bun install

# Run the dev server + Tauri desktop app
bun tauri dev
```

### Building for Production

```bash
bun tauri build
```

_(Check Tauri documentation for specific build target configuration options and signing)._
