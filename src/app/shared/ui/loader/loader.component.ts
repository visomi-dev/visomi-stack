import { Component, HostBinding, Input, booleanAttribute } from '@angular/core';
import { NgClass } from '@angular/common';

@Component({
  selector: 'app-loader',
  standalone: true,
  imports: [NgClass],
  template: `
    <div
      class="grid grid-cols-4 gap-1 transition"
      [ngClass]="[active ? 'opacity-1' : 'opacity-0']"
    >
      <svg
        class="loader-icon h-auto w-full text-red-400"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="50" cy="50" r="50" fill="currentColor" />
      </svg>

      <svg
        class="loader-icon h-auto w-full text-yellow-200"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="50" cy="50" r="50" fill="currentColor" />
      </svg>

      <svg
        class="loader-icon h-auto w-full text-green-400"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="50" cy="50" r="50" fill="currentColor" />
      </svg>

      <svg
        class="loader-icon h-auto w-full text-purple-400"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="50" cy="50" r="50" fill="currentColor" />
      </svg>
    </div>
  `,
  styles: [
    `
      .loader-icon {
        animation-duration: var(--animation-duration);
        animation-iteration-count: infinite;
        animation-timing-function: linear;
      }

      .loader-icon:nth-child(1) {
        animation-name: firstJump;
      }

      .loader-icon:nth-child(2) {
        animation-name: secondJump;
      }

      .loader-icon:nth-child(3) {
        animation-name: thirdJump;
      }

      .loader-icon:nth-child(4) {
        animation-name: fourthJump;
      }

      @keyframes firstJump {
        12.5% {
          transform: translateY(-100%);
        }
        25% {
          transform: translateY(0%);
        }
      }

      @keyframes secondJump {
        12.5% {
          transform: translateY(0%);
        }
        25% {
          transform: translateY(-100%);
        }
        50% {
          transform: translateY(0%);
        }
      }

      @keyframes thirdJump {
        25% {
          transform: translateY(0%);
        }
        50% {
          transform: translateY(-100%);
        }
        75% {
          transform: translateY(0%);
        }
      }

      @keyframes fourthJump {
        50% {
          transform: translateY(0%);
        }
        75% {
          transform: translateY(-100%);
        }
        100% {
          transform: translateY(0%);
        }
      }
    `,
  ],
})
export class LoaderComponent {
  @Input({
    required: false,
  })
  duration = 1000;
  @Input({
    required: false,
    transform: booleanAttribute,
  })
  active = true;

  @HostBinding('style.--animation-duration') get durationStyle() {
    return `${this.duration}ms`;
  }
}
