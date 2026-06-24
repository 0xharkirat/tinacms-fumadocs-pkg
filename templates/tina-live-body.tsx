'use client';

// Thin CLIENT boundary around the adapter's <TinaLiveBody>. It exists because a
// Server Component (the docs page) cannot pass a FUNCTION prop (`getComponents`)
// to a Client Component — React throws "Functions cannot be passed directly to
// Client Components". Here, on the client side, we bind `getComponents` to your
// app's REAL Fumadocs component map (getMDXComponents) and forward only
// serializable props + children from the server.
//
// `children` is the real server-rendered <MDX/>, shown outside the admin iframe
// and until the first live compile — passing a React node across the boundary is
// allowed (it's not a function).

import { TinaLiveBody } from 'tinacms-fumadocs-pkg';
import { getMDXComponents } from '@/components/mdx';

export function TinaLiveBodyClient({
  formId,
  bodyField,
  children,
}: {
  formId: string;
  bodyField?: string;
  children: React.ReactNode;
}) {
  return (
    <TinaLiveBody
      formId={formId}
      bodyField={bodyField}
      // The REAL Fumadocs components — bound on the client, so the live preview
      // mounts actual <Card>/<Tabs>/… (not placeholders).
      getComponents={() => getMDXComponents()}
    >
      {children}
    </TinaLiveBody>
  );
}
