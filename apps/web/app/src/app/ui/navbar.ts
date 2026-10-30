import { Directive } from '@angular/core';

import { navbar } from '@visomi-stack/web-frontend-ui';

@Directive({
  selector: 'nav[appUI=navbar]',
  host: { '[class]': 'classes' },
})
export class Navbar {
  protected readonly classes = navbar.classes();
}
