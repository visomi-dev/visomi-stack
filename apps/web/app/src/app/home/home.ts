import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../shared/navigation-heading';
import { Alert, Badge, Button, Card, Heading, LineChart, LinkButton, Loader, Table, Text } from '../ui';

import { CheckBatches } from './check-batches/check-batches';

@Component({
  selector: 'app-private-home',
  imports: [
    NavigationHeading,
    Alert,
    Badge,
    Button,
    Card,
    CheckBatches,
    Heading,
    LineChart,
    LinkButton,
    Loader,
    Table,
    Text,
    RouterLink,
    DatePipe,
    DecimalPipe,
  ],
  templateUrl: './home.html',
})
export class Home {
  protected readonly period = signal<7 | 14>(14);

  protected readonly sample = resource({
    id: 'example-dashboard-checks',
    loader: async () => {
      const { sampleDays } = await import('./sample-checks');

      return sampleDays;
    },
  });

  protected readonly days = computed(() => (this.sample.hasValue() ? this.sample.value().slice(-this.period()) : []));
  protected readonly batches = computed(() => this.days().flatMap(({ batches }) => batches));
  protected readonly total = computed(() => this.days().reduce((sum, day) => sum + day.total, 0));
  protected readonly passed = computed(() => this.days().reduce((sum, day) => sum + day.passed, 0));
  protected readonly failed = computed(() => this.total() - this.passed());
  protected readonly series = computed(() => this.days().map(({ total }) => total));
  protected readonly peak = computed(() => Math.max(0, ...this.series()));
}
