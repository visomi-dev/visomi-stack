import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Heading, Text, LinkButton } from '../../ui';

@Component({
  selector: 'app-private-home',
  imports: [Heading, Text, LinkButton, RouterLink],
  templateUrl: './home.html',
})
export class Home {}
