// Copyright 2026 Martin Winkler
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const pkg = require('@smart-science/sdoi');

assert.equal(typeof pkg.doiToSid, 'function');
assert.equal(typeof pkg.createDoiToSid, 'function');
assert.equal(typeof pkg.createDoiToSidAsync, 'function');
assert.equal(typeof pkg.normalizeDoi, 'function');
assert.equal(typeof pkg.format, 'function');
assert.equal(typeof pkg.fromBytes, 'function');
assert.equal(typeof pkg.isFormattedSID, 'function');
assert.equal(typeof pkg.isSID, 'function');
assert.equal(typeof pkg.parse, 'function');
assert.equal(typeof pkg.verify, 'function');

const expected = 'N3C77HSZ53MZRTE0S9Q7';
assert.equal(pkg.doiToSid('https://doi.org/10.1000/ABC'), expected);
assert.equal(pkg.createDoiToSid((text) => createHash('sha256').update(text).digest())('10.1000/abc'), expected);
pkg.createDoiToSidAsync((text) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
    .then((derive) => derive('10.1000/abc'))
    .then((sid) => assert.equal(sid, expected));
assert.equal(pkg.doiToSid('invalid'), null);
assert.equal(pkg.doiToSid('10/abcde'), null);
assert.throws(() => pkg.createDoiToSid((text) => createHash('sha1').update(text).digest()), TypeError);
