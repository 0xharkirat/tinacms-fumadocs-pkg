// Server-side helper. Runs inside the RSC page, renders nothing.
//
// Turns a TinaCMS client query result into everything @tinacms/bridge needs:
//   - the stable form `id` (hash of {query, variables}) the admin uses,
//   - `_content_source` metadata stamped on every node (so tinaField() works),
//   - a serialisable payload for the hidden <div data-tina-form> the bridge reads.
//
// Generic on purpose: you pass the result of YOUR generated client
// (e.g. `await client.queries.docs({ relativePath })`). This package never
// imports your project's generated client or types.

import { addMetadata, hashFromQuery } from '@tinacms/bridge/metadata';

export interface TinaQueryResult {
  query: string;
  variables: object;
  data: object;
}

export interface PreparedTinaForm<T = unknown> {
  /** Query data with `_content_source` stamped — feed to `tinaField()`. */
  data: T;
  /** Stable form id (hash of {query, variables}); matches the admin. */
  id: string;
  /** Serialisable payload for the hidden `<div data-tina-form>`. */
  payload: { id: string; query: string; variables: object; data: object };
}

export function prepareTinaForm<T = unknown>(
  res: TinaQueryResult,
): PreparedTinaForm<T> {
  const { query, variables, data } = res;
  const id = hashFromQuery(JSON.stringify({ query, variables }));
  const stamped = addMetadata(id, data) as T;
  return { data: stamped, id, payload: { id, query, variables, data } };
}
