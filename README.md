[![Test](https://github.com/smart-science/smart-doi/actions/workflows/test.yml/badge.svg)](https://github.com/smart-science/smart-doi/actions/workflows/test.yml)
[![Package](https://github.com/smart-science/smart-doi/actions/workflows/package.yml/badge.svg)](https://github.com/smart-science/smart-doi/actions/workflows/package.yml)
[![Bun](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsmart-science%2Fsmart-doi%2Fmain%2Fpackage.json&query=%24.engines.bun&label=Bun&logo=bun&color=blue)](https://bun.sh)
[![Node.js](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsmart-science%2Fsmart-doi%2Fmain%2Fpackage.json&query=%24.engines.node&label=Node.js&logo=nodedotjs&color=blue)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

# SDOI (smart-doi)

Deterministic DOI normalization (ISO 26324) and derivation of 20-character [SIDs](https://github.com/smart-science/smart-id) (Smart IDs).

---

## Installation

```bash
# bun
bun add @smart-science/sdoi

# npm
npm install @smart-science/sdoi
```

---

## Usage

### 1. Derive an SID: `doiToSid(input)`

The out-of-the-box function uses `@noble/hashes` (synchronous, cross-platform). It extracts and normalizes the DOI, hashes its UTF-8 encoding with SHA-256, and returns a 20-character canonical `SID`:

```ts
import { doiToSid } from '@smart-science/sdoi';

doiToSid('https://doi.org/10.1000/182'); // 'SFG9CPDEVTC05D9SZVWM'
doiToSid('doi:10.1000/ABC');             // 'N3C77HSZ53MZRTE0S9Q7'
doiToSid('not a doi');                   // null
```

Returns `null` if the input contains no valid DOI.

---

### 2. Custom Hash & Zero-Dependency Tree-Shaking

To avoid bundling `@noble/hashes` in browser bundles or Node.js services, use `createDoiToSid` or `createDoiToSidAsync` with your platform's native crypto.

Because `package.json` specifies `"sideEffects": false`, modern bundlers (esbuild, Rollup, Vite, Webpack) **tree-shake `@noble/hashes` away completely** when `doiToSid` is not imported.

#### Node.js / Bun (`node:crypto`, synchronous)

```ts
import { createHash } from 'node:crypto';
import { createDoiToSid } from '@smart-science/sdoi';

const doiToSid = createDoiToSid((text) =>
    createHash('sha256').update(text).digest()
);

doiToSid('https://doi.org/10.1000/ABC'); // 'N3C77HSZ53MZRTE0S9Q7'
```

#### Browsers / Web Crypto (`crypto.subtle`, asynchronous)

```ts
import { createDoiToSidAsync } from '@smart-science/sdoi';

const doiToSid = await createDoiToSidAsync((text) =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
);

await doiToSid('https://doi.org/10.1000/ABC'); // 'N3C77HSZ53MZRTE0S9Q7'
```

Both factories run a one-time self-test on creation to ensure the provided function correctly produces SHA-256 digests.

---

### 3. Normalize a DOI: `normalizeDoi(input, options?)`

Normalizes a DOI string or URL according to ISO 26324 and DOI Handbook specifications:
- Drops leading prose, URLs, and schemes (`doi:`, `https://doi.org/`, `http://dx.doi.org/`).
- Decodes percent-encoding in one pass (`%20` → space, `%2F` → `/`).
- Lowercases Basic Latin `A-Z` (casing of non-ASCII letters is preserved per spec).
- Suffix trailing text is preserved without trimming (no lossy URL or bracket stripping).

```ts
import { normalizeDoi } from '@smart-science/sdoi';

normalizeDoi('https://doi.org/10.1000/182');                // '10.1000/182'
normalizeDoi('DOI: 10.1000/ABC-Ä');                         // '10.1000/abc-Ä'
normalizeDoi('https://example.com/search?doi=10.1000%2FA'); // '10.1000/a'
normalizeDoi('not-a-doi');                                  // null
```

#### Options

```ts
import { normalizeDoi, type NormalizeDoiOptions } from '@smart-science/sdoi';

normalizeDoi(input, {
    allowShortDoi: true,       // Accept shortDOIs (e.g. '10/abcde', 'doi.org/abcde'); default: false
    keepCasing: true,          // Keep original uppercase/lowercase; default: false
    keepPercentEncoding: true, // Keep percent-escapes as literal characters; default: false
});
```

---

### 4. Re-exported SID Utilities

All core utilities from [`@smart-science/sid`](https://github.com/smart-science/smart-id) are re-exported:

```ts
import {
    format,         // Format canonical SID to 'XXXX-XXXX-XXXX-XXXX-XXXX'
    fromBytes,      // Derive SID from 90 bits (12+ bytes)
    isFormattedSID, // Strict type guard for formatted SID
    isSID,          // Strict type guard for canonical SID
    parse,          // Forgiving parser and checksum verifier
    verify,         // Boolean checksum verification
} from '@smart-science/sdoi';
```

---

## TypeScript Types

```ts
import type {
    DoiToSid,
    DoiToSidAsync,
    FormattedSID,
    NormalizeDoiOptions,
    Sha256,
    Sha256Async,
    SID,
    SidErrorCode,
    SidResult,
} from '@smart-science/sdoi';
```

---

## Runtime Support

| Runtime | Versions |
|---|---|
| **Node.js** | 22.12 and later (`import` and `require()`) |
| **Bun** | 1.3 and later |
| **Browsers** | Current evergreen browsers |

---

## License

[Apache-2.0](LICENSE)
