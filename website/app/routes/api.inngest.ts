import { InngestCommHandler } from 'inngest';
import { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { InngestServer } from '~/domain/contracts/inngest';
import { buildInngestFunctions } from '~/infrastructure/inngest/functions.server';

type Deps = {
  services: {
    inngestServer: InngestServer;
    inngestFunctions: ReturnType<typeof buildInngestFunctions>;
  };
};
const buildHandler = (context: Deps) => {
  const handler = new InngestCommHandler({
    frameworkName: 'remix',
    client: context.services.inngestServer.inngest,
    functions: context.services.inngestFunctions,
    handler: ({ request: req }: { request: Request; context?: unknown }) => {
      return {
        body: () => req.json(),
        headers: (key) => req.headers.get(key),
        method: () => req.method,
        url: () => new URL(req.url, `https://${req.headers.get('host') || ''}`),
        transformResponse: ({ body, status, headers }) => new Response(body, { status, headers }),
        transformStreamingResponse: ({ body, status, headers }) => new Response(body, { status, headers }),
      };
    },
  });
  return handler.createHandler();
};

export async function loader({ context }: LoaderFunctionArgs) {
  return buildHandler(context);
}

export async function action({ context }: ActionFunctionArgs) {
  return buildHandler(context);
}
