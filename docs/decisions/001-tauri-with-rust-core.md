# 001. Use Tauri with a separate Rust core

- **Status**: accepted
- **Context**: Davis is an open source, local-only tool for very large datasets. DuckDB does the heavy work and the UI only draws what is on screen, so UI framework speed matters less than chart quality. Charts are core to the product, and a web UI offers mature chart libraries and reaches more contributors.
- **Decision**: Use Tauri 2 with React, shadcn/ui on Base UI, and the `base-mira` style, which is compact enough for dense data screens. Keep data logic in a `davis-core` crate with no UI dependency. Target desktop only.
- **Consequences**:
  - Mature chart and grid libraries are available.
  - The UI runs in the system webview, so rendering differs by OS. Linux's WebKitGTK needs the most testing.
  - Grid and chart speed must be proven with real data.
  - DuckDB compiles from source, so clean builds take minutes.
  - The app identifier `dev.opik.davis` must stay fixed after the first release, because it locates user data.
