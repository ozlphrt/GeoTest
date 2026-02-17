---
description: Bump version, save changes, and deploy to GitHub
---

1. Read `app/package.json` to identify the current version number.
2. Increment the patch version (e.g. 0.1.3 -> 0.1.4).
3. Update `app/package.json` with the new version.

// turbo
4. Run `git add .`

5. Run `git commit -m "Release v[NEW_VERSION]"` (replace [NEW_VERSION] with the actual new version string).

// turbo
6. Run `git push`

7. Notify the user that the deployment has been pushed and they can refresh the external URL shortly.
