// Copyright 2026 Martin Winkler
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import {
    createDoiToSid,
    createDoiToSidAsync,
    type DoiToSid,
    type DoiToSidAsync,
    doiToSid,
    type FormattedSID,
    format,
    type NormalizeDoiOptions,
    normalizeDoi,
    type Sha256,
    type Sha256Async,
    type SID,
    type SidResult,
} from '../../src/index.js';

const sid: SID | null = doiToSid('10.1000/182');
const formatted: SidResult<FormattedSID> = format(sid);

// node:crypto returns a Buffer, which is a Uint8Array
const nodeSha256: Sha256 = (text) => createHash('sha256').update(text).digest();
const nodeDoiToSid: DoiToSid = createDoiToSid(nodeSha256);
const nodeSid: SID | null = nodeDoiToSid('10.1000/182');

// a synchronous SHA-256 may also return an ArrayBuffer
const bufferSha256: Sha256 = (text) => new Uint8Array(nodeSha256(text)).buffer;
const bufferDoiToSid: DoiToSid = createDoiToSid(bufferSha256);

// Web Crypto resolves to an ArrayBuffer
const webSha256: Sha256Async = (text) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
const webDoiToSid: DoiToSidAsync = await createDoiToSidAsync(webSha256);
const webSid: Promise<SID | null> = webDoiToSid('10.1000/182');
const pending: Promise<DoiToSidAsync> = createDoiToSidAsync(async (text) => nodeSha256(text));

// `doiToSid` itself fits `DoiToSid`
const main: DoiToSid = doiToSid;

// options stay available for validation-only use
const options: NormalizeDoiOptions = { allowShortDoi: true, keepCasing: true, keepPercentEncoding: true };
const doi: string | null = normalizeDoi('10.1000/182', options);

// @ts-expect-error SID is not a plain string
const notSid: SID = '10.1000/182';
// @ts-expect-error result may be null
const notNull: SID = doiToSid('10.1000/182');
// @ts-expect-error async SHA-256 is not accepted by the sync factory
createDoiToSid(webSha256);
// @ts-expect-error sync SHA-256 is not accepted by the async factory
createDoiToSidAsync(nodeSha256);
// @ts-expect-error SHA-256 is required
createDoiToSid();
// @ts-expect-error async factory resolves to the function, it is not the function
const notAwaited: DoiToSidAsync = createDoiToSidAsync(webSha256);
// @ts-expect-error doiToSid takes no options
doiToSid('10.1000/182', { keepCasing: true });
// @ts-expect-error created functions take no options
nodeDoiToSid('10.1000/182', { keepPercentEncoding: true });

void [sid, formatted, nodeSid, bufferDoiToSid, webSid, pending, main, doi, notSid, notNull, notAwaited];
