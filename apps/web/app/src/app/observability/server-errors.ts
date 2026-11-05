import { ErrorHandler, Service } from '@angular/core';

@Service({ autoProvided: false })
export class ServerErrors implements ErrorHandler {
  handleError(_error: unknown): void {
    console.error('{"event":"app.render_failed"}');
  }
}
