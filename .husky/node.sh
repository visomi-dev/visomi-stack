if [ -n "${HOME:-}" ]; then
  export PATH="$PATH:$HOME/.local/share/fnm:$HOME/.local/share/pnpm/bin:$HOME/.local/share/pnpm"
fi

run_hook() {
  if command -v fnm >/dev/null 2>&1; then
    hook_node=$(fnm exec --using=.node-version node -p 'process.execPath') || return
  else
    hook_node=$(command -v node) || :
  fi

  if [ -n "$hook_node" ]; then
    # pnpm exec prepends its own Node shim, so restore the selected Node first.
    PATH="${hook_node%/*}:$PATH" pnpm exec sh -c '
      export PATH="$1:$PATH"
      shift
      exec "$@"
    ' sh "${hook_node%/*}" "$@"
  else
    pnpm exec "$@"
  fi
}
