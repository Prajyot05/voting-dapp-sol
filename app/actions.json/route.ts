// =============================================================================
// Solana Actions — actions.json discovery endpoint
// =============================================================================
//
// Blink clients (Phantom, Dialect, Twitter/X) look for a file at
//   https://<your-domain>/actions.json
// before they load any blink card from your domain. This endpoint returns
// a mapping of URL patterns to Action API paths so clients know which routes
// on your site are Actions.
//
// Spec: https://docs.dialect.to/documentation/actions/specification/actions-json
// =============================================================================

import { ACTIONS_CORS_HEADERS, ActionsJson } from "@solana/actions";

export const GET = async () => {
  const payload: ActionsJson = {
    rules: [
      {
        // Any request to /api/vote (with any query params) is an Action
        pathPattern: "/api/vote**",
        apiPath: "/api/vote",
      },
    ],
  };

  return Response.json(payload, { headers: ACTIONS_CORS_HEADERS });
};

// Mirror GET so preflight CORS requests are handled correctly
export const OPTIONS = GET;
