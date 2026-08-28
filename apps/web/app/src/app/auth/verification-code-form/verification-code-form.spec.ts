import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VerificationCodeForm } from './verification-code-form';

describe('VerificationCodeForm', () => {
  let component: VerificationCodeForm;
  let fixture: ComponentFixture<VerificationCodeForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VerificationCodeForm],
    }).compileComponents();

    fixture = TestBed.createComponent(VerificationCodeForm);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
