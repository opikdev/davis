# Add a dataset to the Library

The Library lists public datasets that Davis downloads straight from their publishers. Nothing is re-hosted, so each entry in `crates/library/catalog.json` is a recipe: where to download, and how to turn the download into tables.

## Check the dataset first

- The license allows anyone to use it, such as CC BY, CC0, ODbL, an open government licence, or public domain. Skip anything non-commercial or behind a login.
- The download link is direct and stable, from the publisher itself.
- It's real and worth asking about, with at least one date, group, or measure to chart.

## Add the entry

Copy an existing entry in `catalog.json` and change it. Every field is required.

| Field | What it holds |
|---|---|
| `id` | Short and unique, such as `us-flights` |
| `category` | One of `business`, `world`, `climate`, `energy`, `transport`, `nature`, `technology`, `sports` |
| `summary`, `covers` | One plain sentence, and the period it covers |
| `publisher`, `sourceUrl` | Who publishes it, and their page about it |
| `license`, `credit` | The license name and link, and the credit line Davis adds to exported Pages |
| `sizeBytes` | The total download size |
| `isFeatured`, `isLive`, `isAdvanced` | Featured is for small, quick datasets; live is for data that changes, like earthquakes |
| `questions` | Three questions the data answers well |
| `steps` | The recipe, below |

## Steps

Steps run in order in a staging folder inside the project, and each one can only use files an earlier step made.

| Step | Fields | Does |
|---|---|---|
| `download` | `url`, `saveAs` | Downloads one file over HTTPS |
| `unzip` | `archive`, `pattern` | Extracts the files whose names match, flattening any folders |
| `workbook` | `file` | Turns each sheet of an Excel file into `<name>-1.csv`, `<name>-2.csv`, and so on |
| `stack` | `pattern`, `saveAs` | Stacks CSV files with the same columns into one Parquet table |
| `join` | `files`, `on`, `keepFrom`, `saveAs` | Joins CSV files on shared key columns into one Parquet table, from a given year on |
| `keep` | `file`, `name` | Moves a finished file into the project's `data` folder |

Patterns support one `*`, such as `PRSA_Data_*.csv`.

## Test it

```sh
cargo test --workspace catalog
cargo test --workspace every_dataset_imports -- --ignored --nocapture
.github/scripts/check-library-links.sh
```

The second command downloads every dataset, about 350 MB, and prints each table's row count. The weekly `Library links` workflow runs the link check, and it also runs on any pull request that changes the catalog.
