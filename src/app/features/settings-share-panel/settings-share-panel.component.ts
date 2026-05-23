import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { debounceTime, Subject, takeUntil } from 'rxjs';

enum SettingsShareFormFields {
  n = 'n',
  k = 'k',
  isColored = 'isColored',
}

interface SettingsShareForm {
  [SettingsShareFormFields.n]: FormControl<number>;
  [SettingsShareFormFields.k]: FormControl<number>;
  [SettingsShareFormFields.isColored]: FormControl<boolean>;
}

export const kLessOrEqualNValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const k = control.get(SettingsShareFormFields.k)?.value;
  const n = control.get(SettingsShareFormFields.n)?.value;

  return k !== null && n !== null && k > n ? { kGreaterThanN: true } : null;
};

@Component({
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FontAwesomeModule],
  selector: 'visc-settings-share-panel',
  templateUrl: 'settings-share-panel.component.html',
})
export class ViscSettingsSharePanel implements OnInit, OnDestroy {
  @Output() settingsChanged = new EventEmitter<{ k: number; n: number; isColored: boolean }>();

  readonly formGroup = new FormGroup<SettingsShareForm>(
    {
      [SettingsShareFormFields.n]: new FormControl<number>(2, {
        nonNullable: true,
        validators: [Validators.min(2), Validators.max(10)],
      }),
      [SettingsShareFormFields.k]: new FormControl<number>(2, {
        nonNullable: true,
        validators: [Validators.min(2)],
      }),
      [SettingsShareFormFields.isColored]: new FormControl<boolean>(false, { nonNullable: true }),
    },
    { validators: kLessOrEqualNValidator },
  );

  readonly formFields = SettingsShareFormFields;

  private destroy$ = new Subject<void>();

  ngOnInit() {
    this.formGroup.valueChanges.pipe(debounceTime(100), takeUntil(this.destroy$)).subscribe(() => {
      if (this.formGroup.valid) {
        this.settingsChanged.emit(this.formGroup.getRawValue());
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
