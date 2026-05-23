import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ViscWorkspace } from './features/workspace/workspace.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ViscWorkspace],
  template: `
    <visc-workspace></visc-workspace>
    <router-outlet></router-outlet>
  `,
})
export class App {}
