# GeoFS F-18 Addon Build System

This project includes a build system that combines all required files into standalone Tampermonkey scripts.

## Setup

Install dependencies:
```bash
npm install
```

## Building

Build all entrypoints:
```bash
npm run build
```

Watch for changes and rebuild automatically:
```bash
npm run build:watch
```

## Output

For each `.user.js` file in `Scripts/addon/entrypoints/`, the build creates:

- `build/{name}.user.full.js` - All required files combined into one standalone script
- `build/{name}.user.min.js` - Minified version for production use

## How it works

1. Reads the entrypoint `.user.js` file
2. Extracts all `@require` URLs from the userscript header
3. Converts GitHub URLs to local file paths
4. Reads and combines all required files in order
5. Creates a full version with all code combined
6. Creates a minified version using Terser

The resulting scripts are standalone and don't need external `@require` dependencies.
