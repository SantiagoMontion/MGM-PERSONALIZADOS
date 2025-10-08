# Preview environment variables

The Vercel preview for the API uses `ALLOWED_ORIGINS` to augment the shared
CORS helper (`lib/cors.js`). Make sure the list contains the current front-end
preview domain **without** a trailing slash. For this branch the value is:

```
ALLOWED_ORIGINS=https://mgm-front-git-work-gpt-5-codex.vercel.app
```

If a new preview URL is generated, replace the domain above and redeploy the
API so that the front can call endpoints such as `/api/publish-product`.
