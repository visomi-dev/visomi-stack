import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../shared/navigation-heading';
import { Heading, Text, LinkButton } from '../ui';

@Component({
  selector: 'app-private-home',
  imports: [NavigationHeading, Heading, Text, LinkButton, RouterLink],
  templateUrl: './home.html',
})
export class Home {}
