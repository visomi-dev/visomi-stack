import { Component } from '@angular/core';

import { Card } from '../shared/ui/layout/card/card';
import { Container } from '../shared/ui/layout/container/container';
import { Heading } from '../shared/ui/typography/heading/heading';
import { Text } from '../shared/ui/typography/text/text';

@Component({
  imports: [Card, Container, Heading, Text],
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {}
