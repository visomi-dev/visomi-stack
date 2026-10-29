# Installed skill tests

Run from this repository's root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .agents/skills/ui-ux-pro-max/scripts/tests
```

These tests cover the search, design-system generation, curated data and commands
shipped in this skill directory. Script-path checks use this installation layout;
snapshot checks validate the committed catalog data directly.

Upstream repository maintenance tools for refreshing remote catalogs, evaluating
relevance and syncing plugin/CLI distributions are not vendored. Their tests are
not part of this installed skill's suite.
