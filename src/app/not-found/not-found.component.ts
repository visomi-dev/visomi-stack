import { Component, HostBinding } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
    selector: 'app-not-found',
    imports: [RouterLink],
    templateUrl: './not-found.component.html',
    styleUrl: './not-found.component.css'
})
export default class NotFoundComponent {
  @HostBinding('class') readonly cls =
    /* tw */ 'block relative isolate min-h-full';
}
