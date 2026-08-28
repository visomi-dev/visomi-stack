import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Icon } from './icon';

@Component({
  imports: [Icon],
  template: '<app-icon name="check" />',
})
class Host {}

describe('Icon', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders svg paths', () => {
    expect(fixture.nativeElement.querySelectorAll('path').length).toBe(1);
  });
});
