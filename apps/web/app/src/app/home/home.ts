import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../shared/navigation-heading';
import { Button, Card, Heading, LinkButton, Table, Text } from '../ui';

// A fixed example series. This page never reads the private visits report.
const dailyChecks = [
  { passed: 18, failed: 3 },
  { passed: 25, failed: 1 },
  { passed: 22, failed: 4 },
  { passed: 34, failed: 2 },
  { passed: 31, failed: 3 },
  { passed: 16, failed: 1 },
  { passed: 21, failed: 2 },
  { passed: 27, failed: 1 },
  { passed: 35, failed: 2 },
  { passed: 29, failed: 3 },
  { passed: 43, failed: 1 },
  { passed: 36, failed: 2 },
  { passed: 22, failed: 1 },
  { passed: 32, failed: 2 },
].map(({ passed, failed }, index) => ({
  day: '2026-10-' + String(index + 1).padStart(2, '0'),
  passed,
  failed,
  total: passed + failed,
}));

@Component({
  selector: 'app-private-home',
  imports: [NavigationHeading, Button, Card, Heading, LinkButton, Table, Text, RouterLink, DatePipe, DecimalPipe],
  templateUrl: './home.html',
})
export class Home {
  protected readonly period = signal<7 | 14>(14);

  protected readonly days = computed(() => dailyChecks.slice(-this.period()));
  protected readonly total = computed(() => this.days().reduce((sum, day) => sum + day.total, 0));
  protected readonly passed = computed(() => this.days().reduce((sum, day) => sum + day.passed, 0));
  protected readonly failed = computed(() => this.total() - this.passed());
  protected readonly peak = computed(() => Math.max(...this.days().map(({ total }) => total)));
  protected readonly points = computed(() =>
    this.days().map(({ total }, index) => ({
      x: 16 + (index * 448) / (this.days().length - 1),
      y: 108 - (total * 92) / 50,
    })),
  );
  protected readonly coordinates = computed(() =>
    this.points()
      .map(({ x, y }) => x + ',' + y)
      .join(' '),
  );
}
