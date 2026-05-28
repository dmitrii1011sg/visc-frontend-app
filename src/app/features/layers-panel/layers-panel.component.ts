import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faCheckSquare, faEye, faEyeSlash, faSquare } from '@fortawesome/free-solid-svg-icons';

@Component({
  selector: 'visc-layers-panel',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule],
  templateUrl: './layers-panel.component.html',
})
export class ViscLayersPanel {
  @Input({ required: true }) result: any;
  @Input({ required: true }) selectedShares!: Set<number>;
  @Output() toggle = new EventEmitter<number>();
  @Output() toggleAll = new EventEmitter<boolean>();

  icons = { eye: faEye, eyeSlash: faEyeSlash };

  isShareSelected(index: number): boolean {
    return this.selectedShares.has(index);
  }

  areAllSelected(): boolean {
    return this.result?.shares && this.selectedShares.size === this.result.shares.length;
  }
}
