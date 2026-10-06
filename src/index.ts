// Copyright 2026 Martin Winkler
// SPDX-License-Identifier: Apache-2.0

import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { fromBytes, type SID } from '@smart-science/sid';
import { type NormalizeDoiOptions, normalizeDoi } from './doi.js';

/**
 * @spec 0201: Re-exports: `normalizeDoi`, `NormalizeDoiOptions`; from `@smart-science/sid` its types and `format`, `fromBytes`, \
 * `isFormattedSID`, `isSID`, `parse`, `verify`.
 */
export type { FormattedSID, SID, SidErrorCode, SidResult } from '@smart-science/sid';
export { format, fromBytes, isFormattedSID, isSID, parse, verify } from '@smart-science/sid';
export { type NormalizeDoiOptions, normalizeDoi } from './doi.js';

// -------------------------------------------------------------------
// 1. Types
// -------------------------------------------------------------------

/**
 * SHA-256 of the UTF-8 encoded `text`.
 *
 * Node.js/Bun: `(text) => createHash('sha256').update(text).digest()`.
 *
 * @spec 0208: Hash input: `sha256` receives the normalized DOI as `string` and hashes its UTF-8 encoding.
 */
export type Sha256 = (text: string) => Uint8Array | ArrayBuffer;

/**
 * Asynchronous SHA-256 of the UTF-8 encoded `text`.
 *
 * Web Crypto: `(text) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))`.
 *
 * @spec 0208: Hash input: `sha256` receives the normalized DOI as `string` and hashes its UTF-8 encoding.
 */
export type Sha256Async = (text: string) => Promise<Uint8Array | ArrayBuffer>;

/** Signature of `doiToSid()` and of the functions returned by `createDoiToSid()`. */
export type DoiToSid = (input: string) => SID | null;

/** Signature of the functions returned by `createDoiToSidAsync()`. */
export type DoiToSidAsync = (input: string) => Promise<SID | null>;

// -------------------------------------------------------------------
// 2. Constants
// -------------------------------------------------------------------

/** @spec 0206: Normalization: all `NormalizeDoiOptions` `false` (lowercased, percent-decoded, shortDOIs rejected). */
const NORMALIZE_OPTIONS: NormalizeDoiOptions = { allowShortDoi: false, keepCasing: false, keepPercentEncoding: false };

/**
 * Factory self-test input and its expected SID; 1- to 4-byte UTF-8 characters.
 * @spec 0211: Self-test: each factory hashes `10.1000/aä€😀` once; a SID mismatch throws `TypeError` \
 * (catches other algorithms, other encodings and identity functions).
 */
const SELF_TEST_TEXT = '10.1000/aä€\u{1f600}';
const SELF_TEST_SID = 'P53CD05BTGX8NHGHRQVK';

// -------------------------------------------------------------------
// 3. Exported Functions
// -------------------------------------------------------------------

/**
 * **Derives the SID of a DOI.**
 *
 * To use your own SHA-256 and keep `@noble/hashes` out of your bundle, use `createDoiToSid()` or `createDoiToSidAsync()`.
 *
 * @spec 0202: `doiToSid(input: string): SID | null`: uses SHA-256 from `@noble/hashes`.
 * @spec 0205: Pipeline: `normalizeDoi()`, SHA-256 of the UTF-8 encoded DOI, `fromBytes()` of the 32-byte digest.
 *
 * @param input - DOI, DOI URL, or text containing a DOI.
 * @returns Canonical 20-character `SID`, or `null` if `input` contains no valid DOI.
 */
export function doiToSid(input: string): SID | null {
    const doi = normalizeDoi(input, NORMALIZE_OPTIONS);
    /** @spec 0207: Invalid DOI: returns `null` without calling SHA-256. */
    return doi === null ? null : digestToSid(nobleSha256(new TextEncoder().encode(doi)));
}

/**
 * **Creates a `doiToSid()` that uses your synchronous SHA-256.**
 *
 * @spec 0203: `createDoiToSid(sha256: Sha256): DoiToSid`: uses a synchronous SHA-256; same SIDs as `doiToSid()`.
 *
 * @example
 * const doiToSid = createDoiToSid((text) => createHash('sha256').update(text).digest());
 *
 * @param sha256 - SHA-256 of the UTF-8 encoded text.
 * @returns Function with the signature of `doiToSid()`.
 * @throws {TypeError} If `sha256` is not a function or fails the SHA-256 self-test.
 */
export function createDoiToSid(sha256: Sha256): DoiToSid {
    assertFunction(sha256);
    const digest: unknown = sha256(SELF_TEST_TEXT);
    /** @spec 0210: Async guard: `createDoiToSid()` throws `TypeError` if `sha256` returns a thenable. */
    if (typeof (digest as PromiseLike<unknown> | null)?.then === 'function') {
        throw new TypeError('sha256 returns a Promise; use createDoiToSidAsync()');
    }
    assertSelfTest(digest);
    return (input) => {
        const doi = normalizeDoi(input, NORMALIZE_OPTIONS);
        return doi === null ? null : digestToSid(sha256(doi));
    };
}

/**
 * **Creates an async `doiToSid()` that uses your asynchronous SHA-256.**
 *
 * @spec 0204: `createDoiToSidAsync(sha256: Sha256Async): Promise<DoiToSidAsync>`: uses an asynchronous SHA-256 \
 * (e.g. Web Crypto); same SIDs as `doiToSid()`.
 *
 * @example
 * const doiToSid = await createDoiToSidAsync((text) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
 *
 * @param sha256 - Asynchronous SHA-256 of the UTF-8 encoded text.
 * @returns Promise of an async function with the parameters of `doiToSid()`.
 * @throws {TypeError} Rejects if `sha256` is not a function or fails the SHA-256 self-test.
 */
export async function createDoiToSidAsync(sha256: Sha256Async): Promise<DoiToSidAsync> {
    assertFunction(sha256);
    assertSelfTest(await sha256(SELF_TEST_TEXT));
    return async (input) => {
        const doi = normalizeDoi(input, NORMALIZE_OPTIONS);
        return doi === null ? null : digestToSid(await sha256(doi));
    };
}

// -------------------------------------------------------------------
// 4. Internal Helper Functions
// -------------------------------------------------------------------

/** @spec 0209: Function check: a non-function `sha256` throws `TypeError` (async factory: rejects). */
function assertFunction(sha256: unknown): void {
    if (typeof sha256 !== 'function') {
        throw new TypeError('sha256 must be a function');
    }
}

function assertSelfTest(digest: unknown): void {
    if (digestToSid(digest) !== SELF_TEST_SID) {
        throw new TypeError('sha256 failed the self-test: expected SHA-256 of the UTF-8 encoded text');
    }
}

/**
 * Converts a SHA-256 digest to a `SID`.
 * @spec 0213: Digest length: exactly 32 bytes; any other digest throws `TypeError`.
 */
function digestToSid(digest: unknown): SID {
    const bytes = toBytes(digest);
    const sid = bytes?.byteLength === 32 ? fromBytes(bytes) : null;
    if (sid === null) {
        throw new TypeError('sha256 must return a 32-byte Uint8Array or ArrayBuffer');
    }
    return sid;
}

/**
 * Reads a digest as bytes; `null` for any other value.
 * @spec 0212: Digest type: `ArrayBuffer` or any `ArrayBuffer` view (`Uint8Array`, `Buffer`, ...).
 * @spec 0214: Cross-realm digests: accepted from iframes, workers and `node:vm`; views are read without copying.
 */
function toBytes(digest: unknown): Uint8Array | null {
    if (ArrayBuffer.isView(digest)) {
        return new Uint8Array(digest.buffer, digest.byteOffset, digest.byteLength);
    }
    if (Object.prototype.toString.call(digest) === '[object ArrayBuffer]') {
        return new Uint8Array(digest as ArrayBuffer);
    }
    return null;
}
