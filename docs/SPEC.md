# SDOI Specification

Decided behavior and non-obvious details of `@smart-science/sdoi`. Referenced in code as `@spec NNNN`.

## 1. DOI Normalization (`doi.ts`)

### 1.1 Signature

- 🔴 @spec 0101: Export: `normalizeDoi(input: string, options: NormalizeDoiOptions = {}): string | null`.
- 🔴 @spec 0102: Result: normalized DOI as `string`; `null` if `input` contains no valid DOI.
- 🔴 @spec 0103: Determinism: every accepted representation of a DOI yields the same normalized DOI.
- 🔴 @spec 0104: Input type: non-string `input` returns `null`.

### 1.2 Options

- 🔴 @spec 0105: Options type: `NormalizeDoiOptions`, an object of optional booleans.
- 🔴 @spec 0106: `allowShortDoi`: default `false` returns `null` for shortDOIs; `true` accepts them.
- 🔴 @spec 0107: `keepCasing`: default `false` lowercases Basic Latin `A-Z`; `true` keeps the input casing.
- 🔴 @spec 0108: `keepPercentEncoding`: default `false` decodes percent-escapes (`%2F`, `%20`, ...); `true` keeps them as literal text.

### 1.3 Extraction

- 🔴 @spec 0109: Order: percent-decode first, then search the DOI in the decoded text.
- 🔴 @spec 0110: DOI start: first `10.<registrant>/` not preceded by a digit or `.` (skips `210.1000/`, `192.168.10.1/`).
- 🔴 @spec 0111: Registrant code: digits with at most one `.<digits>` subdivision (`1000`, `1000.10`).
- 🔴 @spec 0112: Leading text: everything before the DOI start is dropped (`doi:`, `https://doi.org/`, prose).
- 🔴 @spec 0113: Trailing text: everything from the DOI start on is kept; never trimmed or cut at punctuation (`.`, `,`, `)`).

### 1.4 Casing & Validation

- 🔴 @spec 0114: Casing: only Basic Latin `A-Z` is lowercased; other letters (`Ä`, `Σ`) keep their case.
- 🔴 @spec 0115: Suffix characters: one or more Graphic code points (letters, marks, numbers, punctuation, symbols, `Zs` spaces incl. NBSP).
- 🔴 @spec 0116: Rejected characters: controls, line breaks, format characters (ZWSP, BOM, SHY), lone surrogates, private-use and \
                 unassigned code points return `null`.

### 1.5 shortDOI

- 🔴 @spec 0117: Detection: only if no DOI start is found and `allowShortDoi` is `true`; the whole decoded input must match.
- 🔴 @spec 0118: Forms: `10/<code>`, `doi.org/<code>`, `doi.org/10/<code>`; optional `doi:`, `http(s)://`, `dx.`/`www.` prefixes; \
                 case-insensitive.
- 🔴 @spec 0119: Code: ASCII letters and digits only.
- 🔴 @spec 0120: Output: `10/<code>`, code lowercased unless `keepCasing`.

### 1.6 Percent Decoding

- 🔴 @spec 0121: Unit: each percent-encoded UTF-8 character (1 to 4 escapes) is decoded on its own.
- 🔴 @spec 0122: Single pass: decoded once; `%2541` yields `%41`.
- 🔴 @spec 0123: Malformed escapes: kept as-is (lone continuation bytes, truncated, overlong or surrogate sequences, `%` without hex).

## 2. DOI to SID (`index.ts`)

### 2.1 Exports

- 🔴 @spec 0201: Re-exports: `normalizeDoi`, `NormalizeDoiOptions`; from `@smart-science/sid` its types and `format`, `fromBytes`, \
                 `isFormattedSID`, `isSID`, `parse`, `verify`.
- 🔴 @spec 0202: `doiToSid(input: string): SID | null`: uses SHA-256 from `@noble/hashes`.
- 🔴 @spec 0203: `createDoiToSid(sha256: Sha256): DoiToSid`: uses a synchronous SHA-256; same SIDs as `doiToSid()`.
- 🔴 @spec 0204: `createDoiToSidAsync(sha256: Sha256Async): Promise<DoiToSidAsync>`: uses an asynchronous SHA-256 \
                 (e.g. Web Crypto); same SIDs as `doiToSid()`.

### 2.2 Derivation

- 🔴 @spec 0205: Pipeline: `normalizeDoi()`, SHA-256 of the UTF-8 encoded DOI, `fromBytes()` of the 32-byte digest.
- 🔴 @spec 0206: Normalization: all `NormalizeDoiOptions` `false` (lowercased, percent-decoded, shortDOIs rejected).
- 🔴 @spec 0207: Invalid DOI: returns `null` without calling SHA-256.

### 2.3 Custom SHA-256

- 🔴 @spec 0208: Hash input: `sha256` receives the normalized DOI as `string` and hashes its UTF-8 encoding.
- 🔴 @spec 0209: Function check: a non-function `sha256` throws `TypeError` (async factory: rejects).
- 🔴 @spec 0210: Async guard: `createDoiToSid()` throws `TypeError` if `sha256` returns a thenable.
- 🔴 @spec 0211: Self-test: each factory hashes `10.1000/aä€😀` once; a SID mismatch throws `TypeError` \
                 (catches other algorithms, other encodings and identity functions).
- 🔴 @spec 0212: Digest type: `ArrayBuffer` or any `ArrayBuffer` view (`Uint8Array`, `Buffer`, ...).
- 🔴 @spec 0213: Digest length: exactly 32 bytes; any other digest throws `TypeError`.
- 🔴 @spec 0214: Cross-realm digests: accepted from iframes, workers and `node:vm`; views are read without copying.

## DOI Reference

Facts about DOI names, not behavior of this package.

- @doi 0001: Definition: `ISO 26324`; `ANSI/NISO Z39.84`.
- @doi 0002: General Format: `<prefix>/<suffix>`; begins strictly with `10.`.

### Prefix

- @doi 0003: Prefix character set: `0-9` and `.`.
- @doi 0004: Registrant: `10.<registrant>/<suffix>`.
- @doi 0005: Sub-registrant: `10.<registrant>.<sub-registrant>/<suffix>`.
- @doi 0006: Registrant numbers typically 4-9 digits.

### Suffix

- @doi 0007: Suffix character set: unrestricted `ISO/IEC 10646` (Unicode/UTF-8); any printable character.
- @doi 0008: Can contain: multiple slashes, whitespaces, nbsp, zwsp, hyphens, all forms of brackets `<>`, `()`, `[]`, `{}`, `:`, `,`, `;`, `_`, `-`, `*`, `+`, `=`, `.`, `#` etc.
- @doi 0009: Whitespaces in specification; though strongly deprecated; occasionally in legacy DOIs.
- @doi 0010: Non-standard whitespaces never intentionally used as DOIs: zero-width spaces, non-breaking spaces, zero-width non-breaking spaces/BOM, soft hyphens.
- @doi 0011: Non-standard whitespaces cannot be strictly normalized to regular whitespace (especially not at the end) as they might be artifacts not part of the actual DOI.
- @doi 0012: Suffix is case-insensitive for ASCII characters; case retention is allowed.
- @doi 0013: URLs: URI Characters (`?` - query param, `#` - section, `%` - char for percent-encoding itself, `/` - path) need to be percent-encoded to preserve full DOI.

### Schemas

- @doi 0014: Schema-prefixed may be: `doi:10.xxxx/...`, `DOI:10.xxxx/...`, `urn:doi:10.xxxx/...`.
- @doi 0015: URL Schema e.g.: `https://doi.org/10.xxxx/`, `http://dx.doi.org/10.xxxx/`, `https://handle.net/10.xxxx/`.

### Cleansing

- @doi 0016: DOIs embedded in prose might terminate in `.`, `,`, `;`, `)` - cleansing must be careful as these characters might be valid DOIs.
- @doi 0017: Balanced-bracket heuristics: might only delete closing brackets if no corresponding opening bracket is found within the doi e.g. `10.0001/some(text))`.

### Short Doi

- @doi 0018: Short DOIs are just alias
- @doi 0019: format like `10/abcde` and `https://doi.org/abcde`
