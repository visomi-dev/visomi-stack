import { AuthMail, inject, type SecurityNotice } from '@visomi-stack/backend-shared';

export class SecurityNotifications {
  private readonly mail = inject(AuthMail);

  async notify(email: string | null, notice: SecurityNotice) {
    if (!email) {
      return false;
    }

    try {
      await this.mail.notice(email, notice);

      return true;
    } catch {
      return false;
    }
  }
}
