// Copyright 2026 Martin Winkler
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, mock } from 'bun:test';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import * as sid from '@smart-science/sid';
import { normalizeDoi as normalizeDoiSource } from '../../src/doi.js';
import {
    createDoiToSid,
    createDoiToSidAsync,
    doiToSid,
    format,
    fromBytes,
    isFormattedSID,
    isSID,
    normalizeDoi,
    parse,
    verify,
} from '../../src/index.js';

function nodeSha256(text: string) {
    return createHash('sha256').update(text).digest();
}
function webSha256(text: string) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}
function nodeHash(algorithm: string, encoding: BufferEncoding = 'utf8') {
    return (text: string) => createHash(algorithm).update(text, encoding).digest();
}
function webHash(algorithm: string) {
    return (text: string) => crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
}

/** Reference vectors: [normalized DOI, SID of its SHA-256], computed with `node:crypto` and `fromBytes()`. */
const VECTORS: [string, string][] = [
    ['10.1000/182', 'SFG9CPDEVTC05D9SZVWM'],
    ['10.1000/abc', 'N3C77HSZ53MZRTE0S9Q7'],
    ['10.1000/äöü', 'G4XF94KMP3XNTYTKJPCY'],
    ['10.1000/ä', 'ZBEG7A1C5NWEFMNJQMV5'],
    ['10.1000/a b', '2TTQRV056SCEZ3QY9HSZ'],
];

function encodeEveryByte(text: string): string {
    return Array.from(new TextEncoder().encode(text), (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
}

/** Representations of a normalized DOI that all yield its SID: casing, URLs, text around it, percent-encoding. */
function representations(doi: string): string[] {
    const slash = doi.indexOf('/') + 1;
    const encodedSuffix = doi.slice(0, slash) + encodeURIComponent(doi.slice(slash));
    const upper = doi.replace(/[a-z]+/g, (letters) => letters.toUpperCase());
    return [
        doi,
        upper,
        `doi:${doi}`,
        `DOI: ${upper}`,
        `urn:doi:${doi}`,
        `see ${doi}`,
        `https://doi.org/${doi}`,
        `HTTPS://DX.DOI.ORG/${upper}`,
        `https://doi.org/${encodedSuffix}`,
        `https://doi.org/${doi.replaceAll('/', '%2F')}`,
        `http://10.0.0.1/${doi}`,
        `https://example.com/search?doi=${encodeURIComponent(upper)}`,
        `https://proxy.uni.edu/login?url=${encodeURIComponent(`https://doi.org/${doi}`)}`,
        encodeURIComponent(`HTTPS://DOI.ORG/${upper}`),
        encodeEveryByte(`doi:${doi}`),
        `%31%30${doi.slice(2)}`,
    ];
}

const REPRESENTATIONS: [string, string][] = VECTORS.flatMap(([doi, expected]) =>
    representations(doi).map((input): [string, string] => [input, expected]),
);

const INVALID = [
    '',
    'abc',
    '10.1000',
    '10.1000/',
    '10/abcde',
    'doi:10/abcde',
    'https://doi.org/abcde',
    'https://www.doi.org/abcde',
    'https://doi.org/10/abcde',
    '10.1000/a\tb',
    '10.1000/a%09b',
    '10.1000/a​b',
    '10.1000/a%E2%80%8Bb',
    '210.1000/x',
    '%3210.1000/x',
    '10.1000.2000.3000/abc',
    '10.1000%252Fabc',
    'https://doi.org/10.1000%252Fabc',
];

const NON_STRINGS: unknown[] = [undefined, null, 10.1, true, {}, [], new String('10.1000/abc')];

const NON_FUNCTIONS: unknown[] = [undefined, null, 'sha256', 256, {}, nodeSha256('x')];

/** Hashes that are not SHA-256 of the UTF-8 encoded text; each must fail the factory self-test. */
const WRONG_HASHES: [string, (text: string) => unknown][] = [
    ['identity', (text) => text],
    ['identity bytes', (text) => new TextEncoder().encode(text)],
    ['32 zero bytes', () => new Uint8Array(32)],
    ['SHA-1', nodeHash('sha1')],
    ['SHA-512', nodeHash('sha512')],
    ['SHA-256 truncated to 12 bytes', (text) => nodeSha256(text).subarray(0, 12)],
    ['SHA-256 of latin1', nodeHash('sha256', 'latin1')],
    ['SHA-256 of UTF-16', nodeHash('sha256', 'utf16le')],
    ['SHA-256 of uppercased text', (text) => nodeSha256(text.toUpperCase())],
    ['hex string', (text) => createHash('sha256').update(text).digest('hex')],
];

/** Runs `bytes` through another realm, as iframes, workers or `node:vm` do. */
const foreignUint8Array: (bytes: Uint8Array) => Uint8Array = vm.runInNewContext('(bytes) => Uint8Array.from(bytes)');
const foreignArrayBuffer: (bytes: Uint8Array) => ArrayBuffer = vm.runInNewContext(
    '(bytes) => Uint8Array.from(bytes).buffer',
);

const webDoiToSid = await createDoiToSidAsync(webSha256);

/** Returns a correct SHA-256 for the factory self-test, then `wrong` for every DOI. */
function failsAfterSelfTest<T>(wrong: T): (text: string) => T {
    let calls = 0;
    return (text) => (calls++ === 0 ? (nodeSha256(text) as T) : wrong);
}

describe('all implementations', () => {
    const nodeDoiToSid = createDoiToSid(nodeSha256);
    const inputs: unknown[] = [...REPRESENTATIONS.map(([input]) => input), ...INVALID, ...NON_STRINGS];

    it.each(REPRESENTATIONS)('derive the reference SID from %p', async (input, expected) => {
        expect(doiToSid(input)).toBe(expected as sid.SID);
        expect(nodeDoiToSid(input)).toBe(expected as sid.SID);
        expect(await webDoiToSid(input)).toBe(expected as sid.SID);
    });

    it.each([...INVALID, ...NON_STRINGS])('return null for %p', async (input) => {
        expect(doiToSid(input as string)).toBeNull();
        expect(nodeDoiToSid(input as string)).toBeNull();
        expect(await webDoiToSid(input as string)).toBeNull();
    });

    it('agree with fromBytes(SHA-256(normalizeDoi(input))) for valid and invalid input', async () => {
        for (const input of inputs) {
            const doi = normalizeDoi(input as string);
            const expected = doi === null ? null : fromBytes(nodeSha256(doi));
            expect([
                doiToSid(input as string),
                nodeDoiToSid(input as string),
                await webDoiToSid(input as string),
            ]).toEqual([expected, expected, expected]);
        }
    });
});

describe('doiToSid', () => {
    it('ignores extra arguments', () => {
        const withOptions = doiToSid as (input: string, options: object) => sid.SID | null;
        expect(withOptions('10.1000/ABC', { keepCasing: true })).toBe('N3C77HSZ53MZRTE0S9Q7' as sid.SID);
        expect(withOptions('10/abcde', { allowShortDoi: true })).toBeNull();
    });

    it('returns a canonical, verifiable SID', () => {
        const result = doiToSid('10.1000/182');
        expect(isSID(result)).toBe(true);
        expect(verify(result)).toBe(true);
        expect(format(result)).toEqual({ ok: true, data: 'SFG9-CPDE-VTC0-5D9S-ZVWM' as sid.FormattedSID });
    });
});

describe('createDoiToSid', () => {
    it('runs the self-test once, then calls sha256 once per DOI with the normalized DOI', () => {
        const sha256 = mock(nodeSha256);
        const derive = createDoiToSid(sha256);
        expect(sha256).toHaveBeenCalledTimes(1);
        derive('https://doi.org/10.1000/ABC');
        expect(sha256).toHaveBeenCalledTimes(2);
        expect(sha256).toHaveBeenLastCalledWith('10.1000/abc');
    });

    it('does not call sha256 for invalid DOIs', () => {
        const sha256 = mock(nodeSha256);
        const derive = createDoiToSid(sha256);
        for (const input of [...INVALID, ...NON_STRINGS]) {
            expect(derive(input as string)).toBeNull();
        }
        expect(sha256).toHaveBeenCalledTimes(1);
    });

    it('accepts Uint8Array views and ArrayBuffers from any realm', () => {
        function atOffset(text: string) {
            const padded = new Uint8Array(40);
            padded.set(nodeSha256(text), 8);
            return padded.subarray(8, 40);
        }
        const sha256s = [
            atOffset,
            (text: string) => foreignUint8Array(nodeSha256(text)),
            (text: string) => foreignArrayBuffer(nodeSha256(text)),
        ];
        for (const sha256 of sha256s) {
            expect(createDoiToSid(sha256)('10.1000/abc')).toBe('N3C77HSZ53MZRTE0S9Q7' as sid.SID);
        }
    });

    it('throws a TypeError if sha256 is not a function', () => {
        for (const sha256 of NON_FUNCTIONS) {
            expect(() => createDoiToSid(sha256 as never)).toThrow('sha256 must be a function');
        }
    });

    it.each(WRONG_HASHES)('throws a TypeError if sha256 is %s', (_, sha256) => {
        expect(() => createDoiToSid(sha256 as never)).toThrow(TypeError);
    });

    it('throws a TypeError if sha256 returns a Promise', () => {
        expect(() => createDoiToSid(webSha256 as never)).toThrow('use createDoiToSidAsync()');
        expect(() => createDoiToSid((async (text: string) => nodeSha256(text)) as never)).toThrow(
            'use createDoiToSidAsync()',
        );
    });

    it('propagates errors thrown by sha256', () => {
        const error = new Error('hash failed');
        expect(() =>
            createDoiToSid(() => {
                throw error;
            }),
        ).toThrow(error);
    });

    it('throws a TypeError if sha256 returns a wrong digest after the self-test', () => {
        expect(() => createDoiToSid(failsAfterSelfTest(new Uint8Array(31)))('10.1000/abc')).toThrow(TypeError);
        expect(() => createDoiToSid(failsAfterSelfTest(new Uint8Array(33)))('10.1000/abc')).toThrow(TypeError);
    });
});

describe('createDoiToSidAsync', () => {
    it('resolves to a function', async () => {
        const result = createDoiToSidAsync(webSha256);
        expect(result).toBeInstanceOf(Promise);
        expect(await result).toBeInstanceOf(Function);
    });

    it('accepts Uint8Array digests and ArrayBuffers from any realm', async () => {
        const sha256s = [
            async (text: string) => nodeSha256(text),
            async (text: string) => foreignUint8Array(nodeSha256(text)),
            async (text: string) => foreignArrayBuffer(nodeSha256(text)),
        ];
        for (const sha256 of sha256s) {
            expect(await (await createDoiToSidAsync(sha256))('10.1000/abc')).toBe('N3C77HSZ53MZRTE0S9Q7' as sid.SID);
        }
    });

    it('returns a promise for invalid DOIs without calling sha256', async () => {
        const sha256 = mock(webSha256);
        const derive = await createDoiToSidAsync(sha256);
        for (const input of [...INVALID, ...NON_STRINGS]) {
            const result = derive(input as string);
            expect(result).toBeInstanceOf(Promise);
            expect(await result).toBeNull();
        }
        expect(sha256).toHaveBeenCalledTimes(1);
    });

    it('runs the self-test once, then calls sha256 once per DOI with the normalized DOI', async () => {
        const sha256 = mock(webSha256);
        const derive = await createDoiToSidAsync(sha256);
        expect(sha256).toHaveBeenCalledTimes(1);
        await derive('https://doi.org/10.1000/ABC');
        expect(sha256).toHaveBeenCalledTimes(2);
        expect(sha256).toHaveBeenLastCalledWith('10.1000/abc');
    });

    it('rejects with a TypeError if sha256 is not a function', async () => {
        for (const sha256 of NON_FUNCTIONS) {
            await expect(createDoiToSidAsync(sha256 as never)).rejects.toThrow('sha256 must be a function');
        }
    });

    it.each([...WRONG_HASHES, ['Web Crypto SHA-1', webHash('SHA-1')], ['Web Crypto SHA-512', webHash('SHA-512')]] as [
        string,
        (text: string) => unknown,
    ][])('rejects with a TypeError if sha256 is %s', async (_, sha256) => {
        await expect(createDoiToSidAsync(async (text) => sha256(text) as never)).rejects.toThrow(TypeError);
    });

    it('rejects if sha256 rejects or throws', async () => {
        const error = new Error('hash failed');
        await expect(createDoiToSidAsync(() => Promise.reject(error))).rejects.toThrow(error);
        await expect(
            createDoiToSidAsync(() => {
                throw error;
            }),
        ).rejects.toThrow(error);
    });

    it('rejects with a TypeError if sha256 resolves to a wrong digest after the self-test', async () => {
        const derive = await createDoiToSidAsync(failsAfterSelfTest(Promise.resolve(new ArrayBuffer(31))));
        await expect(derive('10.1000/abc')).rejects.toThrow(TypeError);
    });
});

describe('re-exports', () => {
    it('re-exports @smart-science/sid unchanged', () => {
        expect(format).toBe(sid.format);
        expect(fromBytes).toBe(sid.fromBytes);
        expect(isFormattedSID).toBe(sid.isFormattedSID);
        expect(isSID).toBe(sid.isSID);
        expect(parse).toBe(sid.parse);
        expect(verify).toBe(sid.verify);
    });

    it('re-exports normalizeDoi() unchanged', () => {
        expect(normalizeDoi).toBe(normalizeDoiSource);
    });
});
