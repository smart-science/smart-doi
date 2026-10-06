// Copyright 2026 Martin Winkler
// SPDX-License-Identifier: Apache-2.0

/*
 * DOI syntax (DOI Handbook 2025 §4.3, ISO 26324):
 *
 *   <prefix>/<suffix>
 *   prefix = directory indicator `10` + `.` + registrant code (digits, optionally one `.<digits>` subdivision)
 *   suffix = any Unicode "Graphic" code points: letters, marks, numbers, punctuation, symbols and spaces (Zs)
 *
 * DOI names are case-insensitive for Basic Latin `A-Z` only (§4.3.4) - other letters are kept as-is.
 * Percent-encoding is a URL representation only (§4.7) - the DOI name is the decoded string.
 * shortDOIs (`10/abcde`, `https://doi.org/abcde`, §6.5) are not DOI names: they lack the registrant code.
 */

// -------------------------------------------------------------------
// 1. Types
// -------------------------------------------------------------------

/** @spec 0105: Options type: `NormalizeDoiOptions`, an object of optional booleans. */
export type NormalizeDoiOptions = {
    /**
     * Accept shortDOIs (`10/abcde`, `doi.org/abcde`) and return them as `10/<code>`.
     * @spec 0106: `allowShortDoi`: default `false` returns `null` for shortDOIs; `true` accepts them.
     */
    allowShortDoi?: boolean;
    /**
     * Keep the original casing instead of lowercasing Basic Latin `A-Z`.
     * @spec 0107: `keepCasing`: default `false` lowercases Basic Latin `A-Z`; `true` keeps the input casing.
     */
    keepCasing?: boolean;
    /**
     * Keep percent-escapes as literal characters instead of decoding them.
     * @spec 0108: `keepPercentEncoding`: default `false` decodes percent-escapes (`%2F`, `%20`, ...); `true` keeps them as literal text.
     */
    keepPercentEncoding?: boolean;
};

// -------------------------------------------------------------------
// 2. Constants & Regex
// -------------------------------------------------------------------

/**
 * Valid normalized DOI: `10.` + registrant code + `/` + Graphic code points.
 * @spec 0115: Suffix characters: one or more Graphic code points (letters, marks, numbers, punctuation, symbols, `Zs` spaces incl. NBSP).
 * @spec 0116: Rejected characters: controls, line breaks, format characters (ZWSP, BOM, SHY), lone surrogates, private-use and \
 * unassigned code points return `null`.
 */
const MATCH_DOI = /^10\.\d+(?:\.\d+)?\/[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]+$/u;

/**
 * Start of a DOI.
 * @spec 0110: DOI start: first `10.<registrant>/` not preceded by a digit or `.` (skips `210.1000/`, `192.168.10.1/`).
 * @spec 0111: Registrant code: digits with at most one `.<digits>` subdivision (`1000`, `1000.10`).
 */
const MATCH_DOI_START = /(?<![\d.])10\.\d+(?:\.\d+)?\//;

/**
 * shortDOI as whole input; group 1 is the code.
 * @spec 0118: Forms: `10/<code>`, `doi.org/<code>`, `doi.org/10/<code>`; optional `doi:`, `http(s)://`, `dx.`/`www.` prefixes; \
 * case-insensitive.
 * @spec 0119: Code: ASCII letters and digits only.
 */
const MATCH_SHORT_DOI = /^(?:doi:\s*)?(?:(?:https?:\/\/)?(?:dx\.|www\.)?doi\.org\/(?:10\/)?|10\/)([a-z0-9]+)$/i;

/**
 * One percent-encoded UTF-8 character: lead byte plus 0 to 3 continuation bytes (`%41`, `%C3%A1`, `%E2%82%AC`).
 * @spec 0121: Unit: each percent-encoded UTF-8 character (1 to 4 escapes) is decoded on its own.
 */
const MATCH_PERCENT_CHARACTER =
    /%[0-7][0-9a-f]|%[cd][0-9a-f]%[89ab][0-9a-f]|%e[0-9a-f](?:%[89ab][0-9a-f]){2}|%f[0-7](?:%[89ab][0-9a-f]){3}/gi;

/** @spec 0114: Casing: only Basic Latin `A-Z` is lowercased; other letters (`Ä`, `Σ`) keep their case. */
const MATCH_BASIC_LATIN_UPPERCASE = /[A-Z]+/g;

// -------------------------------------------------------------------
// 3. Exported Functions
// -------------------------------------------------------------------

/**
 * **Normalize DOI**
 *
 * Nothing is trimmed - invalid characters (controls, tabs, newlines, zero-width chars) yield `null`.
 *
 * @spec 0101: Export: `normalizeDoi(input: string, options: NormalizeDoiOptions = {}): string | null`.
 * @spec 0102: Result: normalized DOI as `string`; `null` if `input` contains no valid DOI.
 * @spec 0103: Determinism: every accepted representation of a DOI yields the same normalized DOI.
 *
 * @returns normalized DOI or `null` if input is not a valid DOI
 */
export function normalizeDoi(input: string, options: NormalizeDoiOptions = {}): string | null {
    /** @spec 0104: Input type: non-string `input` returns `null`. */
    if (typeof input !== 'string') {
        return null;
    }
    const { allowShortDoi = false, keepCasing = false, keepPercentEncoding = false } = options ?? {};
    /** @spec 0109: Order: percent-decode first, then search the DOI in the decoded text. */
    const decoded = keepPercentEncoding ? input : percentDecode(input);
    const start = decoded.search(MATCH_DOI_START);

    /** @spec 0117: Detection: only if no DOI start is found and `allowShortDoi` is `true`; the whole decoded input must match. */
    if (start === -1) {
        const code = allowShortDoi ? MATCH_SHORT_DOI.exec(decoded)?.[1] : undefined;
        /** @spec 0120: Output: `10/<code>`, code lowercased unless `keepCasing`. */
        return code !== undefined ? `10/${keepCasing ? code : code.toLowerCase()}` : null;
    }

    /**
     * @spec 0112: Leading text: everything before the DOI start is dropped (`doi:`, `https://doi.org/`, prose).
     * @spec 0113: Trailing text: everything from the DOI start on is kept; never trimmed or cut at punctuation (`.`, `,`, `)`).
     */
    const candidate = decoded.slice(start);
    const doi = keepCasing
        ? candidate
        : candidate.replace(MATCH_BASIC_LATIN_UPPERCASE, (letters) => letters.toLowerCase());
    return MATCH_DOI.test(doi) ? doi : null;
}

// -------------------------------------------------------------------
// 4. Internal Helper Functions
// -------------------------------------------------------------------

/**
 * Decodes percent-escapes character by character.
 * @spec 0122: Single pass: decoded once; `%2541` yields `%41`.
 */
function percentDecode(input: string): string {
    return input.replace(MATCH_PERCENT_CHARACTER, (escapes) => {
        try {
            return decodeURIComponent(escapes);
        } catch {
            /** @spec 0123: Malformed escapes: kept as-is (lone continuation bytes, truncated, overlong or surrogate sequences, `%` without hex). */
            return escapes;
        }
    });
}
