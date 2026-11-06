# Add a backend command

This adds `row_count` as an example.

1. Add the logic to `crates/core/src/`, with a test, and export it from `lib.rs`:

   ```rust
   pub fn row_count(path: &str) -> Result<u64> {
       todo!()
   }
   ```

2. Add a thin command in `src-tauri/src/commands/`:

   ```rust
   #[tauri::command]
   pub async fn row_count(path: String) -> Result<u64, AppError> {
       Ok(spawn_blocking(move || davis_core::row_count(&path)).await??)
   }
   ```

3. Register it in the single `generate_handler!` call in `src-tauri/src/lib.rs`. Command names are global, so each must be unique.

4. Add a typed wrapper to the feature's `api.ts`:

   ```ts
   export function getRowCount(path: string) {
     return invoke<number>("row_count", { path })
   }
   ```

5. Run `pnpm check`.

Commands take camelCase arguments from JavaScript. For large results, return `tauri::ipc::Response` with raw bytes or stream through `tauri::ipc::Channel`, because JSON is slow at that size.
