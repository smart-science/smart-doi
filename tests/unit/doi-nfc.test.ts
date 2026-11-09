// Copyright 2026 Martin Winkler
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'bun:test';
import { type NormalizeDoiOptions, normalizeDoi } from '../../src/doi.js';

/*
 * Unicode normalization (NFC) of the DOI suffix.
 *
 * Every string is written with `\u` escapes, so the test data does not depend on how an editor, git or the file system
 * stores the file. Expected values are fixed literals, never computed with `String.prototype.normalize()`.
 * All code points were assigned in Unicode 3.2 or earlier, and Unicode guarantees that the NFC form of assigned
 * characters never changes in later versions.
 */

const PREFIX = '10.1000/';

/** [suffix as given, normalized suffix by default, normalized suffix with `keepCasing`] */
type Row = [input: string, expected: string, expectedKeepCasing: string];

function same(input: string, expected: string): Row {
    return [input, expected, expected];
}

/** Spellings of one character sequence: composed, decomposed, partly composed, marks in another order. */
const EQUIVALENT: Row[] = [
    // Latin, one mark
    same('ä', 'ä'),
    same('ä', 'ä'),
    same('é', 'é'),
    same('é', 'é'),
    same('ñ', 'ñ'),
    same('ñ', 'ñ'),
    // uppercase non-ASCII result keeps its case: `A` + U+0308 is the same character as U+00C4
    same('Ä', 'Ä'),
    same('Ä', 'Ä'),
    same('É', 'É'),
    same('É', 'É'),
    same('İ', 'İ'),
    same('İ', 'İ'),
    // Latin, two marks: every order and every partly composed spelling
    same('ệ', 'ệ'),
    same('ệ', 'ệ'),
    same('ệ', 'ệ'),
    same('ệ', 'ệ'),
    same('ệ', 'ệ'),
    // two marks without a fully composed form: marks are reordered, the base composes with the first
    same('ạ̈', 'ạ̈'),
    same('ạ̈', 'ạ̈'),
    same('ạ̈', 'ạ̈'),
    same('ạ̈', 'ạ̈'),
    // Hangul: jamo, syllable + final jamo, syllable
    same('각', '각'),
    same('각', '각'),
    same('각', '각'),
    // Hiragana, Greek, Cyrillic, Arabic, Devanagari
    same('が', 'が'),
    same('が', 'が'),
    same('ά', 'ά'),
    same('ά', 'ά'),
    same('ά', 'ά'),
    same('й', 'й'),
    same('й', 'й'),
    same('آ', 'آ'),
    same('آ', 'آ'),
    same('ऩ', 'ऩ'),
    same('ऩ', 'ऩ'),
];

/** Characters that NFC replaces by one other character. */
const SINGLETONS: Row[] = [
    // Kelvin sign becomes Basic Latin `K`, which is then lowercased
    ['K', 'k', 'K'],
    ['K', 'k', 'K'],
    // Angstrom sign, Ohm sign, Greek question mark, combining grave tone mark, CJK compatibility ideograph
    same('Å', 'Å'),
    same('Å', 'Å'),
    same('Ω', 'Ω'),
    same('Ω', 'Ω'),
    same(';', ';'),
    same('à', 'à'),
    same('豈', '豈'),
];

/** Lowercase letter + mark has a composed form, uppercase letter + mark has none: NFC must run again after lowercasing. */
const COMPOSED_AFTER_LOWERCASING: Row[] = [
    ['H̱', 'ẖ', 'H̱'],
    same('ẖ', 'ẖ'),
    same('ẖ', 'ẖ'),
    ['J̌', 'ǰ', 'J̌'],
    same('ǰ', 'ǰ'),
    ['T̈', 'ẗ', 'T̈'],
    same('ẗ', 'ẗ'),
    ['W̊', 'ẘ', 'W̊'],
    same('ẘ', 'ẘ'),
    ['Y̊', 'ẙ', 'Y̊'],
    same('ẙ', 'ẙ'),
];

/** Composition exclusions: the composed character is replaced by its decomposed form. */
const EXCLUSIONS: Row[] = [
    same('क़', 'क़'),
    same('क़', 'क़'),
    same('יִ', 'יִ'),
    same('יִ', 'יִ'),
    same('⫝̸', '⫝̸'),
    same('⫝̸', '⫝̸'),
];

/** Not changed: compatibility characters (NFC is not NFKC), marks without a composed form, spaces. */
const UNCHANGED: Row[] = [
    same('ﬁ', 'ﬁ'),
    same('Ａ', 'Ａ'),
    same('ａ', 'ａ'),
    same('²', '²'),
    same('①', '①'),
    same('½', '½'),
    same('ß', 'ß'),
    same('a b', 'a b'),
    same('x́', 'x́'),
    same('i̇', 'i̇'),
    same('́a', '́a'),
    same('̈', '̈'),
    same('a/̈b', 'a/̈b'),
];

/** Several rules in one suffix. */
const MIXED: Row[] = [
    ['Café-ÅB', 'café-Åb', 'Café-ÅB'],
    ['Café-ÅB', 'café-Åb', 'Café-ÅB'],
    ['KH̱/Ệ', 'kẖ/Ệ', 'KH̱/Ệ'],
    ['äöü', 'äöü', 'äöü'],
];

const ROWS: Row[] = [
    ...EQUIVALENT,
    ...SINGLETONS,
    ...COMPOSED_AFTER_LOWERCASING,
    ...EXCLUSIONS,
    ...UNCHANGED,
    ...MIXED,
];

/** Text before the DOI; dropped. */
const CONTEXTS = ['', 'doi:', 'https://doi.org/', 'see ', 'é '];

function escapeEveryByte(text: string, upperCaseHex: boolean): string {
    return Array.from(new TextEncoder().encode(text), (byte) => {
        const hex = byte.toString(16).padStart(2, '0');
        return `%${upperCaseHex ? hex.toUpperCase() : hex}`;
    }).join('');
}

function lowercaseBasicLatin(text: string): string {
    return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

function codePoints(text: string | null): string {
    return text === null ? 'null' : Array.from(text, (char) => (char.codePointAt(0) ?? 0).toString(16)).join(' ');
}

/** Compares by code points, so a failure shows the exact sequence instead of two strings that look alike. */
function expectDoi(input: string, options: NormalizeDoiOptions, expected: string | null): void {
    const actual = normalizeDoi(input, options);
    if (actual !== expected) {
        throw new Error(
            `normalizeDoi(${codePoints(input)}, ${JSON.stringify(options)}): expected ${codePoints(expected)}, got ${codePoints(actual)}`,
        );
    }
    expect(actual).toBe(expected);
}

describe('normalizeDoi: Unicode normalization (NFC)', () => {
    it('has test data', () => {
        expect(ROWS.length).toBeGreaterThan(70);
    });

    it('normalizes every spelling to the same fixed DOI, in any context', () => {
        for (const [input, expected, expectedKeepCasing] of ROWS) {
            for (const context of CONTEXTS) {
                for (const allowShortDoi of [false, true]) {
                    expectDoi(context + PREFIX + input, { allowShortDoi }, PREFIX + expected);
                    expectDoi(
                        context + PREFIX + input,
                        { allowShortDoi, keepCasing: true },
                        PREFIX + expectedKeepCasing,
                    );
                }
            }
        }
    });

    it('normalizes percent-encoded spellings like plain ones', () => {
        for (const [input, expected, expectedKeepCasing] of ROWS) {
            for (const upperCaseHex of [false, true]) {
                const encodedSuffix = PREFIX + escapeEveryByte(input, upperCaseHex);
                const encodedWhole = escapeEveryByte(`https://doi.org/${PREFIX}${input}`, upperCaseHex);
                for (const encoded of [encodedSuffix, encodedWhole]) {
                    expectDoi(encoded, {}, PREFIX + expected);
                    expectDoi(encoded, { keepCasing: true }, PREFIX + expectedKeepCasing);
                }
            }
        }
    });

    it('normalizes plain text with keepPercentEncoding, but leaves kept escapes as literal text', () => {
        for (const [input, expected, expectedKeepCasing] of ROWS) {
            expectDoi(PREFIX + input, { keepPercentEncoding: true }, PREFIX + expected);
            expectDoi(PREFIX + input, { keepPercentEncoding: true, keepCasing: true }, PREFIX + expectedKeepCasing);

            const encoded = PREFIX + escapeEveryByte(input, true);
            expectDoi(encoded, { keepPercentEncoding: true }, lowercaseBasicLatin(encoded));
            expectDoi(encoded, { keepPercentEncoding: true, keepCasing: true }, encoded);
        }
    });

    it('returns a DOI that stays unchanged when normalized again', () => {
        for (const [, expected, expectedKeepCasing] of ROWS) {
            expectDoi(PREFIX + expected, {}, PREFIX + expected);
            expectDoi(PREFIX + expected, { keepCasing: true }, PREFIX + expected);
            expectDoi(PREFIX + expectedKeepCasing, { keepCasing: true }, PREFIX + expectedKeepCasing);
            expectDoi(PREFIX + expectedKeepCasing, {}, PREFIX + expected);
        }
    });

    it('yields one DOI per group of equivalent spellings', () => {
        const groups: string[][] = [
            ['ä', 'ä'],
            ['Ä', 'Ä'],
            ['ệ', 'ệ', 'ệ', 'ệ', 'ệ'],
            ['ạ̈', 'ạ̈', 'ạ̈', 'ạ̈'],
            ['각', '각', '각'],
            ['ά', 'ά', 'ά'],
            ['K', 'K', 'k'],
            ['Å', 'Å', 'Å'],
            ['H̱', 'ẖ', 'ẖ'],
            ['क़', 'क़'],
        ];
        const results = groups.map((group) => new Set(group.map((suffix) => normalizeDoi(PREFIX + suffix))));
        for (const result of results) {
            expect(result.size).toBe(1);
            expect(result.has(null)).toBe(false);
        }
        // different groups stay different DOIs
        expect(new Set(results.flatMap((result) => [...result])).size).toBe(groups.length);
    });

    it('keeps characters apart that only look alike or differ in non-ASCII case', () => {
        const distinct = [
            'ä', // a with diaeresis
            'Ä', // A with diaeresis
            'a', // plain a
            'ａ', // fullwidth a
            'а', // Cyrillic a
            'α', // Greek alpha
            'ﬁ', // fi ligature
            'fi',
            '²', // superscript two
            '2',
        ];
        const results = new Set(distinct.map((suffix) => normalizeDoi(PREFIX + suffix)));
        expect(results.size).toBe(distinct.length);
    });

    it('does not make an invalid DOI valid', () => {
        for (const suffix of ['a​̈', 'ä‍', 'ä\n', '\ud800̈', 'ä﻿', 'a­́']) {
            expectDoi(PREFIX + suffix, {}, null);
            expectDoi(PREFIX + suffix, { keepCasing: true }, null);
        }
    });

    it('does not move the DOI start', () => {
        // a mark after the text before the DOI belongs to that text
        expectDoi('doï:10.1000/abc', {}, '10.1000/abc');
        // a mark inside the prefix breaks the prefix
        expectDoi('10.1000̈/abc', {}, null);
        expectDoi('10̈.1000/abc', {}, null);
        // shortDOI codes are ASCII only
        expectDoi('10/abcdë', { allowShortDoi: true }, null);
    });

    it('handles long sequences', () => {
        expectDoi(`${PREFIX}${'ä'.repeat(20_000)}`, {}, `${PREFIX}${'ä'.repeat(20_000)}`);
        expectDoi(`${PREFIX}a${'̈'.repeat(20_000)}`, {}, `${PREFIX}ä${'̈'.repeat(19_999)}`);
    });
});
