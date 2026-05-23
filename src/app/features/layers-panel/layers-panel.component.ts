import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'visc-layers-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './layers-panel.component.html',
})
export class ViscLayersPanel {
  @Input({ required: true }) result: any;
  @Input({ required: true }) selectedShares!: Set<number>;
  @Output() toggle = new EventEmitter<number>();

  isShareSelected(index: number): boolean {
    return this.selectedShares.has(index);
  }
}
