import { animate, style, transition, trigger } from '@angular/animations';
import { Component, HostBinding, inject } from '@angular/core';

import { UIService } from '../ui.service';

@Component({
  selector: 'app-page-loader',
  imports: [],
  templateUrl: './page-loader.component.html',
  styleUrl: './page-loader.component.css',
  animations: [
    trigger('inOutAnimation', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('400ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [
        style({ opacity: 1 }),
        animate('400ms ease-in', style({ opacity: 0 })),
      ]),
    ]),
  ],
})
export class PageLoaderComponent {
  @HostBinding('class') readonly cls = /* tw */ 'block';

  private readonly uiService = inject(UIService);

  readonly loading = this.uiService.loading;
  readonly authenticating = this.uiService.loading;
  readonly navigating = this.uiService.navigating;
}
