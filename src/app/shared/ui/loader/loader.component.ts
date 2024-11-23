import { Component, HostBinding, booleanAttribute, input } from '@angular/core';
import { NgClass } from '@angular/common';

@Component({
  selector: 'app-loader',
  standalone: true,
  imports: [NgClass],
  templateUrl: './loader.component.html',
  styleUrls: ['./loader.component.css'],
})
export class LoaderComponent {
  readonly duration = input(1000);
  readonly active = input(false, { transform: booleanAttribute });

  @HostBinding('style.--animation-duration') get durationStyle() {
    return `${this.duration()}ms`;
  }
}
