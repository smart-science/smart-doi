// Copyright 2026 Martin Winkler
// SPDX-License-Identifier: Apache-2.0

import { afterAll, describe, expect, it } from 'bun:test';
import { type NormalizeDoiOptions, normalizeDoi } from '../../src/doi.js';

type Case = { group: Group; input: string; options: NormalizeDoiOptions; expected: string | null };
type Failure = { input: string; options: string; expected: string | null; actual: string | null };
/** One representation of `context + doi`: the raw input, the output when decoding and when keeping escapes. */
type Encoded = { input: string; decoded: string | null; kept: string | null };
type Encoder = (context: string, doi: string) => Encoded;

/** All 8 option combinations; column order of the options matrix. */
const OPTION_SETS: Required<NormalizeDoiOptions>[] = [false, true].flatMap((keepPercentEncoding) =>
    [false, true].flatMap((keepCasing) =>
        [false, true].map((allowShortDoi) => ({ allowShortDoi, keepCasing, keepPercentEncoding })),
    ),
);

/** Non-string garbage (JS callers, database values) - must all be rejected. */
const NON_STRINGS: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['number', 10.1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['bigint', 10n],
    ['boolean true', true],
    ['boolean false', false],
    ['symbol', Symbol('10.1000/182')],
    ['function', () => '10.1000/182'],
    ['plain object', { doi: '10.1000/182' }],
    ['object with toString', { toString: () => '10.1000/182' }],
    ['array of string', ['10.1000/182']],
    ['empty array', []],
    ['String object', new String('10.1000/182')],
    ['URL object', new URL('https://doi.org/10.1000/182')],
    ['Date', new Date(0)],
    ['RegExp', /10\.1000\/182/],
    ['Map', new Map([['doi', '10.1000/182']])],
    ['Set', new Set(['10.1000/182'])],
    ['Error', new Error('10.1000/182')],
    ['Promise', Promise.resolve('10.1000/182')],
    ['Uint8Array', new TextEncoder().encode('10.1000/182')],
    ['null-prototype object', Object.create(null)],
];

/**
 * Valid DOIs in decoded form, mixed case. Every shape is combined with every context, encoder, casing and trailing text.
 * No suffix contains a `10.<digits>/` segment, and none ends in a way that trailing text could turn into an escape.
 */
const SHAPES: string[] = [
    '10.1000/182',
    '10.1038/issn.1476-4687',
    '10.5594/SMPTE.ST2067-21.2020',
    '10.500.100/abc',
    '10.123/456ABC/zyz',
    '10.1016/S0140-6736(20)30183-5',
    '10.1002/(SICI)1097-4636(199706)35:4<449::AID-JBM5>3.0.CO;2-O',
    '10.26321/Á.gutiérrez.Zarza',
    '10.1000/ΣΑΣ-Straße',
    '10.1000/日本語',
    '10.1000/a😀b',
    '10.1000/é',
    '10.1000/a b c　d',
    '10.1000/!"#$&\'*+,-.:;=?@_`|~^\\',
    '10.1000/[a]{b}(c)<d>',
    '10.1000/100%',
    '10.1000/a%2',
];

/** Text before the DOI that is dropped: no DOI start, and not ending with a digit, `.` or `%`. */
const CONTEXTS: string[] = [
    '',
    'doi:',
    'DOI:',
    'doi: ',
    'doi :',
    'doi ',
    'doi: ',
    'urn:doi:',
    'info:doi/',
    'https://doi.org/',
    'http://doi.org/',
    'https://dx.doi.org/',
    'https://www.doi.org/',
    'doi.org/',
    'dx.doi.org/',
    'www.doi.org/',
    'https://hdl.handle.net/',
    'https://doi.org/doi:',
    'https://doi.org/urn:doi:',
    'doi:https://doi.org/',
    'https://onlinelibrary.wiley.com/doi/full/',
    'https://link.springer.com/article/',
    'https://example.com/search?doi=',
    'https://proxy.uni.edu/login?url=https://doi.org/',
    'http://10.0.0.1/',
    'http://192.168.10.10/',
    'título: ',
    '  ',
    '\t\n',
    'see ',
    'x',
    '(',
    '"',
    '﻿',
    '%ZZ ',
    '100% ',
];

/** Text after the DOI; kept as part of the suffix. */
const TRAILING: string[] = ['', ' here', '?via=ihub', '#abstract', '.pdf', '/'];

/** Casing applied to context, DOI and trailing text before encoding. */
const CASINGS: [string, (text: string) => string][] = [
    ['as-is', (text) => text],
    ['uppercase', (text) => text.replace(/[a-z]+/g, (letters) => letters.toUpperCase())],
];

/** Splits `10.1000/abc` into `10.1000/` and `abc`. */
function splitPrefix(doi: string): [string, string] {
    const slash = doi.indexOf('/') + 1;
    return [doi.slice(0, slash), doi.slice(slash)];
}

function encodeEveryByte(text: string): string {
    return Array.from(
        new TextEncoder().encode(text),
        (byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`,
    ).join('');
}

/** Representations that decode back to the plain text once. */
const SINGLE_ENCODERS: [string, Encoder][] = [
    ['plain', (context, doi) => ({ input: context + doi, decoded: doi, kept: doi })],
    [
        'suffix encodeURIComponent',
        (context, doi) => {
            const [prefix, suffix] = splitPrefix(doi);
            const encoded = prefix + encodeURIComponent(suffix);
            return { input: context + encoded, decoded: doi, kept: encoded };
        },
    ],
    // escaped `/` hides the DOI start when escapes are kept
    [
        'slashes as %2F',
        (context, doi) => ({ input: `${context}${doi}`.replaceAll('/', '%2F'), decoded: doi, kept: null }),
    ],
    [
        'whole encodeURIComponent',
        (context, doi) => ({ input: encodeURIComponent(context + doi), decoded: doi, kept: null }),
    ],
    [
        'whole encodeURIComponent, lowercase hex',
        (context, doi) => ({
            input: encodeURIComponent(context + doi).replace(/%[0-9A-F]{2}/g, (hex) => hex.toLowerCase()),
            decoded: doi,
            kept: null,
        }),
    ],
    [
        'whole encodeURI',
        // kept escapes like `%20` end with a digit that blocks the DOI start right after them
        (context, doi) => ({
            input: encodeURI(context + doi),
            decoded: doi,
            kept: /[\d.]$/.test(encodeURI(context)) ? null : encodeURI(doi),
        }),
    ],
    [
        'every UTF-8 byte escaped',
        (context, doi) => ({ input: encodeEveryByte(context + doi), decoded: doi, kept: null }),
    ],
];

/** Double encoding is decoded once only: the output keeps one level of escapes. */
const ENCODERS: [string, Encoder][] = [
    ...SINGLE_ENCODERS,
    [
        'suffix double-encoded',
        (context, doi) => {
            const [prefix, suffix] = splitPrefix(doi);
            const twice = prefix + encodeURIComponent(encodeURIComponent(suffix));
            return { input: context + twice, decoded: prefix + encodeURIComponent(suffix), kept: twice };
        },
    ],
    [
        'whole double-encoded',
        (context, doi) => ({ input: encodeURIComponent(encodeURIComponent(context + doi)), decoded: null, kept: null }),
    ],
];

/** Obviously broken DOIs: must yield `null` in any context and plain or percent-encoded. */
const BROKEN: string[] = [
    // control characters, also as trailing text
    '10.1000/a\nb',
    '10.1000/a\tb',
    '10.1000/a\rb',
    '10.1000/a\0b',
    '10.1000/a\u0007b',
    '10.1000/a\u007fb',
    '10.1000/a\u0085b',
    '10.1000/abc\n',
    '10.1000/abc\t',
    '10.1000/abc\r\n',
    // invisible format characters, line and paragraph separators
    '10.1000/a­b',
    '10.1000/a​b',
    '10.1000/abc​',
    '10.1000/a‍b',
    '10.1000/a‎b',
    '10.1000/a﻿b',
    '10.1000/abc﻿',
    '10.1000/a⁠b',
    '10.1000/a\u2028b',
    '10.1000/a\u2029b',
    '10.1000/👨‍👩‍👧',
    // noncharacter, unassigned, private use
    '10.1000/a￾b',
    '10.1000/a͸b',
    '10.1000/ab',
    // empty suffix
    '10.1000/',
    // malformed prefix
    '10./abc',
    '10.1000./abc',
    '10..1000/abc',
    '10.1000.2000.3000/abc',
    '10.1000.a/abc',
    '10.abc/def',
    '10.1000a/def',
    '10 .1000/abc',
    '10. 1000/abc',
    '10.1000 /abc',
    '１０.1000/abc',
    '10.１０００/abc',
    '10．1000/abc',
    '10.1000／abc',
    '11.1000/abc',
    '1.1000/abc',
    '10.1000',
    '10/',
];

/** Lowercases Basic Latin `A-Z` only, like `normalizeDoi()`. */
function lowercaseBasicLatin(text: string): string {
    return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

function describeOptions(options: NormalizeDoiOptions): string {
    return (
        Object.entries(options)
            .filter(([, enabled]) => enabled)
            .map(([name]) => name)
            .join('+') || 'default'
    );
}

/** Generated cases per group, printed after the tests; a group with failures is marked `✗`. */
const GROUPS = {
    valid: { passed: 'valid DOI inputs normalized as expected', failed: 'valid DOI inputs normalized incorrectly' },
    idempotent: {
        passed: 'normalized DOIs stayed unchanged when normalized again',
        failed: 'normalized DOIs changed when normalized again',
    },
    broken: { passed: 'broken DOI inputs returned null', failed: 'broken DOI inputs did not return null' },
    short: { passed: 'shortDOI inputs rejected as expected', failed: 'shortDOI inputs not rejected as expected' },
};
type Group = keyof typeof GROUPS;
const checkedCount: Record<Group, number> = { valid: 0, idempotent: 0, broken: 0, short: 0 };
const failedCount: Record<Group, number> = { valid: 0, idempotent: 0, broken: 0, short: 0 };

/** Runs all cases and returns the first 20 mismatches, so a failing test lists the actual inputs. */
function mismatches(cases: Iterable<Case>): Failure[] {
    const failures: Failure[] = [];
    let checked = 0;
    for (const { group, input, options, expected } of cases) {
        checked++;
        checkedCount[group]++;
        const actual = normalizeDoi(input, options);
        if (actual !== expected) {
            failedCount[group]++;
            if (failures.length < 20) {
                failures.push({ input, options: describeOptions(options), expected, actual });
            }
        }
    }
    if (checked === 0) {
        throw new Error('no cases');
    }
    return failures;
}

afterAll(() => {
    const lines = (Object.keys(GROUPS) as Group[])
        .filter((group) => checkedCount[group] > 0)
        .map((group) => {
            const checked = checkedCount[group].toLocaleString('en-US');
            const failed = failedCount[group].toLocaleString('en-US');
            return failedCount[group] === 0
                ? `✓ ${checked} ${GROUPS[group].passed}`
                : `✗ ${failed} of ${checked} ${GROUPS[group].failed}`;
        });
    if (lines.length > 0) {
        console.log(`${lines.join('\n')}\n`);
    }
});

function* validCombinations(encoder: Encoder): Generator<Case> {
    for (const shape of SHAPES) {
        for (const context of CONTEXTS) {
            for (const trailing of TRAILING) {
                for (const [, casing] of CASINGS) {
                    const { input, decoded, kept } = encoder(casing(context), casing(shape + trailing));
                    for (const options of OPTION_SETS) {
                        const output = options.keepPercentEncoding ? kept : decoded;
                        const expected = output === null || options.keepCasing ? output : lowercaseBasicLatin(output);
                        yield { group: 'valid', input, options, expected };
                        // idempotent, except where a decoded output still holds escapes (decode once)
                        if (expected !== null && (options.keepPercentEncoding || !/%[0-9a-f]{2}/i.test(expected))) {
                            yield { group: 'idempotent', input: expected, options, expected };
                        }
                    }
                }
            }
        }
    }
}

function* brokenCombinations(encoder: Encoder, optionSets: NormalizeDoiOptions[]): Generator<Case> {
    for (const broken of BROKEN) {
        for (const context of CONTEXTS) {
            for (const [, casing] of CASINGS) {
                const { input } = encoder(casing(context), casing(broken));
                for (const options of optionSets) {
                    yield { group: 'broken', input, options, expected: null };
                }
            }
        }
    }
}

describe('normalizeDoi', () => {
    it.each(NON_STRINGS)('rejects non-string: %s', (_, input) => {
        for (const options of OPTION_SETS) {
            expect(normalizeDoi(input as string, options)).toBeNull();
        }
    });

    it('treats missing, null, empty and all-false options alike', () => {
        for (const input of ['HTTPS://DOI.ORG/10.1000/A%20B', '10/abcde', '10.1000/a%0Ab']) {
            expect(normalizeDoi(input, null as unknown as NormalizeDoiOptions)).toBe(normalizeDoi(input));
            expect(normalizeDoi(input, {})).toBe(normalizeDoi(input));
            expect(normalizeDoi(input, OPTION_SETS[0])).toBe(normalizeDoi(input));
        }
    });

    describe('combinations: shape × context × trailing text × casing × options', () => {
        it.each(ENCODERS)('normalizes every valid DOI, %s', (_, encoder) => {
            expect(mismatches(validCombinations(encoder))).toEqual([]);
        });

        it.each(SINGLE_ENCODERS)('returns null for every broken DOI, %s', (_, encoder) => {
            const decoding = OPTION_SETS.filter((options) => !options.keepPercentEncoding);
            expect(mismatches(brokenCombinations(encoder, decoding))).toEqual([]);
        });

        it('returns null for every plain broken DOI with any options', () => {
            expect(mismatches(brokenCombinations(SINGLE_ENCODERS[0][1], OPTION_SETS))).toEqual([]);
        });

        it('returns null for lone surrogates with any options', () => {
            // not percent-encodable: `encodeURIComponent()` throws on lone surrogates
            const cases = [
                '10.1000/\ud800',
                '10.1000/a\udc00b',
                '10.1000/\ude00\ud83d',
                'doi:10.1000/abc\ud83d',
            ].flatMap((input) =>
                OPTION_SETS.map((options) => ({ group: 'broken' as const, input, options, expected: null })),
            );
            expect(mismatches(cases)).toEqual([]);
        });
    });

    // columns: OPTION_SETS order - default, s, c, sc, p, sp, cp, scp
    // (s = allowShortDoi, c = keepCasing, p = keepPercentEncoding)
    it.each([
        ['10/AbCdE', [null, '10/abcde', null, '10/AbCdE', null, '10/abcde', null, '10/AbCdE']],
        ['doi:10/AbCdE', [null, '10/abcde', null, '10/AbCdE', null, '10/abcde', null, '10/AbCdE']],
        ['https://doi.org/AbCdE', [null, '10/abcde', null, '10/AbCdE', null, '10/abcde', null, '10/AbCdE']],
        ['HTTPS://WWW.DOI.ORG/AbCdE', [null, '10/abcde', null, '10/AbCdE', null, '10/abcde', null, '10/AbCdE']],
        ['10%2FAbCdE', [null, '10/abcde', null, '10/AbCdE', null, null, null, null]],
        ['HTTPS%3A%2F%2FDOI.ORG%2FAbCdE', [null, '10/abcde', null, '10/AbCdE', null, null, null, null]],
        ['10/Ab%43dE', [null, '10/abcde', null, '10/AbCdE', null, null, null, null]],
        ['10/abc%20de', [null, null, null, null, null, null, null, null]],
        [
            'https://doi.org/10.1000/AbC',
            [
                '10.1000/abc',
                '10.1000/abc',
                '10.1000/AbC',
                '10.1000/AbC',
                '10.1000/abc',
                '10.1000/abc',
                '10.1000/AbC',
                '10.1000/AbC',
            ],
        ],
        [
            'HTTPS://DOI.ORG/10.1000/A%20B',
            [
                '10.1000/a b',
                '10.1000/a b',
                '10.1000/A B',
                '10.1000/A B',
                '10.1000/a%20b',
                '10.1000/a%20b',
                '10.1000/A%20B',
                '10.1000/A%20B',
            ],
        ],
        ['10.1000%2FABC', ['10.1000/abc', '10.1000/abc', '10.1000/ABC', '10.1000/ABC', null, null, null, null]],
        ['%10.1000/abc', [null, null, null, null, '10.1000/abc', '10.1000/abc', '10.1000/abc', '10.1000/abc']],
        ['10.1000/a%0Ab', [null, null, null, null, '10.1000/a%0ab', '10.1000/a%0ab', '10.1000/a%0Ab', '10.1000/a%0Ab']],
        [
            '10.1000/A%252FB',
            [
                '10.1000/a%2fb',
                '10.1000/a%2fb',
                '10.1000/A%2FB',
                '10.1000/A%2FB',
                '10.1000/a%252fb',
                '10.1000/a%252fb',
                '10.1000/A%252FB',
                '10.1000/A%252FB',
            ],
        ],
        [
            '10.1000/%C3%81',
            [
                '10.1000/Á',
                '10.1000/Á',
                '10.1000/Á',
                '10.1000/Á',
                '10.1000/%c3%81',
                '10.1000/%c3%81',
                '10.1000/%C3%81',
                '10.1000/%C3%81',
            ],
        ],
    ] as [string, (string | null)[]][])('options matrix %p', (input, expected) => {
        expect(OPTION_SETS.map((options) => normalizeDoi(input, options))).toEqual(expected);
    });

    describe('percent-decoding', () => {
        it.each([
            ['10.1000/a%20b', '10.1000/a b'],
            ['10.1000/a%2Fb', '10.1000/a/b'],
            ['10.1000/a%2fb', '10.1000/a/b'],
            ['10.1000/%7E', '10.1000/~'],
            ['10.1000/%c3%A1', '10.1000/á'],
            ['10.1000/%C2%A0', '10.1000/ '],
            ['10.1000/%E2%82%AC', '10.1000/€'],
            ['10.1000/%F0%9F%98%80', '10.1000/😀'],
            ['10.1000/%EF%BF%BD', '10.1000/�'],
            ['10.1000/100%25', '10.1000/100%'],
            ['%31%30.1000/abc', '10.1000/abc'],
            ['10%2E1000%2Fabc', '10.1000/abc'],
            // decoded once only
            ['10.1000/a%252Fb', '10.1000/a%2fb'],
            ['10.1000/100%2541', '10.1000/100%41'],
            // literal `%` and malformed escapes are kept; valid escapes next to them are decoded
            ['10.1000/100%', '10.1000/100%'],
            ['10.1000/a%2', '10.1000/a%2'],
            ['10.1000/a%', '10.1000/a%'],
            ['10.1000/%%41', '10.1000/%a'],
            ['10.1000/%C3%A1%ZZ', '10.1000/á%zz'],
            ['10.1000/%G1', '10.1000/%g1'],
            // truncated sequences
            ['10.1000/%C3', '10.1000/%c3'],
            ['10.1000/%E2%82', '10.1000/%e2%82'],
            ['10.1000/%F0%9F%98', '10.1000/%f0%9f%98'],
            ['10.1000/%E2%82%C3%A1', '10.1000/%e2%82á'],
            ['10.1000/%E2%82%AC%E2%82', '10.1000/€%e2%82'],
            ['10.1000/%C3%41', '10.1000/%c3a'],
            // lone continuation byte, invalid lead bytes
            ['10.1000/%80', '10.1000/%80'],
            ['10.1000/%A1%41', '10.1000/%a1a'],
            ['10.1000/%FF', '10.1000/%ff'],
            ['10.1000/%F5%80%80%80', '10.1000/%f5%80%80%80'],
            // overlong encodings, UTF-16 surrogates, beyond U+10FFFF
            ['10.1000/%C0%80', '10.1000/%c0%80'],
            ['10.1000/%C1%81', '10.1000/%c1%81'],
            ['10.1000/%E0%80%80', '10.1000/%e0%80%80'],
            ['10.1000/%ED%A0%80', '10.1000/%ed%a0%80'],
            ['10.1000/%F4%90%80%80', '10.1000/%f4%90%80%80'],
        ])('decodes %p', (input, expected) => {
            expect(normalizeDoi(input)).toBe(expected);
        });

        it.each([
            ['10.1000/abc%00'],
            ['10.1000/abc%0A'],
            ['10.1000/a%09b'],
            ['10.1000/a%7Fb'],
            ['10.1000/a%C2%85b'],
            ['10.1000/a%C2%ADb'],
            ['10.1000/a%E2%80%8Bb'],
            ['10.1000/a%E2%80%A8b'],
            ['10.1000/a%EF%BB%BFb'],
            ['10.1000/a%EE%80%80b'],
        ])('returns null if an escape decodes to an invalid character %p', (input) => {
            expect(normalizeDoi(input)).toBeNull();
        });
    });

    describe('DOI start', () => {
        it.each([
            // the character right before `10.` must not be a digit or `.`, also after decoding
            ['210.1000/abc', null, null],
            ['010.1000/abc', null, null],
            ['x210.1000/abc', null, null],
            ['.10.1000/abc', null, null],
            ['1.10.1000/abc', null, null],
            ['v1.10.1000/abc', null, null],
            ['%3210.1000/abc', null, null],
            ['%2E10.1000/abc', null, '10.1000/abc'],
            ['%10.1000/abc', null, '10.1000/abc'],
            ['%2510.1000/abc', '10.1000/abc', null],
            ['%310.1000/abc', '10.1000/abc', null],
            ['%210.1000/abc', null, null],
            ['１10.1000/abc', '10.1000/abc', '10.1000/abc'],
            ['١10.1000/abc', '10.1000/abc', '10.1000/abc'],
            ['x10.1000/abc', '10.1000/abc', '10.1000/abc'],
            ['-10.1000/abc', '10.1000/abc', '10.1000/abc'],
        ])('%p yields %p, or %p with keepPercentEncoding', (input, decoded, kept) => {
            expect(normalizeDoi(input)).toBe(decoded);
            expect(normalizeDoi(input, { keepPercentEncoding: true })).toBe(kept);
        });

        it.each([
            ['10.1000/abc/10.2000/def', '10.1000/abc/10.2000/def'],
            ['10.1000/abc 10.2000/def', '10.1000/abc 10.2000/def'],
            ['10.1000/abc,10.2000/def', '10.1000/abc,10.2000/def'],
            ['https://example.com/10.1000/abc?doi=10.2000/def', '10.1000/abc?doi=10.2000/def'],
            ['210.1000/abc 10.2000/def', '10.2000/def'],
            ['https://doi.org/doiRA/10.1000/abc', '10.1000/abc'],
            ['10.1000.2000/abc', '10.1000.2000/abc'],
            ['https://example.com/10.1000.2000.3000/10.1000/abc', '10.1000/abc'],
        ])('uses the first valid start %p', (input, expected) => {
            expect(normalizeDoi(input)).toBe(expected);
        });

        // Known limitation: an earlier `10.<digits>/` or `10.<digits>.<digits>/` that is not part of a longer number
        // is taken as the DOI start. It cannot be told apart from a DOI.
        it.each([
            ['http://10.20.30/10.1000/abc', '10.20.30/10.1000/abc'],
            ['https://example.com/v10.2/10.1000/abc', '10.2/10.1000/abc'],
            ['https://example.com/api/10.1/10.1000/abc', '10.1/10.1000/abc'],
            ['https://example.com/release-10.4/10.1000/abc', '10.4/10.1000/abc'],
            ['https://example.com/a_10.4/10.1000/abc', '10.4/10.1000/abc'],
            ['https://example.com:10.1/x', '10.1/x'],
        ])('takes an earlier DOI-like segment as the start %p', (input, expected) => {
            expect(normalizeDoi(input)).toBe(expected);
        });
    });

    describe('suffix is never cleaned up', () => {
        it('keeps spaces (Zs) as-is - valid DOI characters (§4.3.1)', () => {
            expect(normalizeDoi('10.1000/a b')).toBe('10.1000/a b');
            expect(normalizeDoi('10.1000/a b')).toBe('10.1000/a b');
            expect(normalizeDoi('10.1000/a b　c')).toBe('10.1000/a b　c');
            expect(normalizeDoi('10.1000/a b')).not.toBe(normalizeDoi('10.1000/a b'));
        });

        it('never trims', () => {
            expect(normalizeDoi('10.1000/abc ')).toBe('10.1000/abc ');
            expect(normalizeDoi('10.1000/ ')).toBe('10.1000/ ');
            expect(normalizeDoi('10.1000/abc ')).toBe('10.1000/abc ');
            expect(normalizeDoi('see 10.1000/abc here')).toBe('10.1000/abc here');
            expect(normalizeDoi('﻿10.1000/abc')).toBe('10.1000/abc');
            expect(normalizeDoi('﻿10.1000/abc﻿')).toBeNull();
            expect(normalizeDoi('  10.1000/abc\t')).toBeNull();
        });

        it.each([
            ['10.1000/182?via=ihub', '10.1000/182?via=ihub'],
            ['https://doi.org/10.1000/abc?locatt=mode:legacy', '10.1000/abc?locatt=mode:legacy'],
            ['https://example.com/search?doi=10.1000%2Fabc&utm=1', '10.1000/abc&utm=1'],
            ['https://doi.org/10.1000/abc#section-1', '10.1000/abc#section-1'],
            ['https://example.com/files/10.1000/abc/fulltext.pdf', '10.1000/abc/fulltext.pdf'],
            ['10.1000/182.', '10.1000/182.'],
            ['(10.1000/182)', '10.1000/182)'],
            ['<10.1000/182>', '10.1000/182>'],
            ['"10.1000/182",', '10.1000/182",'],
            ['10.1000/a&amp;b', '10.1000/a&amp;b'],
            // `+` is a valid DOI character, not a form-encoded space
            ['https://example.com/?doi=10.1000/a+b', '10.1000/a+b'],
        ])('applies no URL, bracket or punctuation heuristics %p', (input, expected) => {
            expect(normalizeDoi(input)).toBe(expected);
        });

        it('lowercases only Basic Latin A-Z (§4.3.4)', () => {
            expect(normalizeDoi('10.1000/ABC-Ä')).toBe('10.1000/abc-Ä');
            expect(normalizeDoi('10.1000/ΣΑΣ')).toBe('10.1000/ΣΑΣ');
            expect(normalizeDoi('10.1000/K')).toBe('10.1000/K');
            expect(normalizeDoi('10.1000/İ')).toBe('10.1000/İ');
            expect(normalizeDoi('10.26321/Á')).not.toBe(normalizeDoi('10.26321/á'));
        });
    });

    describe('URLs', () => {
        it.each([
            ['https://link.springer.com/chapter/10.1007/978-3-030-12345-6_7', '10.1007/978-3-030-12345-6_7'],
            ['https://www.tandfonline.com/doi/abs/10.1080/14786435.2010.123456', '10.1080/14786435.2010.123456'],
            ['https://journals.sagepub.com/doi/pdf/10.1177/0956797620123456', '10.1177/0956797620123456'],
            ['https://dl.acm.org/doi/10.1145/3290605.3300233', '10.1145/3290605.3300233'],
            ['https://iopscience.iop.org/article/10.1088/1742-6596/1234/1/012345', '10.1088/1742-6596/1234/1/012345'],
            ['https://www.jstor.org/stable/10.2307/1234567', '10.2307/1234567'],
            [
                'https://www.biorxiv.org/content/10.1101/2020.01.01.123456v1.full.pdf',
                '10.1101/2020.01.01.123456v1.full.pdf',
            ],
            [
                'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0230000',
                '10.1371/journal.pone.0230000',
            ],
            ['https://api.crossref.org/works/10.1000%2Fabc', '10.1000/abc'],
            ['https://www.semanticscholar.org/search?q=10.1000%2FABC', '10.1000/abc'],
            ['https://doi-org.proxy.uni.edu/10.1000/abc', '10.1000/abc'],
            ['http://localhost:8080/10.1000/abc', '10.1000/abc'],
            ['http://10.0.0.1:8080/10.1000/abc', '10.1000/abc'],
            ['http://172.16.10.1/10.1000/abc', '10.1000/abc'],
            ['https://user:10.1@host/10.1000/abc', '10.1000/abc'],
            ['https://example.com/:10.1000/abc', '10.1000/abc'],
            ['https://proxy.uni.edu/login?url=https%3A%2F%2Fdoi.org%2F10.1000%2Fabc', '10.1000/abc'],
            ['https://proxy.uni.edu/login?url=https%3A%2F%2Fdoi.org%2F10.1000%2Fa%2520b', '10.1000/a%20b'],
        ])('extracts DOI from %p', (input, expected) => {
            expect(normalizeDoi(input)).toBe(expected);
        });

        it.each([
            ['https://www.sciencedirect.com/science/article/pii/S0140673620301835'],
            ['https://academic.oup.com/nar/article/48/D1/D1/5695332'],
            ['https://www.nature.com/articles/s41586-020-2012-7'],
            ['https://arxiv.org/abs/2001.12345'],
            ['https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123/'],
            ['https://www.cell.com/cell/fulltext/S0092-8674(20)30123-4'],
            ['https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(20)30183-5/fulltext'],
            ['https://example.com/page?id=12310.1000/abc'],
            ['https://example.com/?x=1&doi=10.1000%252Fabc'],
            ['https://example.com/10/abcde'],
        ])('returns null for URL without DOI %p', (input) => {
            for (const options of OPTION_SETS) {
                expect(normalizeDoi(input, options)).toBeNull();
            }
        });
    });

    describe('shortDOI (§6.5)', () => {
        /** [input, code as written] */
        const SHORT_DOIS: [string, string][] = [
            ['10/abcde', 'abcde'],
            ['10/AbCdE', 'AbCdE'],
            ['10/12345', '12345'],
            ['doi:10/abcde', 'abcde'],
            ['DOI: 10/abcde', 'abcde'],
            ['https://doi.org/10/abcde', 'abcde'],
            ['https://dx.doi.org/10/abcde', 'abcde'],
            ['https://www.doi.org/10/abcde', 'abcde'],
            ['doi.org/10/abcde', 'abcde'],
            ['https://doi.org/abcde', 'abcde'],
            ['http://doi.org/ABCDE', 'ABCDE'],
            ['HTTPS://WWW.DOI.ORG/AbCdE', 'AbCdE'],
            ['www.doi.org/abcde', 'abcde'],
            ['doi.org/abcde', 'abcde'],
            ['doi:https://doi.org/abcde', 'abcde'],
        ];

        it('is accepted plain or percent-encoded, with allowShortDoi only', () => {
            const encoders = SINGLE_ENCODERS.filter(([name]) => name !== 'whole encodeURI');
            const cases = SHORT_DOIS.flatMap(([plain, code]) =>
                encoders.flatMap(([, encoder]) => {
                    const { input, kept } = encoder('', plain);
                    return OPTION_SETS.map((options) => {
                        const found = options.allowShortDoi && (!options.keepPercentEncoding || kept === plain);
                        const expected = found ? `10/${options.keepCasing ? code : lowercaseBasicLatin(code)}` : null;
                        return { group: 'short' as const, input, options, expected };
                    });
                }),
            );
            expect(mismatches(cases)).toEqual([]);
        });

        it.each([
            ['abcde'],
            ['10/'],
            ['10/abc de'],
            ['10/abc-de'],
            ['10/abc.de'],
            ['10/abcdé'],
            [' 10/abcde'],
            ['10/abcde '],
            ['10/abcde\n'],
            ['see 10/abcde'],
            ['doi: 10/abcde '],
            ['https://doi.org/'],
            ['https://doi.org/10/'],
            ['https://doi.org/abc/def'],
            ['https://doi.org/abcde?x=1'],
            ['https://dx.www.doi.org/abcde'],
            ['ftp://doi.org/abcde'],
            ['https://example.com/abcde'],
            ['https://example.com/2020/10/news'],
            ['https://doi.org.evil.com/abcde'],
            ['https://evil.com/doi.org/abcde'],
        ])('rejects non-shortDOI %p with any options', (input) => {
            for (const options of OPTION_SETS) {
                expect(normalizeDoi(input, options)).toBeNull();
            }
        });

        it('prefers a full DOI over shortDOI', () => {
            expect(normalizeDoi('https://doi.org/10.1000/abc', { allowShortDoi: true })).toBe('10.1000/abc');
            expect(normalizeDoi('10/10.1000/abc', { allowShortDoi: true })).toBe('10.1000/abc');
        });
    });

    it.each([
        [''],
        [' '],
        ['\n\t'],
        ['%'],
        ['%%%'],
        ['doi:'],
        ['https://doi.org/'],
        ['10.'],
        ['10'],
        ['abc'],
        ['doi'],
        ['not a doi'],
        ['urn:doi:10.123:456'],
        ['https://doi.org/urn:doi:10.123'],
    ])('rejects input without a DOI %p', (input) => {
        for (const options of OPTION_SETS) {
            expect(normalizeDoi(input, options)).toBeNull();
        }
    });

    it('does not depend on prior calls (no regex lastIndex leakage)', () => {
        for (let i = 0; i < 5; i++) {
            expect(normalizeDoi('10.1000/%C3%A1%ZZ')).toBe('10.1000/á%zz');
            expect(normalizeDoi('10/abcde', { allowShortDoi: true })).toBe('10/abcde');
            expect(normalizeDoi('210.1000/abc')).toBeNull();
        }
    });

    it('handles very long input quickly', () => {
        const started = performance.now();
        expect(normalizeDoi(`${'x '.repeat(50_000)}10.1000/182`)).toBe('10.1000/182');
        expect(normalizeDoi('10.'.repeat(50_000))).toBeNull();
        expect(normalizeDoi('%25'.repeat(20_000))).toBeNull();
        expect(normalizeDoi(`${'%E2%82'.repeat(20_000)} 10.1000/182`)).toBe('10.1000/182');
        expect(normalizeDoi(`10.1000/${'%C3%A1'.repeat(20_000)}`)).toBe(`10.1000/${'á'.repeat(20_000)}`);
        expect(normalizeDoi(`10.1000/${'a'.repeat(100_000)}`)).toBe(`10.1000/${'a'.repeat(100_000)}`);
        expect(normalizeDoi(`10.1000/${'a'.repeat(100_000)}\n`)).toBeNull();
        expect(performance.now() - started).toBeLessThan(5_000);
    });
});
