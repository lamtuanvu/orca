# Sandboxed panels, native reviews, and browser authorization

This experimental desktop contract is introduced by
[Orca PR #1](https://github.com/lamtuanvu/orca/pull/1) in the `lamtuanvu/orca` fork.
It is not available in stock Orca. The hardened contract intentionally replaces
that PR's initial unrestricted own-command and external-browser interfaces.

## Trust boundary

Panels remain opaque-origin sandboxed iframes with `connect-src 'none'` and blocked
navigation. They receive neither Electron nor filesystem APIs. An approved plugin
worker is a trusted Node process with filesystem, network, and process access; it
is **not an OS sandbox**. These changes limit what a panel can ask Orca to dispatch.
They cannot prevent a malicious worker from using Node directly.

The host derives plugin identity from the live panel/worker connection. A payload
cannot select a different plugin. Consent changes when panel contracts or review
provider mappings change. Re-enable updated plugins through the normal consent UI.
Refresh, activation reconciliation, and disposal invalidate active review sessions
and browser authorization handles. Reopen reviews or restart sign-in afterward.

## Explicit panel commands

A declared worker command is private to the worker/host command machinery unless
it has a `panel` contract. Here is a manifest contribution (merge it into the
plugin's `contributes.commands`):

```json
{
  "id": "cvhub.authStatus",
  "title": "CV Hub sign-in status",
  "panel": {
    "effect": "read",
    "input": { "type": "object", "properties": {}, "additionalProperties": false },
    "output": {
      "type": "object",
      "properties": { "state": { "type": "string", "maxLength": 32 } },
      "required": ["state"],
      "additionalProperties": false
    }
  }
}
```

Declare capability `{ "kind": "commands:invoke-own" }`. Register the implementation
with `orca.commands.register('cvhub.authStatus', handler)` as usual. From the
panel, send the existing `orca-panel-action` message with action
`commands.invokeOwn` and params `{ commandId: 'cvhub.authStatus', args: {} }`.
Only opted-in commands are dispatched. Built-in `action` aliases cannot opt in.
The host validates input before execution and output before replying to the panel.
Omitted args default to `{}`; explicit `null` stays `null`.

`effect: "read" | "write"` describes the operation for consent fingerprinting; it
is not a side-effect detector, extra confirmation, or a substitute for server ACLs.
An exposed command must return a deliberately sanitized view model, never tokens,
raw HTTP errors, arbitrary method results, or private review content. A worker
wrapper that forwards private loaders would defeat that plugin's intended boundary.

The schema dialect is bounded JSON, not full JSON Schema:

| Type | Supported keywords (besides `type`, optional `nullable`) |
| --- | --- |
| object | `properties`, `required`, mandatory `additionalProperties: false` |
| array | `items`, optional `maxItems` (default and maximum 2000) |
| string | `minLength`, `maxLength` (default and maximum 49152), string `enum` |
| number / integer | `minimum`, `maximum` |
| boolean / null | none |

Unknown or inapplicable keywords are rejected. No refs, patterns, executable
validators, unions, coercion, or open dictionaries. Nesting is limited to eight
levels below the root, objects to 64 properties, enum to 64 strings of at most
512 characters, and serialized schema definitions to 16384 characters. Reserved
property names `__proto__`, `constructor`, and `prototype` are rejected. Panel
args/results additionally have a 48 KiB UTF-8 JSON limit; paginate lists.

## Native review providers

Declare `{ "kind": "diffs:open" }`. Register the two loaders as ordinary worker
commands **without** `panel` contracts. Declare their fixed mapping:

```json
{
  "id": "cvhub.pullRequest",
  "title": "CV Hub pull request",
  "snapshotCommand": "cvhub.getReview",
  "contentCommand": "cvhub.readReviewFile",
  "input": {
    "type": "object",
    "properties": {
      "owner": { "type": "string", "minLength": 1, "maxLength": 256 },
      "repo": { "type": "string", "minLength": 1, "maxLength": 256 },
      "number": { "type": "integer", "minimum": 1 }
    },
    "required": ["owner", "repo", "number"],
    "additionalProperties": false
  }
}
```

Place this entry under `contributes.reviewProviders` (maximum 32). A panel opens
it with action `diffs.openReview` and params:

```js
{ providerId: 'cvhub.pullRequest', args: { owner: 'acme', repo: 'demo', number: 7 } }
```

The host resolves the declared provider and validates input **before** invoking
the snapshot command. Caller-selected `commandId` or `contentCommandId` fields
are rejected. The panel receives only `{ reviewId, revision }`; the trusted Orca
renderer receives the metadata/context and renders the native read-only DiffViewer.
Review IDs are bound to the renderer owner and plugin generation. The host permits
10 reviews per owner and four concurrent file reads per review.

Snapshot loader input is the validated provider args. Its exact result shape is:

```js
{
  title: 'acme/demo #7',
  revision: '<immutable head SHA>',
  context: { /* worker-defined JSON for immutable blob reads; never credentials */ },
  files: [{ path: 'src/a.ts', status: 'modified', additions: 1, deletions: 1 }]
}
```

`oldPath` and `binary` are optional file fields. Status is one of `added`, `deleted`,
`modified`, `renamed`, `copied`. Maximums: 2000 files, 1 MiB total metadata,
16 KiB context, title/revision 512 characters, paths 4096 characters.

The content loader receives `{ context, file }`, selected by the host from that
snapshot, and returns `{ original, modified }`. Each side has one of these forms:

```js
{ kind: 'text', content: '...' } // at most 2 MiB UTF-8
{ kind: 'absent' }
{ kind: 'binary', size: 123 } // size optional
{ kind: 'limited', reason: 'File too large', size: 123 } // size optional
{ kind: 'error', code: 'not_found', message: 'File unavailable' }
```

Objects are strict: do not return extra fields. Keep snapshot context immutable:
original blobs come from the merge base and modified blobs from the inspected
head. Renames use `oldPath` for the original. The provider remains responsible
for read-only loader behavior; the host prevents a panel selecting another handler,
not side effects inside trusted plugin code.

This version provides a desktop dialog with file selection and split/unified
Monaco diffs. It does not add editor tabs, inline threads, merging, or remote web
review support. Unsupported clients fail closed; do not fall back to passing file
contents through panel commands.

## Worker-only browser authorization

Declare `{ "kind": "browser:authorize" }`. The old `browser.openExternal` method
and `browser:open-external` capability are removed. Panels cannot call these methods.
Workers use the existing `orca.host.call(method, params)` interface:

```js
const { attemptId, expiresAt } = await orca.host.call('browser.createAuthorization', {
  serverOrigin: 'https://api.example.com',
  verificationUrl: 'https://app.example.com/device?user_code=ABCD-EFGH',
  expiresIn: 600
})
const { opened } = await orca.host.call('browser.openAuthorization', { attemptId })
await orca.host.call('browser.cancelAuthorization', { attemptId }) // { ok: true }
```

Create registers an attempt; it does not perform OAuth. `expiresAt` is Unix time
in milliseconds. `expiresIn` is an integer from 1 to 900 seconds; use the remaining
device-flow lifetime, capped at 900. `serverOrigin` must be an exact origin without
a trailing slash or path. URLs must be HTTPS, except HTTP on `localhost`,
`127.0.0.1`, or `[::1]` for local development. Credentials in URLs are rejected.
The URL maximum is 2048 characters. API and verification origins may differ.
The worker must validate the verification destination against its configured
service/discovery; Orca does not discover or attest an OAuth server.

Open presents a native confirmation naming the plugin and displaying the server,
destination origin, and full verification URL. Cancel is the default. Only the
stored URL can open; handles are scoped to the originating plugin, single-use even
after denial, and checked again after confirmation for expiry, cancellation, and
revocation. Only one confirmation may be pending globally. Creation is limited to
one attempt per plugin per ten seconds and one live attempt per plugin. Global
attempt/rate-tracking capacity is 128. Cancel on completion, denial, failure, or
restart. Cancel is idempotent and does not dismiss an already visible native dialog;
accepting that stale dialog cannot open its URL.

Run sign-in as a worker state machine. Panel commands start/poll/cancel short
operations; do not keep a panel command waiting for device authorization or native
confirmation. Worker command invocations have a 30-second timeout. Show the user code and a copyable
verification URL for manual navigation. Never expose device codes, access/refresh
tokens, authorization headers, or host attempt IDs to the iframe.

OAuth registration, device-code requests, polling/backoff, expiry, refresh rotation,
revocation, encrypted token storage, and authenticated REST/MCP calls belong to the
service integration worker/backend. The host does not need CV Hub-specific routes,
client secrets, or account knowledge.
