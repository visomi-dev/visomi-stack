// Astro diagnostics may contain URLs, headers or exception details. Keep only controlled events.
export default function logger() {
  return {
    write(event) {
      if (event.level === 'error') {
        console.error('{"event":"site.render_failed"}');
      } else if (event.level === 'warn') {
        console.warn('{"event":"site.render_warning"}');
      }
    },
  };
}
