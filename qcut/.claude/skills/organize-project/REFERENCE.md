# Organize Project CLI Reference

Reference for native pipeline project-structure commands:

- `init-project`
- `organize-project`
- `structure-info`

Run through:

```bash
bun run pipeline <command> [options]
```

## Commands

### `init-project`

Create the standard directory layout in `--directory` (or current directory).

```bash
bun run pipeline init-project --directory ./my-project
```

Common flags:

- `--directory <path>`: target project directory (default: `.`)
- `--dry-run`: report what would be created without writing
- `--json`: machine-readable output

Created folders:

```text
input/
input/images/
input/videos/
input/audio/
input/text/
input/pipelines/
output/
output/images/
output/videos/
output/audio/
config/
```

### `organize-project`

Move recognized files into category folders by extension.

```bash
bun run pipeline organize-project --directory ./my-project --source ./incoming --recursive
```

Common flags:

- `--directory <path>`: project root where target folders live (default: `.`)
- `--source <path>`: source folder to scan (default: `--directory`)
- `--recursive`: scan nested directories
- `--dry-run`: preview moves only
- `--include-output`: place files under `output/*` instead of `input/*`
- `--json`: machine-readable output

Category mapping:

- `images`: `.png .jpg .jpeg .gif .webp .bmp .svg .tiff`
- `videos`: `.mp4 .mov .avi .mkv .webm .flv .wmv`
- `audio`: `.mp3 .wav .flac .aac .ogg .m4a .wma`
- `text`: `.txt .md .json .yaml .yml .csv`

### `structure-info`

Show folder existence and file counts for the standard structure.

```bash
bun run pipeline structure-info --directory ./my-project
```

Common flags:

- `--directory <path>`: project root to inspect (default: `.`)
- `--json`: machine-readable output

## Suggested Safe Sequence

```bash
# 1) Create missing folders (preview)
bun run pipeline init-project --directory ./my-project --dry-run

# 2) Create missing folders (apply)
bun run pipeline init-project --directory ./my-project

# 3) Preview file moves
bun run pipeline organize-project \
  --directory ./my-project \
  --source ./incoming \
  --recursive \
  --dry-run

# 4) Apply file moves
bun run pipeline organize-project \
  --directory ./my-project \
  --source ./incoming \
  --recursive

# 5) Verify final state
bun run pipeline structure-info --directory ./my-project
```

## JSON Automation Examples

```bash
bun run pipeline organize-project \
  --directory ./my-project \
  --source ./incoming \
  --recursive \
  --dry-run \
  --json
```

```bash
bun run pipeline structure-info --directory ./my-project --json
```

## Errors and Recovery

Common errors:

- `Source directory not found`
- permission denied reading source/target path
- move failed during rename/copy fallback

Recovery steps:

1. Re-run with `--dry-run --json` to inspect planned actions.
2. Confirm source/target paths exist and are writable.
3. Re-run without `--dry-run` once paths and permissions are fixed.
