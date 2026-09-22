import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SECURITY_URL } from '../../shared/constants/routes';
import { AuthCard } from '../../shared/ui/layout/auth-card/auth-card';
import { AuthLayout } from '../../shared/ui/layout/auth-layout/auth-layout';

@Component({
  imports: [AuthCard, AuthLayout, RouterLink],
  selector: 'app-reauthentication',
  templateUrl: './reauthentication.html',
  styleUrl: './reauthentication.css',
})
export class Reauthentication {
  protected readonly securityUrl = SECURITY_URL;
}
